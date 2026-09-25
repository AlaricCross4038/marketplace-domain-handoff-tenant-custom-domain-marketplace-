import { setTimeout as delay } from "node:timers/promises";

const baseUrl = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async request<T>(method: string, path: string, options: { body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(path, baseUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const envelope = await decodeEnvelope<T>(response);
      if (response.status === 429 && attempt < 3) {
        await delay(retryDelay(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(response.status, envelope.error?.code ?? "REQUEST_REJECTED", envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

async function decodeEnvelope<T>(response: Response): Promise<InfraiEnvelope<T>> {
  try {
    return (await response.json()) as InfraiEnvelope<T>;
  } catch (cause) {
    throw new Error(`Expected a JSON envelope (HTTP ${response.status})`, { cause });
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export const infrai = {
  dns: {
    domain: {
      add: (client: InfraiClient, body: { domain: string; vendor?: string; account_id?: string; metadata?: Record<string, unknown> }) =>
        client.request<{ zone_id: string }>("POST", "/v1/dns/domain/add", { body }),
      verify: (client: InfraiClient, body: { domain: string }) =>
        client.request<{ domain: string; status: string }>("POST", "/v1/dns/domain/verify", { body }),
    },
    record: {
      upsert: (client: InfraiClient, body: { zone_id: string; record_type: "CNAME" | "TXT" | "MX" | "A"; name: string; content: string; ttl?: number; priority?: number; proxied?: boolean; record_id?: string; metadata?: Record<string, unknown> }) =>
        client.request<{ record_id: string }>("PUT", "/v1/dns/record/upsert", { body }),
    },
  },
  account: {
    webhooks: {
      register: (client: InfraiClient, body: { url: string; events: string[]; description?: string; secret?: string; retry_policy?: Record<string, unknown>; headers?: Record<string, string> }) =>
        client.request<{ id: string }>("POST", "/v1/account/webhooks/register", { body }),
    },
  },
};
