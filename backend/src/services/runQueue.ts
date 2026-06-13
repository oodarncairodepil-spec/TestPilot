import { runRepo } from '../db.js';
import { logger } from '../logger.js';
import { publishRunLog } from '../logHub.js';
import { cancelExecution, executeScript } from './runner.js';
import { scriptRepo } from '../db.js';
import { RunRecord } from '../types.js';

interface QueueItem {
  runId: string;
  scriptId: string;
}

interface StopResult {
  ok: boolean;
  reason?: 'not_found' | 'not_stoppable';
  state?: 'cancelled' | 'cancelling';
}

const queue: QueueItem[] = [];
let running = false;

const runOne = async (item: QueueItem): Promise<void> => {
  const run = runRepo.byId(item.runId);
  const script = await scriptRepo.byId(item.scriptId);
  if (!run || !script) {
    return;
  }

  if (run.status !== 'queued') {
    return;
  }

  const startedAt = new Date().toISOString();
  runRepo.update(item.runId, {
    status: 'running',
    startTime: startedAt
  });

  try {
    const result = await executeScript(item.runId, script);
    runRepo.update(item.runId, {
      status: result.status,
      startTime: result.startedAt,
      endTime: result.endedAt,
      durationMs: result.durationMs,
      finalUrl: result.finalUrl,
      consoleLogs: result.consoleLogs,
      networkFailures: result.networkFailures
    });
  } catch (error) {
    logger.error({ err: error, runId: item.runId }, 'run execution failed');
    runRepo.update(item.runId, {
      status: 'failed',
      endTime: new Date().toISOString()
    });
  }
};

const drain = async (): Promise<void> => {
  if (running) {
    return;
  }
  running = true;
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    await runOne(next);
  }
  running = false;
};

export const runQueue = {
  enqueue(run: RunRecord): void {
    queue.push({ runId: run.id, scriptId: run.scriptId });
    void drain();
  },
  async stop(runId: string): Promise<StopResult> {
    const run = runRepo.byId(runId);
    if (!run) {
      return { ok: false, reason: 'not_found' };
    }

    if (run.status === 'queued') {
      const idx = queue.findIndex((item) => item.runId === runId);
      if (idx >= 0) {
        queue.splice(idx, 1);
      }

      const now = new Date().toISOString();
      runRepo.update(runId, {
        status: 'cancelled',
        endTime: now,
        durationMs: 0
      });

      publishRunLog({
        type: 'status',
        runId,
        data: 'cancelled',
        timestamp: now
      });

      return { ok: true, state: 'cancelled' };
    }

    if (run.status === 'running') {
      const cancelled = cancelExecution(runId);
      if (!cancelled) {
        return { ok: false, reason: 'not_stoppable' };
      }
      return { ok: true, state: 'cancelling' };
    }

    return { ok: false, reason: 'not_stoppable' };
  },
  pendingCount(): number {
    return queue.length + (running ? 1 : 0);
  }
};
