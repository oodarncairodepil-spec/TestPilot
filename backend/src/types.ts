export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'timeout' | 'cancelled';

export interface ScriptRecord {
  id: string;
  name: string;
  content: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlowStepRecord {
  id: string;
  flowId: string;
  kind: string;
  value: string | null;
  locators: unknown[];
  meta: Record<string, unknown> | null;
  title: string | null;
  expectedResult: Record<string, unknown> | null;
  typeDelayMs: number | null;
  orderIndex: number | null;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  scriptId: string;
  scriptName: string;
  status: RunStatus;
  createdAt: string;
  startTime: string | null;
  endTime: string | null;
  durationMs: number | null;
  workspaceDir: string;
  artifactDir: string;
  stdoutPath: string;
  stderrPath: string;
  finalUrl: string;
  consoleLogs: string[];
  networkFailures: string[];
  metadata?: RunMetadata | null;
}

export interface RunMetadata {
  id: string;
  status: RunStatus;
  startTime: string;
  endTime: string;
  duration: number;
  stdout: string;
  stderr: string;
  screenshots: string[];
  videos: string[];
  traces: string[];
  finalUrl: string;
  consoleLogs: string[];
  networkFailures: string[];
}

export interface RunArtifactRecord {
  runId: string;
  path: string;
}

export interface RunLogRecord {
  runId: string;
  type: 'log' | 'status';
  stream?: 'stdout' | 'stderr';
  message: string;
  timestamp: string;
}

export interface ParsedRunResult {
  status: RunStatus;
  finalUrl: string;
  consoleLogs: string[];
  networkFailures: string[];
  screenshots: string[];
  videos: string[];
  traces: string[];
}
