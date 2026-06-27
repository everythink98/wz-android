export type BrowserFetchRequestCleanupTarget = {
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  settled?: boolean;
  deadlineMs?: number;
};

type MutableRef<T> = { current: T };
type WebViewStopRef = { current: { stopLoading: () => void } | null };
export type CredentialLoadOptions = { captureGeneration?: (generation: number) => void };
export type CredentialClearOptions = { generation?: number; force?: boolean };
export type CredentialWriteGate = {
  generation: number;
  queue: Promise<void>;
};

export type BrowserFetchQueueRequest = BrowserFetchRequestCleanupTarget & {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
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
  const headerValues: Record<string, string> = {
    'content-type': 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
  if (typeof Response !== 'undefined') {
    return new Response(html, {
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
    text: () => Promise.resolve(html)
  } as Response;
}

export function linuxDoBrowserResponse(body: string, challenge: boolean, httpErrorStatus?: number) {
  const status = challenge ? 403 : httpErrorStatus || 200;
  const isJson = /^\s*[{[]/.test(body);
  const headerValues: Record<string, string> = {
    'content-type': isJson ? 'application/json' : 'text/html'
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
  currentRef,
  queueRef,
  setActiveRequest,
  timeoutMs,
  timeoutMessage,
  rejectCurrent
}: {
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
    next = candidate;
    break;
  }
  if (next) {
    const timeoutDelay = typeof next.deadlineMs === 'number'
      ? Math.min(timeoutMs, next.deadlineMs - Date.now())
      : timeoutMs;
    if (timeoutDelay <= 0) {
      settleBrowserFetchRequestOnce(next, () => next.reject(new Error(timeoutMessage)));
      startNextBrowserFetchRequest({
        currentRef,
        queueRef,
        setActiveRequest,
        timeoutMs,
        timeoutMessage,
        rejectCurrent
      });
      return;
    }
    next.timeout = setTimeout(() => {
      rejectCurrent(next, timeoutMessage);
    }, timeoutDelay);
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
  webViewRef
}: {
  request: T;
  message: string;
  currentRef: MutableRef<T | null>;
  queueRef: MutableRef<T[]>;
  setActiveRequest: (request: BrowserFetchRequestView | null) => void;
  startNext: () => void;
  webViewRef?: WebViewStopRef;
}) {
  if (request.settled) {
    return;
  }
  const queuedIndex = queueRef.current.findIndex((item) => item.id === request.id);
  if (queuedIndex >= 0) {
    queueRef.current.splice(queuedIndex, 1);
  }
  if (currentRef.current?.id === request.id) {
    webViewRef?.current?.stopLoading();
    currentRef.current = null;
    setActiveRequest(null);
  }
  const settled = settleBrowserFetchRequestOnce(request, () => request.reject(new Error(message)));
  if (!settled) {
    return;
  }
  startNext();
}

export function enqueueLatestBrowserFetchRequest<T extends BrowserFetchQueueRequest>({
  queueRef,
  request,
  message
}: {
  queueRef: MutableRef<T[]>;
  request: T;
  message: string;
}) {
  const staleRequests = queueRef.current.splice(0);
  for (const staleRequest of staleRequests) {
    settleBrowserFetchRequestOnce(staleRequest, () => staleRequest.reject(new Error(message)));
  }
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
