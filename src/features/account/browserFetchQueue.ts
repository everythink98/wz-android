import type { BrowserFetchIntent } from '@/platform/network/browserFetchIntent';

export type BrowserFetchQueueRequest = {
  id: number;
  url: string;
  userAgent?: string;
  browserFetchIntent?: BrowserFetchIntent;
  beforeSend?: () => void;
  abortSignal?: AbortSignal;
  httpErrorStatus?: number;
  reject: (error: Error) => void;
};

type BrowserFetchRequestView = {
  id: number;
  url: string;
  userAgent?: string;
  owner?: BrowserFetchIntent['owner'];
};

export function requestHeaderValue(headers: HeadersInit | undefined, name: string) {
  const target = name.toLowerCase();
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) || undefined;
  }
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === target);
    return pair ? String(pair[1]) : undefined;
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  return typeof value === 'string' ? value : undefined;
}

export function nodeSeekBrowserResponse(
  html: string,
  challenge: boolean,
  httpErrorStatus?: number,
  responseUrl?: string
) {
  const status = challenge ? 403 : httpErrorStatus || 200;
  const body = challenge ? '' : html;
  const headerValues: Record<string, string> = {
    'content-type': !challenge && /^\s*[{[]/.test(body) ? 'application/json' : 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
  if (typeof Response !== 'undefined') {
    const response = new Response(body, {
      status,
      headers: headerValues
    });
    if (responseUrl) {
      Object.defineProperty(response, 'url', { value: responseUrl });
    }
    return response;
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    url: responseUrl || '',
    headers: {
      get: (headerName: string) => headerValues[headerName.toLowerCase()] || null
    },
    text: () => Promise.resolve(body)
  } as Response;
}

export function linuxDoBrowserResponse(body: string, httpErrorStatus?: number) {
  const status = httpErrorStatus || 200;
  const isJson = /^\s*[{[]/.test(body);
  const headerValues: Record<string, string> = {
    'content-type': isJson ? 'application/json' : 'text/html'
  };
  if (typeof Response !== 'undefined') {
    return new Response(body, {
      status,
      headers: headerValues
    });
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (headerName: string) => headerValues[headerName.toLowerCase()] || null
    },
    text: () => Promise.resolve(body)
  } as Response;
}

export function shouldHandleBrowserHttpError(
  requestUrl: string,
  eventUrl: string | undefined,
  isAllowedUrl: (url: string) => boolean
) {
  const url = String(eventUrl || '').trim();
  if (!url) {
    return true;
  }
  if (sameBrowserDocumentUrl(requestUrl, url)) {
    return true;
  }
  return isAllowedUrl(url) && isLikelyBrowserDocumentUrl(url);
}

function sameBrowserDocumentUrl(left: string, right: string) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.origin === rightUrl.origin &&
      normalizeBrowserPath(leftUrl.pathname) === normalizeBrowserPath(rightUrl.pathname) &&
      leftUrl.search === rightUrl.search
    );
  } catch {
    return left === right;
  }
}

function normalizeBrowserPath(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

function isLikelyBrowserDocumentUrl(url: string) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').pop() || '';
    return !/\.[a-z0-9]{1,8}$/i.test(lastSegment);
  } catch {
    return false;
  }
}

function browserFetchRequestView(request: BrowserFetchQueueRequest): BrowserFetchRequestView {
  return {
    id: request.id,
    url: request.url,
    userAgent: request.userAgent,
    ...(request.browserFetchIntent ? { owner: request.browserFetchIntent.owner } : {})
  };
}

function browserFetchPriorityRank(intent: BrowserFetchIntent | undefined) {
  if (intent?.priority === 'write') return 3;
  if (intent?.priority === 'foreground') return 2;
  return 1;
}

type QueueEntry<T> = {
  request: T;
  timeout?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
};

type QueueSlot<T> =
  | { phase: 'idle' }
  | { phase: 'starting' | 'active'; entry: QueueEntry<T> }
  | { phase: 'settling' }
  | { phase: 'disposed' };

