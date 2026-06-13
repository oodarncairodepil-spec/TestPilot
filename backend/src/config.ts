import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: toNumber(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  dbPath: process.env.DATABASE_PATH ?? path.resolve('data', 'app.db'),
  scriptsDir: process.env.SCRIPTS_DIR ?? path.resolve('scripts'),
  artifactsDir: process.env.ARTIFACTS_DIR ?? path.resolve('artifacts'),
  workspacesDir: process.env.WORKSPACES_DIR ?? path.resolve('workspaces'),
  runnerImage: process.env.RUNNER_IMAGE ?? 'playwright-test-runner:local',
  maxRunMs: toNumber(process.env.MAX_RUN_MS, 10 * 60 * 1000),
  runCpuLimit: process.env.RUN_CPU_LIMIT ?? '2.0',
  runMemoryLimit: process.env.RUN_MEMORY_LIMIT ?? '2g',
  logLevel: process.env.LOG_LEVEL ?? 'info'
} as const;

