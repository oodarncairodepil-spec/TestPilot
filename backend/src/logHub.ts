import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'node:http';
import { logger } from './logger.js';

type Message = {
  type: 'log' | 'status';
  runId: string;
  stream?: 'stdout' | 'stderr';
  data: string;
  timestamp: string;
};

const clientsByRun = new Map<string, Set<WebSocket>>();
const runBuffers = new Map<string, Message[]>();
const MAX_BUFFERED = 2000;

export const startLogHub = (server: Server): void => {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as { type: string; runId: string };
        if (payload.type !== 'subscribe' || !payload.runId) {
          return;
        }
        const set = clientsByRun.get(payload.runId) ?? new Set<WebSocket>();
        set.add(socket);
        clientsByRun.set(payload.runId, set);
        const buffered = runBuffers.get(payload.runId) ?? [];
        buffered.forEach((message) => {
          socket.send(JSON.stringify(message));
        });
      } catch (error) {
        logger.warn({ err: error }, 'invalid websocket payload');
      }
    });

    socket.on('close', () => {
      for (const set of clientsByRun.values()) {
        set.delete(socket);
      }
    });
  });
};

export const publishRunLog = (message: Message): void => {
  const buffered = runBuffers.get(message.runId) ?? [];
  buffered.push(message);
  if (buffered.length > MAX_BUFFERED) {
    buffered.splice(0, buffered.length - MAX_BUFFERED);
  }
  runBuffers.set(message.runId, buffered);
  const targets = clientsByRun.get(message.runId);
  targets?.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
};

export const getBufferedLogs = (runId: string): Message[] => runBuffers.get(runId) ?? [];

