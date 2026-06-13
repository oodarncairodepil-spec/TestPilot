import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from './config.js';
import { getBufferedLogs } from './logHub.js';
import { runRepo, scriptRepo } from './db.js';
import { runQueue } from './services/runQueue.js';
import { RunRecord, ScriptRecord } from './types.js';

const upload = multer();
const router = Router();

const scriptSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+\.spec\.ts$/),
  content: z.string().min(1)
});

const runSchema = z.object({
  scriptId: z.string().min(1)
});

const writeScriptFile = (name: string, content: string): string => {
  fs.mkdirSync(config.scriptsDir, { recursive: true });
  const scriptPath = path.join(config.scriptsDir, name);
  fs.writeFileSync(scriptPath, content, 'utf-8');
  return scriptPath;
};

router.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    queueDepth: runQueue.pendingCount()
  });
});

router.get('/api/scripts', (_req, res) => {
  res.json({ items: scriptRepo.list() });
});

router.post('/api/scripts', upload.none(), (req, res) => {
  const payload = scriptSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: payload.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const script: ScriptRecord = {
    id: uuidv4(),
    name: payload.data.name,
    content: payload.data.content,
    filePath: writeScriptFile(payload.data.name, payload.data.content),
    createdAt: now,
    updatedAt: now
  };
  scriptRepo.create(script);
  res.status(201).json(script);
});

router.put('/api/scripts/:id', upload.none(), (req, res) => {
  const payload = scriptSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: payload.error.flatten() });
    return;
  }
  const current = scriptRepo.byId(String(req.params.id));
  if (!current) {
    res.status(404).json({ error: 'script not found' });
    return;
  }
  if (current.name !== payload.data.name) {
    fs.rmSync(current.filePath, { force: true });
  }
  const updated: ScriptRecord = {
    ...current,
    name: payload.data.name,
    content: payload.data.content,
    filePath: writeScriptFile(payload.data.name, payload.data.content),
    updatedAt: new Date().toISOString()
  };
  scriptRepo.update(updated);
  res.json(updated);
});

router.delete('/api/scripts/:id', (req, res) => {
  const current = scriptRepo.byId(String(req.params.id));
  if (!current) {
    res.status(404).json({ error: 'script not found' });
    return;
  }
  fs.rmSync(current.filePath, { force: true });
  scriptRepo.delete(current.id);
  res.status(204).send();
});

router.post('/api/run', upload.none(), (req, res) => {
  const payload = runSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: payload.error.flatten() });
    return;
  }
  const script = scriptRepo.byId(payload.data.scriptId);
  if (!script) {
    res.status(404).json({ error: 'script not found' });
    return;
  }

  const runId = uuidv4();
  const createdAt = new Date().toISOString();
  const run: RunRecord = {
    id: runId,
    scriptId: script.id,
    scriptName: script.name,
    status: 'queued',
    createdAt,
    startTime: null,
    endTime: null,
    durationMs: null,
    workspaceDir: path.join(config.workspacesDir, runId),
    artifactDir: path.join(config.artifactsDir, runId),
    stdoutPath: path.join(config.artifactsDir, runId, 'stdout.txt'),
    stderrPath: path.join(config.artifactsDir, runId, 'stderr.txt'),
    finalUrl: '',
    consoleLogs: [],
    networkFailures: []
  };
  runRepo.create(run);
  runQueue.enqueue(run);
  res.status(202).json(run);
});

router.post('/api/run/:id/stop', (req, res) => {
  const runId = String(req.params.id);
  const stopResult = runQueue.stop(runId);

  if (!stopResult.ok) {
    if (stopResult.reason === 'not_found') {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.status(409).json({ error: 'run is not running or queued' });
    return;
  }

  const run = runRepo.byId(runId);
  res.status(202).json({
    ok: true,
    state: stopResult.state,
    run
  });
});

router.get('/api/runs', (_req, res) => {
  res.json({
    stats: runRepo.stats(),
    items: runRepo.list()
  });
});

router.get('/api/run/:id', (req, res) => {
  const run = runRepo.byId(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  const metadataPath = path.join(run.artifactDir, 'metadata.json');
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) : null;
  res.json({ ...run, metadata });
});

router.get('/api/artifacts/:id', (req, res) => {
  const run = runRepo.byId(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  const files: string[] = [];
  if (fs.existsSync(run.artifactDir)) {
    const stack = [run.artifactDir];
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
          files.push(path.relative(run.artifactDir, full));
        }
      }
    }
  }

  const priority = (file: string): number => {
    const lower = file.toLowerCase();
    if (lower.includes('login-success-homepage.png')) return 0;
    if (lower.endsWith('.png')) return 1;
    if (lower.endsWith('.webm')) return 2;
    return 3;
  };

  files.sort((a, b) => {
    const byPriority = priority(a) - priority(b);
    if (byPriority !== 0) {
      return byPriority;
    }
    return a.localeCompare(b);
  });

  res.json({
    runId: run.id,
    root: run.artifactDir,
    files: files.map((file) => ({
      path: file,
      url: `/api/artifacts/${run.id}/file/${encodeURIComponent(file)}`
    }))
  });
});

router.get('/api/artifacts/:id/file/:filePath', (req, res) => {
  const run = runRepo.byId(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  const relativeFilePath = decodeURIComponent(req.params.filePath);
  const resolved = path.resolve(run.artifactDir, relativeFilePath);
  if (!resolved.startsWith(path.resolve(run.artifactDir))) {
    res.status(400).json({ error: 'invalid path' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'artifact file not found' });
    return;
  }
  res.sendFile(resolved);
});

router.get('/api/logs/:id', (req, res) => {
  const run = runRepo.byId(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  const stdout = fs.existsSync(run.stdoutPath) ? fs.readFileSync(run.stdoutPath, 'utf-8') : '';
  const stderr = fs.existsSync(run.stderrPath) ? fs.readFileSync(run.stderrPath, 'utf-8') : '';
  res.json({
    runId: run.id,
    stdout,
    stderr,
    live: getBufferedLogs(run.id)
  });
});

export default router;
