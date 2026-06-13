import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from './config.js';
import { RunMetadata, RunRecord, RunStatus, ScriptRecord } from './types.js';

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

ensureDir(path.dirname(config.dbPath));
ensureDir(config.scriptsDir);
ensureDir(config.artifactsDir);
ensureDir(config.workspacesDir);

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  duration_ms INTEGER,
  workspace_dir TEXT NOT NULL,
  artifact_dir TEXT NOT NULL,
  stdout_path TEXT NOT NULL,
  stderr_path TEXT NOT NULL,
  final_url TEXT NOT NULL DEFAULT '',
  console_logs TEXT NOT NULL DEFAULT '[]',
  network_failures TEXT NOT NULL DEFAULT '[]'
);
`);

const supabase =
  config.supabaseUrl && config.supabaseAnonKey
    ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: false },
        realtime: { transport: WebSocket as any }
      })
    : null;

const extractStartUrl = (content: string): string | null => {
  const match = content.match(/page\.goto\((['"])(.*?)\1\)/);
  if (!match) return null;
  return match[2] ?? null;
};

const sanitizeFileName = (name: string, id: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'script'}-${id.slice(0, 8)}.spec.ts`;
};

const writeScriptFile = (name: string, content: string): string => {
  fs.mkdirSync(config.scriptsDir, { recursive: true });
  const scriptPath = path.join(config.scriptsDir, name);
  fs.writeFileSync(scriptPath, content, 'utf-8');
  return scriptPath;
};

const mapFlowToScript = (row: {
  id: string;
  name: string | null;
  generated_playwright: string | null;
  created_at: string | null;
}): ScriptRecord => {
  const name = (row.name && row.name.trim()) || `flow-${row.id.slice(0, 8)}`;
  const content = row.generated_playwright ?? "import { test } from '@playwright/test';\n\ntest('name', async () => {\n});\n";
  const filePath = writeScriptFile(sanitizeFileName(name, row.id), content);
  const createdAt = row.created_at ?? new Date().toISOString();
  return {
    id: row.id,
    name,
    content,
    filePath,
    createdAt,
    updatedAt: createdAt
  };
};

const ensureSupabase = (): NonNullable<typeof supabase> => {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  return supabase;
};

const getArtifactKind = (filePath: string): 'image' | 'video' | 'json' | 'other' => {
  const lower = filePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov)$/.test(lower)) return 'video';
  if (/\.json$/.test(lower)) return 'json';
  return 'other';
};

const getArtifactBrowser = (filePath: string): 'chromium' | 'firefox' | 'webkit' | 'unknown' => {
  if (filePath.includes('chromium')) return 'chromium';
  if (filePath.includes('firefox')) return 'firefox';
  if (filePath.includes('webkit')) return 'webkit';
  return 'unknown';
};

const getFileName = (filePath: string): string => path.basename(filePath);

