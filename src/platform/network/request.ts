export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export function rejectUnauthorizedResponse(fetcher: Fetcher): Fetcher {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (response.status !== 401) return response;
    throw Object.assign(new Error('登录状态已失效'), { status: 401, reason: 'http-401' });
  };
}

export function withFetchGuard(fetcher: Fetcher, assertCurrent: () => void | Promise<void>): Fetcher {
  return async (input, init) => {
    await assertCurrent();
    const response = await fetcher(input, init);
    await assertCurrent();
    return response;
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试';
export const REQUEST_CANCELED_MESSAGE = '请求已取消';
const REQUEST_TIMEOUT_CANCEL = Symbol.for('wz.requestTimeoutCancel');

export class RequestTimeoutError extends Error {
  readonly name = 'RequestTimeoutError';

  constructor() {
    super(REQUEST_TIMEOUT_MESSAGE);
  }
}

export class RequestCanceledError extends Error {
  readonly name = 'RequestCanceledError';

  constructor() {
    super(REQUEST_CANCELED_MESSAGE);
  }
}

type RequestInitWithTimeoutCancel = RequestInit & {
  [REQUEST_TIMEOUT_CANCEL]?: () => void;
};

export interface FetchWithTimeoutOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function scheduleRequestTimeout(callback: () => void, timeoutMs: number) {
  const timer = setTimeout(callback, timeoutMs);
  return () => clearTimeout(timer);
}

export function cancelRequestTimeoutForFallback(init: RequestInit | undefined) {
  (init as RequestInitWithTimeoutCancel | undefined)?.[REQUEST_TIMEOUT_CANCEL]?.();
}

export async function withAbortableTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  {
    signal,
    timeoutMs = 0,
    canceledError = () => new RequestCanceledError(),
    timeoutError = () => new RequestTimeoutError()
  }: {
    signal?: AbortSignal | null;
    timeoutMs?: number;
    canceledError?: () => Error;
    timeoutError?: () => Error;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let cancelTimeout: (() => void) | undefined;
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromParent, { once: true });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectAborted = () => reject(timedOut ? timeoutError() : canceledError());
    if (controller.signal.aborted) rejectAborted();
    else controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_resolve, reject) => {
          cancelTimeout = scheduleRequestTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(timeoutError());
          }, timeoutMs);
        })
      : undefined;
  try {
    const operation = Promise.resolve().then(() => run(controller.signal));
    return await Promise.race<T>(
      timeoutPromise ? [operation, abortPromise, timeoutPromise] : [operation, abortPromise]
    );
  } finally {
    cancelTimeout?.();
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  { fetcher = fetch, signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: FetchWithTimeoutOptions = {}
) {
  const controller = new AbortController();
  let timedOut = false;
  let cancelTimeout: (() => void) | undefined;
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
    const rejectAborted = () => reject(timedOut ? new RequestTimeoutError() : new RequestCanceledError());
    if (controller.signal.aborted) {
      rejectAborted();
      return;
    }
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_resolve, reject) => {
          cancelTimeout = scheduleRequestTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new RequestTimeoutError());
          }, timeoutMs);
        })
      : undefined;
  try {
    const fetchPromise = Promise.resolve()
      .then(() => {
        const requestInit: RequestInitWithTimeoutCancel = {
          ...init,
          credentials: 'include',
          signal: controller.signal,
          [REQUEST_TIMEOUT_CANCEL]: () => {
            cancelTimeout?.();
            cancelTimeout = undefined;
          }
        };
        return fetcher(input, requestInit);
      })
      .catch((error) => {
        if (isAbortLikeError(error) || controller.signal.aborted) {
          throw timedOut ? new RequestTimeoutError() : new RequestCanceledError();
        }
        throw error;
      });
    return await Promise.race(
      timeoutPromise ? [fetchPromise, abortPromise, timeoutPromise] : [fetchPromise, abortPromise]
    );
  } finally {
    cancelTimeout?.();
    for (const item of signals) {
      item.removeEventListener('abort', abortFromParent);
    }
  }
}

function isAbortLikeError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}
