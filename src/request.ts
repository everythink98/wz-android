export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';
export const REQUEST_CANCELED_MESSAGE = '请求已取消';
export const REQUEST_SUPERSEDED_MESSAGE = '请求已被新请求替代';

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
  let abortTimeout: ReturnType<typeof setTimeout> | undefined;
  const signals = [init.signal, signal].filter(Boolean) as AbortSignal[];
  const abortFromParent = () => controller.abort();
  for (const item of signals) {
    if (item.aborted) {
      controller.abort();
      break;
    }
    item.addEventListener('abort', abortFromParent, { once: true });
  }

  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectAborted = () => reject(new Error(timedOut ? REQUEST_TIMEOUT_MESSAGE : REQUEST_CANCELED_MESSAGE));
    if (controller.signal.aborted) {
      rejectAborted();
      return;
    }
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  const timeoutPromise = timeoutMs > 0
    ? new Promise<never>((_resolve, reject) => {
      abortTimeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
        reject(new Error(REQUEST_TIMEOUT_MESSAGE));
      }, timeoutMs);
    })
    : undefined;
  try {
    const fetchPromise = Promise.resolve()
      .then(() => fetcher(input, { ...init, signal: controller.signal }))
      .catch((error) => {
        if (isAbortLikeError(error) || controller.signal.aborted) {
          throw new Error(timedOut ? REQUEST_TIMEOUT_MESSAGE : REQUEST_CANCELED_MESSAGE);
        }
        throw error;
      });
    return await Promise.race(timeoutPromise ? [fetchPromise, abortPromise, timeoutPromise] : [fetchPromise, abortPromise]);
  } finally {
    if (abortTimeout) {
      clearTimeout(abortTimeout);
    }
    for (const item of signals) {
      item.removeEventListener('abort', abortFromParent);
    }
  }
}

function isAbortLikeError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}
