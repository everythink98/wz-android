import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { BrowserFetchIntent } from '../browserFetchIntent';
import type { DiagnosticTrace } from '../diagnostics';
import type { SiteSessionEvent } from '../siteSessionState';
import type { FeedSource, Source } from '../types';
import { appQueryClient } from './serverState';

export type BrowserFetchRequestCleanupTarget = {
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  settled?: boolean;
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };
export type NodeSeekVerificationRetry<TopicLike> =
  | { type: 'search'; retry: () => void }
  | { type: 'topic'; topic: TopicLike };
export type CredentialLoadOptions = {
  captureGeneration?: (generation: number) => void;
  captureNodeSeekUserId?: (userId: number | null) => void;
  diagnosticTrace?: DiagnosticTrace;
};
export type CredentialClearOptions = { generation?: number; force?: boolean; expiredMessage?: string };
export type CredentialWriteGate = {
  generation: number;
  queue: Promise<void>;
};

export type ForumQueryInvalidatingSessionEvent = Extract<SiteSessionEvent, {
  type: 'session-updated' | 'login-detected' | 'login-expired' | 'cleared';
}>;

export function siteSessionEventInvalidatesForumQueries(
  event: SiteSessionEvent
): event is ForumQueryInvalidatingSessionEvent {
  return event.type === 'session-updated'
    || event.type === 'login-detected'
    || event.type === 'login-expired'
    || event.type === 'cleared';
}

export function resetForumSourceQueries(
  source: Source,
  client: QueryClient = appQueryClient,
  preserveRecoveryQueryKey?: QueryKey
) {
  const preservedQuery = preserveRecoveryQueryKey
    ? client.getQueryCache().find({ queryKey: preserveRecoveryQueryKey, exact: true })
    : undefined;
  const canPreserve = Boolean(
    preservedQuery?.isActive()
    && preservedQuery.queryKey[0] === 'forum'
    && (preservedQuery.queryKey[1] === source || preservedQuery.queryKey[1] === 'all')
  );
  const affectedSources: FeedSource[] = [source, 'all'];
  for (const affectedSource of affectedSources) {
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) => (
        query.queryKey[0] === 'forum'
        && query.queryKey[1] === affectedSource
        && (!canPreserve || query !== preservedQuery)
      )
    };
    void client.cancelQueries(filters);
    client.removeQueries(filters);
  }
  return canPreserve;
}

export type BrowserFetchQueueRequest = BrowserFetchRequestCleanupTarget & {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
  browserFetchIntent?: BrowserFetchIntent;
  reject: (error: Error) => void;
};

type BrowserFetchRequestView = {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
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

export function takeNodeSeekVerificationRetry<TopicLike>(
  searchRetryRef: MutableRef<(() => void) | null>,
  topicRetryRef: MutableRef<TopicLike | null>
): NodeSeekVerificationRetry<TopicLike> | null {
  const retry = searchRetryRef.current;
  const topic = topicRetryRef.current;
  searchRetryRef.current = null;
  topicRetryRef.current = null;
  if (retry) {
    return { type: 'search', retry };
  }
  return topic ? { type: 'topic', topic } : null;
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
    return leftUrl.origin === rightUrl.origin
      && normalizeBrowserPath(leftUrl.pathname) === normalizeBrowserPath(rightUrl.pathname)
      && leftUrl.search === rightUrl.search;
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
    cookie: request.cookie,
    userAgent: request.userAgent
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
  const settled = settleBrowserFetchRequestOnce(request, () => request.reject(message instanceof Error ? message : new Error(message)));
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

export function shouldPreemptBrowserFetchRequest(
  active: BrowserFetchQueueRequest | null | undefined,
  incoming: BrowserFetchQueueRequest
) {
  if (!active || active.browserFetchIntent?.cancelable === false) {
    return false;
  }
  return browserFetchPriorityRank(incoming.browserFetchIntent) > browserFetchPriorityRank(active.browserFetchIntent);
}

export function shouldKeepQueuedBrowserFetchRequest(
  queued: BrowserFetchQueueRequest,
  incoming: BrowserFetchQueueRequest
) {
  if (queued.browserFetchIntent?.cancelable === false) {
    return true;
  }
  return browserFetchPriorityRank(queued.browserFetchIntent) > browserFetchPriorityRank(incoming.browserFetchIntent);
}

export function preemptActiveBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  currentRef,
  request,
  message,
  rejectCurrent
}: {
  currentRef: MutableRef<T | null>;
  request: T;
  message: string;
  rejectCurrent: (request: T, message: string) => void;
}) {
  const current = currentRef.current;
  if (!current || !shouldPreemptBrowserFetchRequest(current, request)) {
    return false;
  }
  rejectCurrent(current, message);
  return true;
}

export function enqueueLatestBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  queueRef,
  request,
  message,
  shouldKeepQueuedRequest
}: {
  queueRef: MutableRef<T[]>;
  request: T;
  message: string;
  shouldKeepQueuedRequest?: (queued: T, incoming: T) => boolean;
}) {
  const staleRequests = queueRef.current.splice(0);
  const keptRequests: T[] = [];
  for (const staleRequest of staleRequests) {
    if (shouldKeepQueuedRequest?.(staleRequest, request)) {
      keptRequests.push(staleRequest);
      continue;
    }
    settleBrowserFetchRequestOnce(staleRequest, () => staleRequest.reject(new Error(message)));
  }
  queueRef.current.push(...keptRequests);
  queueRef.current.push(request);
}

export async function runBestEffortTask(task: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(task).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createCredentialWriteGate(): CredentialWriteGate {
  return {
    generation: 0,
    queue: Promise.resolve()
  };
}

export function isCredentialWriteCurrent(gate: CredentialWriteGate, generation: number) {
  return gate.generation === generation;
}

export function nodeSeekMediaCookieHeaderAfterCredentialLoad({
  currentHeader,
  loadedHeader,
  generationIsCurrent
}: {
  currentHeader: string;
  loadedHeader?: string;
  generationIsCurrent: boolean;
}) {
  return generationIsCurrent ? loadedHeader || '' : currentHeader;
}

export function advanceCredentialWriteGeneration(gate: CredentialWriteGate) {
  gate.generation += 1;
  return gate.generation;
}

export function enqueueCredentialWrite<T>(
  gate: CredentialWriteGate,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T,
  { advanceGeneration = false }: { advanceGeneration?: boolean } = {}
) {
  const generation = advanceGeneration ? advanceCredentialWriteGeneration(gate) : gate.generation;
  return enqueueCredentialWriteForGeneration(gate, generation, task);
}

export function replaceCredentialWrite<T>(
  gate: CredentialWriteGate,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T
) {
  return enqueueCredentialWriteForGeneration(gate, advanceCredentialWriteGeneration(gate), task);
}

export function enqueueCredentialWriteForGeneration<T>(
  gate: CredentialWriteGate,
  generation: number,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T
) {
  const isCurrent = () => isCredentialWriteCurrent(gate, generation);
  const run = gate.queue
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrent()) {
        return undefined;
      }
      const result = await task({ isCurrent });
      return isCurrent() ? result : undefined;
    });
  gate.queue = run.then(() => undefined, () => undefined);
  return run;
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
