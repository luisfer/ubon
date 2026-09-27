/**
 * HTTP for registry and OSV lookups: Node's global fetch with timeouts, and
 * errors turned into short reasons for the "not checked" line. Only package
 * names and versions are ever sent.
 *
 * Proxies: Node's fetch honors HTTPS_PROXY and NO_PROXY only when Node runs
 * with NODE_USE_ENV_PROXY=1 (Node 22.21 and later); the reason for a network
 * error says so when HTTPS_PROXY is set without it. NODE_EXTRA_CA_CERTS is
 * read by Node at startup and applies to fetch without anything done here.
 */

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** A fetch-compatible function; tests pass a stub. */
export type HttpFetch = (url: string, init: HttpRequest) => Promise<HttpResponse>;

export const defaultFetch: HttpFetch = (url, init) => fetch(url, init as RequestInit);

export class LookupError extends Error {
  readonly kind: 'timeout' | 'network' | 'http' | 'parse';
  readonly status?: number;
  constructor(kind: LookupError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'LookupError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export interface JsonResult {
  status: number;
  /** Parsed body for 2xx responses; null otherwise. */
  data: unknown;
}

export interface RequestOptions extends HttpRequest {
  /** Per-request timeout, on top of the caller's signal. Default 10 s. */
  timeoutMs?: number;
  /** Refuse bodies larger than this (bytes). Default 64 MB. */
  maxBytes?: number;
}

const USER_AGENT = 'ubon (+https://github.com/luisfer/ubon)';

/**
 * Request JSON. Returns the status for any HTTP answer (so callers can tell a
 * 404 from a failure) and throws LookupError for timeouts, network errors, and
 * unreadable bodies.
 */
export async function requestJson(fetchFn: HttpFetch, url: string, options: RequestOptions = {}): Promise<JsonResult> {
  const signals = [AbortSignal.timeout(options.timeoutMs ?? 10_000)];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  const host = hostLabel(url);
  // Past the caller's deadline: do not start another request.
  if (signal.aborted) throw toLookupError(signal.reason, host, signal);
  let response: HttpResponse;
  try {
    response = await fetchFn(url, {
      method: options.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...options.headers },
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal,
    });
  } catch (error) {
    throw toLookupError(error, host, signal);
  }
  if (response.status < 200 || response.status >= 300) {
    // Drain small error bodies; the content is not used.
    try {
      await response.text();
    } catch {
      // ignore
    }
    return { status: response.status, data: null };
  }
  const length = Number(response.headers?.get('content-length') ?? '');
  const max = options.maxBytes ?? 64 * 1024 * 1024;
  if (Number.isFinite(length) && length > max) throw new LookupError('parse', `${host} sent a response larger than ${Math.round(max / 1024 / 1024)} MB`);
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw toLookupError(error, host, signal);
  }
  if (text.length > max) throw new LookupError('parse', `${host} sent a response larger than ${Math.round(max / 1024 / 1024)} MB`);
  try {
    return { status: response.status, data: JSON.parse(text) as unknown };
  } catch {
    throw new LookupError('parse', `${host} sent a response that is not JSON`);
  }
}

function toLookupError(error: unknown, host: string, signal: AbortSignal): LookupError {
  const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (signal.aborted || e?.name === 'TimeoutError' || e?.name === 'AbortError') return new LookupError('timeout', `${host} did not answer in time`);
  const code = e?.cause?.code ?? '';
  const detail = code ? ` (${code})` : '';
  return new LookupError('network', `${host} could not be reached${detail}${proxyHint()}`);
}

/** A short explanation when a proxy is configured in a way Node's fetch ignores. */
export function proxyHint(env: NodeJS.ProcessEnv = process.env): string {
  const proxy = env.HTTPS_PROXY ?? env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY === '1') return '';
  return '; HTTPS_PROXY is set, and Node uses it only when NODE_USE_ENV_PROXY=1';
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Describe a non-2xx status for the "not checked" line. */
export function statusReason(host: string, status: number): string {
  if (status === 401) return `${host} requires authentication (HTTP 401)`;
  if (status === 403) return `${host} refused the request (HTTP 403)`;
  if (status === 429) return `${host} is rate limiting requests (HTTP 429)`;
  return `${host} answered HTTP ${status}`;
}

/** Run tasks with at most `limit` in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
