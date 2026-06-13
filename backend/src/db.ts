import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { RunRecord, RunStatus, ScriptRecord } from './types.js';

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
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
  network_failures TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY(script_id) REFERENCES scripts(id)
);
`);

const mapScript = (row: Record<string, string>): ScriptRecord => ({
  id: row.id,
  name: row.name,
  content: row.content,
  filePath: row.file_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

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
  create(script: ScriptRecord): void {
    db.prepare(
      `INSERT INTO scripts (id, name, content, file_path, created_at, updated_at)
       VALUES (@id, @name, @content, @filePath, @createdAt, @updatedAt)`
    ).run(script);
  },
  update(script: ScriptRecord): void {
    db.prepare(
      `UPDATE scripts
       SET name=@name, content=@content, file_path=@filePath, updated_at=@updatedAt
       WHERE id=@id`
    ).run(script);
  },
  delete(id: string): void {
    db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
  },
  byId(id: string): ScriptRecord | null {
    const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as Record<string, string> | undefined;
    return row ? mapScript(row) : null;
  },
  list(): ScriptRecord[] {
    const rows = db.prepare('SELECT * FROM scripts ORDER BY updated_at DESC').all() as Record<string, string>[];
    return rows.map(mapScript);
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
  }
};

