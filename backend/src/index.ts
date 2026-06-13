import http from 'node:http';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

const pinoHttpMiddleware = pinoHttp as unknown as (args: { logger: import('pino').Logger }) => import('express').RequestHandler;
import router from './routes.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { startLogHub } from './logHub.js';

const app = express();
app.use(pinoHttpMiddleware({ logger }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(router);

const server = http.createServer(app);
startLogHub(server);

server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'backend started');
});

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info({ signal }, 'graceful shutdown started');
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'failed to close http server');
      process.exit(1);
      return;
    }
    logger.info('shutdown complete');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