export function createBrowserFetchQueue<T extends BrowserFetchQueueRequest>({
  canStart,
  onActiveRequest,
  onQueued,
  onStarted,
  stopLoading,
  timeoutMs,
  timeoutMessage
}: {
  canStart: (request: Readonly<T>) => boolean;
  onActiveRequest: (request: BrowserFetchRequestView | null) => void;
  onQueued?: (request: Readonly<T>, queuedCount: number) => void;
  onStarted?: (request: Readonly<T>, queuedCount: number) => void;
  stopLoading: () => void;
  timeoutMs: number;
  timeoutMessage: string;
}) {
  let slot: QueueSlot<T> = { phase: 'idle' };
  let queued: QueueEntry<T>[] = [];
  const cleanup = (entry: QueueEntry<T>) => {
    if (entry.timeout !== undefined) clearTimeout(entry.timeout);
    if (entry.abortHandler) entry.request.abortSignal?.removeEventListener('abort', entry.abortHandler);
  };
  const startNext = (): void => {
    while (slot.phase === 'idle' && queued.length) {
      const entry = queued.shift();
      if (!entry) continue;
      const { request } = entry;
      const starting: QueueSlot<T> = { phase: 'starting', entry };
      slot = starting;
      try {
        if (request.abortSignal?.aborted || !canStart(request)) throw new Error('请求已取消');
        request.beforeSend?.();
      } catch (error) {
        if (slot === starting) {
          slot = { phase: 'idle' };
          cleanup(entry);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
        continue;
      }
      if (slot !== starting) continue;
      if (request.abortSignal?.aborted || !canStart(request)) {
        slot = { phase: 'idle' };
        cleanup(entry);
        request.reject(new Error('请求已取消'));
        continue;
      }
      slot = { phase: 'active', entry };
      entry.timeout = setTimeout(() => cancel(request.id, timeoutMessage), timeoutMs);
      onStarted?.(request, queued.length);
      if (slot.phase === 'active' && slot.entry === entry) onActiveRequest(browserFetchRequestView(request));
    }
  };
  const finish = (entry: QueueEntry<T>, settle: () => void, skipStopLoading: boolean): boolean => {
    if ((slot.phase === 'active' || slot.phase === 'starting') && slot.entry === entry) {
      const wasActive = slot.phase === 'active';
      // Native callbacks may reenter; hold the slot until the old renderer has stopped.
      const settling: QueueSlot<T> = { phase: 'settling' };
      slot = settling;
      cleanup(entry);
      try {
        if (wasActive && !skipStopLoading) stopLoading();
      } finally {
        try {
          if (wasActive && slot === settling) onActiveRequest(null);
        } finally {
          try {
            settle();
          } finally {
            if (slot === settling) {
              slot = { phase: 'idle' };
              startNext();
            }
          }
        }
      }
      return true;
    }
    const index = queued.indexOf(entry);
    if (index < 0) return false;
    queued.splice(index, 1);
    cleanup(entry);
    settle();
    startNext();
    return true;
  };
  const cancel = (id: number, message: string | Error, options: { skipStopLoading?: boolean } = {}): boolean => {
    const entry =
      (slot.phase === 'active' || slot.phase === 'starting') && slot.entry.request.id === id
        ? slot.entry
        : queued.find(({ request }) => request.id === id);
    if (!entry) return false;
    return finish(
      entry,
      () => entry.request.reject(message instanceof Error ? message : new Error(message)),
      options.skipStopLoading === true
    );
  };

  return {
    get active(): Readonly<BrowserFetchRequestView> | null {
      return slot.phase === 'active' ? browserFetchRequestView(slot.entry.request) : null;
    },
    enqueue(request: T) {
      if (slot.phase === 'disposed' || request.abortSignal?.aborted) {
        request.reject(new Error('请求已取消'));
        return;
      }
      const entry: QueueEntry<T> = { request };
      entry.abortHandler = () => cancel(request.id, '请求已取消');
      request.abortSignal?.addEventListener('abort', entry.abortHandler, { once: true });
      const rank = browserFetchPriorityRank(request.browserFetchIntent);
      const index = queued.findIndex(({ request: other }) => browserFetchPriorityRank(other.browserFetchIntent) < rank);
      if (index < 0) queued.push(entry);
      else queued.splice(index, 0, entry);
      onQueued?.(request, queued.length);
      startNext();
    },
    cancel,
    complete(id: number | undefined, settle: (request: Readonly<T>) => void) {
      if (slot.phase !== 'active' || slot.entry.request.id !== id) return false;
      const entry = slot.entry;
      return finish(
        entry,
        () => {
          try {
            settle(entry.request);
          } catch (error) {
            entry.request.reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        false
      );
    },
    markHttpError(id: number, status?: number) {
      if (slot.phase !== 'active' || slot.entry.request.id !== id) return;
      if (status === undefined) delete slot.entry.request.httpErrorStatus;
      else slot.entry.request.httpErrorStatus = status;
    },
    dispose() {
      const wasActive = slot.phase === 'active';
      const current = slot.phase === 'active' || slot.phase === 'starting' ? slot.entry : null;
      const entries = current ? [current, ...queued] : queued;
      slot = { phase: 'disposed' };
      queued = [];
      try {
        if (wasActive) stopLoading();
      } finally {
        for (const entry of entries) {
          cleanup(entry);
          entry.request.reject(new Error('请求已取消'));
        }
      }
    }
  };
}
