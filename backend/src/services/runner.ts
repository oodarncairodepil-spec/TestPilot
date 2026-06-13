import fs from 'node:fs';
import path from 'node:path';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { config } from '../config.js';
import { runRepo } from '../db.js';
import { logger } from '../logger.js';
import { publishRunLog } from '../logHub.js';
import { ParsedRunResult, RunStatus, ScriptRecord } from '../types.js';

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
};

const safeArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const listFiles = (baseDir: string, extensionFilter?: string): string[] => {
  if (!fs.existsSync(baseDir)) {
    return [];
  }
  const output: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (!extensionFilter || full.endsWith(extensionFilter)) {
        output.push(full);
      }
    }
  };
  walk(baseDir);
  return output;
};

const parseReport = (artifactDir: string): ParsedRunResult => {
  const reportPath = path.join(artifactDir, 'report.json');
  let status: RunStatus = 'failed';
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as { stats?: { expected?: number; unexpected?: number } };
      if ((report.stats?.unexpected ?? 0) === 0 && (report.stats?.expected ?? 0) > 0) {
        status = 'passed';
      }
    } catch {
      status = 'failed';
    }
  }

  return {
    status,
    finalUrl: '',
    consoleLogs: [],
    networkFailures: [],
    screenshots: listFiles(path.join(artifactDir, 'test-results'), '.png'),
    videos: listFiles(path.join(artifactDir, 'test-results'), '.webm'),
    traces: listFiles(path.join(artifactDir, 'test-results'), '.zip')
  };
};

const playwrightConfigTs = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['line'],
    ['json', { outputFile: '/artifacts/report.json' }]
  ],
  use: {
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    viewport: { width: 1280, height: 720 }
  },
  outputDir: '/artifacts/test-results',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
`;

const packageJson = {
  name: 'playwright-run-workspace',
  private: true,
  version: '1.0.0',
  type: 'module',
  devDependencies: {
    '@playwright/test': '^1.55.0'
  }
};

const timeoutShell = (seconds: number): string => `timeout --preserve-status ${seconds}s`;

const ensureTestFileName = (name: string): string => {
  const trimmed = name.trim();
  if (/\.(spec|test)\.(ts|js|mjs|cjs)$/.test(trimmed)) {
    return trimmed;
  }

  const stem = trimmed
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${stem || "run"}.spec.ts`;
};

const createWorkspace = (runId: string, script: ScriptRecord): { workspaceDir: string; artifactDir: string } => {
  const workspaceDir = path.join(config.workspacesDir, runId);
  const artifactDir = path.join(config.artifactsDir, runId);
  const testFileName = ensureTestFileName(script.name);
  fs.rmSync(workspaceDir, { force: true, recursive: true });
  fs.rmSync(artifactDir, { force: true, recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'tests'), { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'tests', testFileName), script.content, 'utf-8');
  fs.writeFileSync(path.join(workspaceDir, 'playwright.config.ts'), playwrightConfigTs, 'utf-8');
  writeJson(path.join(workspaceDir, 'package.json'), packageJson);
  return { workspaceDir, artifactDir };
};

