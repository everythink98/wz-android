export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

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

type RequestInitWithTimeoutCancel = RequestInit & {
  [REQUEST_TIMEOUT_CANCEL]?: () => void;
};

export interface FetchWithTimeoutOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

let requestTimeoutsActive = true;
const requestTimeoutStateListeners = new Set<(active: boolean) => void>();

export function setRequestTimeoutsActive(active: boolean) {
  if (requestTimeoutsActive === active) {
    return;
  }
  requestTimeoutsActive = active;
  [...requestTimeoutStateListeners].forEach((listener) => listener(active));
}

export function scheduleRequestTimeout(callback: () => void, timeoutMs: number) {
  let remainingMs = timeoutMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canceled = false;

  const stopTimer = (subtractElapsed: boolean) => {
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    if (subtractElapsed) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    }
  };
  const schedule = () => {
    if (canceled || !requestTimeoutsActive || timer !== undefined) {
      return;
    }
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      canceled = true;
      requestTimeoutStateListeners.delete(handleActiveChange);
      callback();
    }, remainingMs);
  };
  const handleActiveChange = (active: boolean) => {
    if (active) {
      schedule();
    } else {
      stopTimer(true);
    }
  };

  requestTimeoutStateListeners.add(handleActiveChange);
  schedule();
  return () => {
    canceled = true;
    stopTimer(false);
    requestTimeoutStateListeners.delete(handleActiveChange);
  };
}

export function cancelRequestTimeoutForFallback(init: RequestInit | undefined) {
  (init as RequestInitWithTimeoutCancel | undefined)?.[REQUEST_TIMEOUT_CANCEL]?.();
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
    const rejectAborted = () => reject(new Error(timedOut ? REQUEST_TIMEOUT_MESSAGE : REQUEST_CANCELED_MESSAGE));
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
            reject(new Error(REQUEST_TIMEOUT_MESSAGE));
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
          throw new Error(timedOut ? REQUEST_TIMEOUT_MESSAGE : REQUEST_CANCELED_MESSAGE);
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
