export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';
export const REQUEST_CANCELED_MESSAGE = '请求已取消';

export interface FetchWithTimeoutOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  {
    fetcher = fetch,
    signal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  }: FetchWithTimeoutOptions = {}
) {
  const controller = new AbortController();
  let timedOut = false;
  const signals = [init.signal, signal].filter(Boolean) as AbortSignal[];
  const abortFromParent = () => controller.abort();
  for (const item of signals) {
    if (item.aborted) {
      controller.abort();
      break;
    }
    item.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeout = timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : undefined;

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortLikeError(error) || controller.signal.aborted) {
      throw new Error(timedOut ? REQUEST_TIMEOUT_MESSAGE : REQUEST_CANCELED_MESSAGE);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    for (const item of signals) {
      item.removeEventListener('abort', abortFromParent);
    }
  }
}

function isAbortLikeError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}