interface ActiveRun {
  cancelRequested: boolean;
  requestCancel: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

const containerNameForRun = (runId: string): string => `pw-run-${runId}`;

const forceRemoveContainer = (containerName: string): void => {
  const child = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  child.on('error', () => undefined);
};

const removeContainerSync = (containerName: string): void => {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
};

export interface RunExecutionResult {
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  artifactDir: string;
  workspaceDir: string;
  finalUrl: string;
  consoleLogs: string[];
  networkFailures: string[];
}

export const cancelExecution = (runId: string): boolean => {
  const active = activeRuns.get(runId);
  if (!active) {
    return false;
  }
  active.requestCancel();
  return true;
};

export const executeScript = async (runId: string, script: ScriptRecord): Promise<RunExecutionResult> => {
  const startedAt = new Date().toISOString();
  const { workspaceDir, artifactDir } = createWorkspace(runId, script);
  const workspacePackageJsonPath = path.join(workspaceDir, 'package.json');
  const workspaceConfigPath = path.join(workspaceDir, 'playwright.config.ts');
  const stdoutPath = path.join(artifactDir, 'stdout.txt');
  const stderrPath = path.join(artifactDir, 'stderr.txt');
  const stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'a' });
  const stderrStream = fs.createWriteStream(stderrPath, { flags: 'a' });

  if (!fs.existsSync(workspacePackageJsonPath)) {
    throw new Error(`workspace package.json missing before docker run: ${workspacePackageJsonPath}`);
  }

  if (!fs.existsSync(workspaceConfigPath)) {
    throw new Error(`workspace playwright config missing before docker run: ${workspaceConfigPath}`);
  }

  const timeoutSec = Math.floor(config.maxRunMs / 1000);
  const command = `${timeoutShell(timeoutSec)} bash -lc "pwd && ls -la /workspace && cat /workspace/package.json && npm install --no-audit --no-fund && npx playwright test"`;
  const containerName = containerNameForRun(runId);

  removeContainerSync(containerName);

  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--cpus',
    config.runCpuLimit,
    '--memory',
    config.runMemoryLimit,
    '--pids-limit',
    '256',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '-v',
    `${workspaceDir}:/workspace`,
    '-v',
    `${artifactDir}:/artifacts`,
    '-w',
    '/workspace',
    config.runnerImage,
    'bash',
    '-lc',
    command
  ];

  logger.info({ runId, args }, 'starting playwright run container');

  const child: ChildProcess = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const active: ActiveRun = {
    cancelRequested: false,
    requestCancel: () => {
      if (active.cancelRequested) {
        return;
      }
      active.cancelRequested = true;
      child.kill('SIGTERM');
      forceRemoveContainer(containerName);
    }
  };

  activeRuns.set(runId, active);

  child.stdout?.on('data', (chunk) => {
    const line = chunk.toString();
    stdoutStream.write(line);
    publishRunLog({
      type: 'log',
      runId,
      stream: 'stdout',
      data: line,
      timestamp: new Date().toISOString()
    });
  });

  child.stderr?.on('data', (chunk) => {
    const line = chunk.toString();
    stderrStream.write(line);
    publishRunLog({
      type: 'log',
      runId,
      stream: 'stderr',
      data: line,
      timestamp: new Date().toISOString()
    });
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    const killTimer = setTimeout(() => {
      if (!active.cancelRequested) {
        child.kill('SIGKILL');
      }
    }, config.maxRunMs + 5_000);

    child.on('exit', (code) => {
      clearTimeout(killTimer);
      resolve(code);
    });
  });

  activeRuns.delete(runId);

  stdoutStream.end();
  stderrStream.end();
  const endedAt = new Date().toISOString();
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

  const parsed = parseReport(artifactDir);
  let status = parsed.status;
  if (active.cancelRequested) {
    status = 'cancelled';
  } else if (exitCode === 124 || durationMs >= config.maxRunMs) {
    status = 'timeout';
  } else if (exitCode !== 0 && status === 'passed') {
    status = 'failed';
  }

  const metadata = {
    id: runId,
    status,
    startTime: startedAt,
    endTime: endedAt,
    duration: durationMs,
    stdout: stdoutPath,
    stderr: stderrPath,
    screenshots: safeArray(parsed.screenshots),
    videos: safeArray(parsed.videos),
    traces: safeArray(parsed.traces),
    finalUrl: parsed.finalUrl,
    consoleLogs: safeArray(parsed.consoleLogs),
    networkFailures: safeArray(parsed.networkFailures)
  };
  writeJson(path.join(artifactDir, 'metadata.json'), metadata);
  runRepo.attachMetadata(runId, metadata);
  runRepo.persistArtifacts(runId, artifactDir);

  publishRunLog({
    type: 'status',
    runId,
    data: status,
    timestamp: endedAt
  });

  return {
    status,
    startedAt,
    endedAt,
    durationMs,
    stdoutPath,
    stderrPath,
    artifactDir,
    workspaceDir,
    finalUrl: parsed.finalUrl,
    consoleLogs: parsed.consoleLogs,
    networkFailures: parsed.networkFailures
  };
};