const listArtifactPaths = (artifactDir: string): string[] => {
  if (!fs.existsSync(artifactDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [artifactDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        files.push(path.relative(artifactDir, full));
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
};

const persistRunToSupabase = async (run: RunRecord): Promise<void> => {
  if (!supabase) {
    return;
  }

  const client = ensureSupabase();
  const payload = {
    id: run.id,
    script_id: run.scriptId,
    script_name: run.scriptName,
    status: run.status,
    created_at: run.createdAt,
    start_time: run.startTime,
    end_time: run.endTime,
    duration_ms: run.durationMs,
    workspace_dir: run.workspaceDir,
    artifact_dir: run.artifactDir,
    stdout_path: run.stdoutPath,
    stderr_path: run.stderrPath,
    final_url: run.finalUrl,
    console_logs: run.consoleLogs,
    network_failures: run.networkFailures,
    metadata: run.metadata ?? null,
    updated_at: new Date().toISOString()
  };

  const { error } = await client.from('qauto_test_runs').upsert(payload, { onConflict: 'id' });
  if (error) {
    throw new Error(`failed to persist test run: ${error.message}`);
  }
};

const persistArtifactsToSupabase = async (runId: string, artifactDir: string): Promise<void> => {
  if (!supabase) {
    return;
  }

  const client = ensureSupabase();
  const artifactPaths = listArtifactPaths(artifactDir);

  const { error: deleteError } = await client.from('qauto_test_run_artifacts').delete().eq('run_id', runId);
  if (deleteError) {
    throw new Error(`failed to reset test run artifacts: ${deleteError.message}`);
  }

  if (artifactPaths.length === 0) {
    return;
  }

  const rows = artifactPaths.map((filePath) => ({
    run_id: runId,
    browser: getArtifactBrowser(filePath),
    artifact_kind: getArtifactKind(filePath),
    path: filePath,
    file_name: getFileName(filePath),
    extension: path.extname(filePath).replace(/^\./, '') || null,
    source_url: null
  }));

  const { error } = await client.from('qauto_test_run_artifacts').insert(rows);
  if (error) {
    throw new Error(`failed to persist test run artifacts: ${error.message}`);
  }
};

const persistRunLogToSupabase = async (entry: {
  runId: string;
  logType: 'log' | 'status';
  stream?: 'stdout' | 'stderr';
  message: string;
  timestamp: string;
}): Promise<void> => {
  if (!supabase) {
    return;
  }

  const client = ensureSupabase();
  const { error } = await client.from('qauto_test_run_logs').insert({
    run_id: entry.runId,
    log_type: entry.logType,
    stream: entry.stream ?? null,
    message: entry.message,
    timestamp: entry.timestamp
  });

  if (error) {
    throw new Error(`failed to persist test run log: ${error.message}`);
  }
};

const mapRun = (row: Record<string, string | number | null>): RunRecord => ({
  id: row.id as string,
  scriptId: row.script_id as string,
  scriptName: row.script_name as string,
  status: row.status as RunStatus,
  createdAt: row.created_at as string,
  startTime: (row.start_time as string | null) ?? null,
  endTime: (row.end_time as string | null) ?? null,
  durationMs: (row.duration_ms as number | null) ?? null,
  workspaceDir: row.workspace_dir as string,
  artifactDir: row.artifact_dir as string,
  stdoutPath: row.stdout_path as string,
  stderrPath: row.stderr_path as string,
  finalUrl: (row.final_url as string) ?? '',
  consoleLogs: JSON.parse((row.console_logs as string) ?? '[]') as string[],
  networkFailures: JSON.parse((row.network_failures as string) ?? '[]') as string[]
});

export const scriptRepo = {
  async create(script: ScriptRecord): Promise<void> {
    const client = ensureSupabase();
    const { error } = await client.from('qauto_flows').insert({
      id: script.id,
      name: script.name,
      start_url: extractStartUrl(script.content),
      generated_playwright: script.content
    });
    if (error) throw new Error(`failed to create flow: ${error.message}`);

    writeScriptFile(sanitizeFileName(script.name, script.id), script.content);
  },

  async update(script: ScriptRecord): Promise<void> {
    const client = ensureSupabase();
    const { error } = await client
      .from('qauto_flows')
      .update({
        name: script.name,
        start_url: extractStartUrl(script.content),
        generated_playwright: script.content
      })
      .eq('id', script.id);
    if (error) throw new Error(`failed to update flow: ${error.message}`);

    writeScriptFile(sanitizeFileName(script.name, script.id), script.content);
  },

  async delete(id: string): Promise<void> {
    const client = ensureSupabase();
    const { error } = await client.from('qauto_flows').delete().eq('id', id);
    if (error) throw new Error(`failed to delete flow: ${error.message}`);
  },

  async byId(id: string): Promise<ScriptRecord | null> {
    const client = ensureSupabase();
    const { data, error } = await client
      .from('qauto_flows')
      .select('id,name,generated_playwright,created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`failed to fetch flow: ${error.message}`);
    if (!data) return null;
    return mapFlowToScript(data);
  },

  async list(): Promise<ScriptRecord[]> {
    const client = ensureSupabase();
    const { data, error } = await client
      .from('qauto_flows')
      .select('id,name,generated_playwright,created_at')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`failed to list flows: ${error.message}`);
    return (data ?? []).map(mapFlowToScript);
  }
};

export const runRepo = {
  create(run: RunRecord): void {
    db.prepare(
      `INSERT INTO runs (
         id, script_id, script_name, status, created_at, start_time, end_time, duration_ms,
         workspace_dir, artifact_dir, stdout_path, stderr_path, final_url, console_logs, network_failures
       ) VALUES (
         @id, @scriptId, @scriptName, @status, @createdAt, @startTime, @endTime, @durationMs,
         @workspaceDir, @artifactDir, @stdoutPath, @stderrPath, @finalUrl, @consoleLogs, @networkFailures
       )`
    ).run({
      ...run,
      consoleLogs: JSON.stringify(run.consoleLogs),
      networkFailures: JSON.stringify(run.networkFailures)
    });

    void persistRunToSupabase(run);
  },

  update(id: string, patch: Partial<RunRecord>): void {
    const current = this.byId(id);
    if (!current) {
      return;
    }
    const next = { ...current, ...patch };
    db.prepare(
      `UPDATE runs SET
         status=@status,
         start_time=@startTime,
         end_time=@endTime,
         duration_ms=@durationMs,
         final_url=@finalUrl,
         console_logs=@consoleLogs,
         network_failures=@networkFailures
       WHERE id=@id`
    ).run({
      id,
      status: next.status,
      startTime: next.startTime,
      endTime: next.endTime,
      durationMs: next.durationMs,
      finalUrl: next.finalUrl,
      consoleLogs: JSON.stringify(next.consoleLogs),
      networkFailures: JSON.stringify(next.networkFailures)
    });

    void persistRunToSupabase(next);
  },

  byId(id: string): RunRecord | null {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as
      | Record<string, string | number | null>
      | undefined;
    return row ? mapRun(row) : null;
  },

  list(): RunRecord[] {
    const rows = db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as Array<
      Record<string, string | number | null>
    >;
    return rows.map(mapRun);
  },

  stats(): { total: number; passed: number; failed: number; running: number } {
    const row = db
      .prepare(
        `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
            SUM(CASE WHEN status IN ('failed','timeout','cancelled') THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) as running
         FROM runs`
      )
      .get() as Record<string, number | null>;

    return {
      total: row.total ?? 0,
      passed: row.passed ?? 0,
      failed: row.failed ?? 0,
      running: row.running ?? 0
    };
  },
  persistArtifacts(runId: string, artifactDir: string): void {
    void persistArtifactsToSupabase(runId, artifactDir);
  },
  persistLog(entry: {
    runId: string;
    logType: 'log' | 'status';
    stream?: 'stdout' | 'stderr';
    message: string;
    timestamp: string;
  }): void {
    void persistRunLogToSupabase(entry);
  },
  attachMetadata(id: string, metadata: RunMetadata): void {
    const current = this.byId(id);
    if (!current) {
      return;
    }

    const next = { ...current, metadata };
    void persistRunToSupabase(next);
  }
};
