import type { BrowserFetchIntent } from '@/platform/network/browserFetchIntent';

type BrowserFetchRequestCleanupTarget = {
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  settled?: boolean;
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };

export type BrowserFetchQueueRequest = BrowserFetchRequestCleanupTarget & {
  id: number;
  url: string;
  userAgent?: string;
  browserFetchIntent?: BrowserFetchIntent;
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

export function nodeSeekBrowserResponse(html: string, challenge: boolean, httpErrorStatus?: number) {
  const status = challenge ? 403 : httpErrorStatus || 200;
  const body = challenge ? '' : html;
  const headerValues: Record<string, string> = {
    'content-type': 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
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

export function settleBrowserFetchRequestOnce(request: BrowserFetchRequestCleanupTarget, settle: () => void) {
  if (request.settled) {
    return false;
  }
  request.settled = true;
  cleanupBrowserFetchRequest(request);
  settle();
  return true;
}

function browserFetchRequestView(request: BrowserFetchQueueRequest): BrowserFetchRequestView {
  return {
    id: request.id,
    url: request.url,
    userAgent: request.userAgent,
    ...(request.browserFetchIntent ? { owner: request.browserFetchIntent.owner } : {})
  };
}

export function startNextBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  canStart,
  currentRef,
  queueRef,
  setActiveRequest,
  timeoutMs,
  timeoutMessage,
  rejectCurrent
}: {
  canStart?: (request: T) => boolean;
  currentRef: MutableRef<T | null>;
  queueRef: MutableRef<T[]>;
  setActiveRequest: (request: BrowserFetchRequestView | null) => void;
  timeoutMs: number;
  timeoutMessage: string;
  rejectCurrent: (request: T, message: string) => void;
}) {
  if (currentRef.current) {
    return;
  }
  let next: T | null = null;
  while (queueRef.current.length) {
    const candidate = queueRef.current.shift() || null;
    if (!candidate) {
      continue;
    }
    if (candidate.abortSignal?.aborted) {
      settleBrowserFetchRequestOnce(candidate, () => candidate.reject(new Error('请求已取消')));
      continue;
    }
    if (canStart && !canStart(candidate)) {
      settleBrowserFetchRequestOnce(candidate, () => candidate.reject(new Error('请求已取消')));
      continue;
    }
    next = candidate;
    break;
  }
  if (next) {
    next.timeout = setTimeout(() => {
      rejectCurrent(next, timeoutMessage);
    }, timeoutMs);
  }
  currentRef.current = next;
  setActiveRequest(next ? browserFetchRequestView(next) : null);
}

export function rejectBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  request,
  message,
  currentRef,
  queueRef,
  setActiveRequest,
  startNext,
  webViewRef,
  skipStopLoading = false
}: {
  request: T;
  message: string | Error;
  currentRef: MutableRef<T | null>;
  queueRef: MutableRef<T[]>;
  setActiveRequest: (request: BrowserFetchRequestView | null) => void;
  startNext: () => void;
  webViewRef?: WebViewStopRef;
  skipStopLoading?: boolean;
}) {
  if (request.settled) {
    return;
  }
  const queuedIndex = queueRef.current.findIndex((item) => item.id === request.id);
  if (queuedIndex >= 0) {
    queueRef.current.splice(queuedIndex, 1);
  }
  if (currentRef.current?.id === request.id) {
    if (!skipStopLoading) {
      webViewRef?.current?.stopLoading();
    }
    currentRef.current = null;
    setActiveRequest(null);
  }
  const settled = settleBrowserFetchRequestOnce(request, () =>
    request.reject(message instanceof Error ? message : new Error(message))
  );
  if (!settled) {
    return;
  }
  startNext();
}

function browserFetchPriorityRank(intent: BrowserFetchIntent | undefined) {
  if (intent?.priority === 'write') {
    return 3;
  }
  if (intent?.priority === 'foreground') {
    return 2;
  }
  return 1;
}

export function enqueueBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  queueRef,
  request
}: {
  queueRef: MutableRef<T[]>;
  request: T;
}) {
  const requestPriority = browserFetchPriorityRank(request.browserFetchIntent);
  const insertionIndex = queueRef.current.findIndex(
    (queued) => browserFetchPriorityRank(queued.browserFetchIntent) < requestPriority
  );
  if (insertionIndex < 0) {
    queueRef.current.push(request);
    return;
  }
  queueRef.current.splice(insertionIndex, 0, request);
}

function cleanupBrowserFetchRequest(request: BrowserFetchRequestCleanupTarget) {
  if (request.timeout) {
    clearTimeout(request.timeout);
    request.timeout = undefined;
  }
  if (request.abortSignal && request.abortHandler) {
    request.abortSignal.removeEventListener('abort', request.abortHandler);
    request.abortHandler = undefined;
  }
}
