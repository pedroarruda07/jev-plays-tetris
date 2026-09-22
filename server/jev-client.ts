import { setTimeout as delay } from 'node:timers/promises';
import type { JevRequest } from '../src/jev/types';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export class JevApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Credentials exist only in this server-side transport. */
export class JevApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async evaluate(request: JevRequest, signal: AbortSignal): Promise<unknown> {
    if (!this.apiKey)
      throw new JevApiError('Set JEV_API_KEY in .env and restart the server.', 503);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.http(JEV_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });
      if ((response.status === 429 || response.status === 529) && attempt < 2) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const waitMs = Number.isFinite(seconds)
          ? Math.min(10_000, Math.max(1_000, seconds * 1_000))
          : 1_000 * 2 ** attempt;
        await response.body?.cancel();
        console.warn(`[Jev] HTTP ${response.status}; retrying in ${waitMs}ms.`);
        await delay(waitMs, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const message =
          response.status === 401
            ? 'Jev rejected JEV_API_KEY. Check the key and restart the server.'
            : `TypeSafe AI returned HTTP ${response.status}.`;
        throw new JevApiError(message, response.status);
      }
      return response.json();
    }
    throw new JevApiError('Jev retry limit reached.', 503);
  }
}
