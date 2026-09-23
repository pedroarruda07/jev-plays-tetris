import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { buildJevRequest } from '../src/jev/request';
import { parseJevDecision } from '../src/jev/response';
import { isRecord, parseModelState, parsePlacements } from '../src/jev/validation';
import type { JevTrace } from '../src/jev/types';
import { JevApiClient, JevApiError } from './jev-client';

export const JEV_ROUTE = '/api/jev/decision';
const MAX_BODY_BYTES = 524_288;

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** A local API route shared by Vite dev and production preview. */
export function jevPlugin(apiKey: string, model: string): Plugin {
  const client = new JevApiClient(apiKey);
  const handler = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method !== 'POST') {
      json(response, 405, { error: 'Use POST.' });
      return;
    }
    if (request.headers.origin) {
      let originHost;
      try {
        originHost = new URL(request.headers.origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== request.headers.host) {
        json(response, 403, { error: 'Same-origin requests only.' });
        return;
      }
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      json(response, 415, { error: 'Expected application/json.' });
      return;
    }
    let state;
    let placements;
    let payload;
    let freezeWhileThinking;
    try {
      const body = await readBody(request);
      if (!isRecord(body) || typeof body.freezeWhileThinking !== 'boolean') {
        throw new Error('Expected state, freezeWhileThinking, and placements.');
      }
      state = parseModelState(body.state);
      placements = parsePlacements(body.placements);
      freezeWhileThinking = body.freezeWhileThinking;
      payload = buildJevRequest(state, model, freezeWhileThinking, placements);
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : 'Invalid model state.',
      });
      return;
    }
    const id = randomUUID();
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    console.info(`[Jev ${id}] REQUEST\n${JSON.stringify(payload, null, 2)}`);
    try {
      const raw = await client.evaluate(payload, controller.signal);
      // Raw responses include every returned probability, even if validation fails.
      console.info(`[Jev ${id}] RESPONSE\n${JSON.stringify(raw, null, 2)}`);
      const decision = parseJevDecision(
        raw,
        placements.map(({ id }) => id),
      );
      console.table(decision.probabilities);
      console.info(
        `[Jev ${id}] SELECTED ${decision.placementId} (confidence ${decision.confidence})`,
      );
      const trace: JevTrace = {
        id,
        request: payload,
        response: raw,
        decision,
        durationMs: performance.now() - started,
      };
      json(response, 200, trace);
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Jev request cancelled or timed out.'
        : error instanceof JevApiError
          ? error.message
          : 'Jev returned an invalid response or the connection failed.';
      console.error(`[Jev ${id}] ${message}`);
      json(response, controller.signal.aborted ? 504 : 502, { error: message });
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    name: 'jev-api',
    configureServer(server) {
      server.middlewares.use(JEV_ROUTE, (req, res) => {
        void handler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(JEV_ROUTE, (req, res) => {
        void handler(req, res);
      });
    },
  };
}
