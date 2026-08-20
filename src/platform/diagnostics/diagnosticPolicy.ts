import { sessionSources, sourceValues as registeredSources } from '@/domain/forum/sourceCatalog';

export type DiagnosticArea =
  | 'app'
  | 'navigation'
  | 'feed'
  | 'search'
  | 'topic'
  | 'reply'
  | 'user'
  | 'source'
  | 'network'
  | 'session'
  | 'credential'
  | 'webview'
  | 'proxy'
  | 'reader-data'
  | 'backup'
  | 'update'
  | 'media'
  | 'diagnostic';

export type DiagnosticPhase =
  'intent' | 'guard' | 'credential' | 'transport' | 'parse' | 'apply' | 'persist' | 'rollback' | 'finish';

export type DiagnosticOutcome = 'success' | 'partial' | 'blocked' | 'noop' | 'canceled' | 'stale' | 'failure';

const DIAGNOSTIC_REASONS = [
  'canceled',
  'timeout',
  'login_required',
  'verification_required',
  'permission_denied',
  'network_error',
  'http_error',
  'invalid_response',
  'stale',
  'busy',
  'not_ready',
  'missing_credential',
  'storage_error',
  'parse_empty',
  'superseded',
  'duplicate',
  'unsupported',
  'share_unavailable',
  'renderer_gone',
  'refresh_failed',
  'source_disabled',
  'unknown'
] as const;

export type DiagnosticReason = (typeof DIAGNOSTIC_REASONS)[number];

export type DiagnosticScalar = string | number | boolean | null;

export type DiagnosticFields = Readonly<Record<string, DiagnosticScalar>>;

export type DiagnosticWriter = (line: string) => void | Promise<void>;

export type DiagnosticFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiagnosticEvent {
  schemaVersion: 1;
  time: string;
  appSessionId: string;
  traceId: string;
  area: DiagnosticArea;
  operation: string;
  phase: DiagnosticPhase;
  outcome: DiagnosticOutcome;
  durationMs: number;
  [key: string]: DiagnosticScalar | undefined;
}

export interface DiagnosticTrace {
  readonly appSessionId: string;
  readonly traceId: string;
  readonly area: DiagnosticArea;
  readonly operation: string;
  readonly startedAt: number;
}

const stringFieldKeys = new Set([
  'source',
  'site',
  'endpoint',
  'method',
  'contentType',
  'reason',
  'variant',
  'channel',
  'state',
  'previousState',
  'nextState',
  'owner',
  'priority',
  'store',
  'provider',
  'route',
  'routeKind',
  'emptyReason',
  'mutationReason',
  'action',
  'mode',
  'flow',
  'requestType',
  'credentialSource',
  'parserVariant',
  'transport',
  'kind',
  'screen',
  'section',
  'surface',
  'mediaClass',
  'fallback',
  'terminalReason',
  'protocol',
  'eventType',
  'result',
  'level',
  'queueState',
  'csrfSource',
  'userAgentSource',
  'errorName',
  'message',
  'stack',
  'topicRef',
  'userRef',
  'cursorRef',
  'mediaRef',
  'mediaRole',
  'candidateKind',
  'cacheType',
  'replyOrder',
  'positionKind',
  'navigationClass',
  'navigationHost',
  'navigationPath',
  'navigationParamKeys'
]);

const closedValues = (...values: string[]) => new Set(values);

const operationValues = closedValues(
  'apply',
  'attendance',
  'auth',
  'bookmark',
  'browser-fetch',
  'categories',
  'check',
  'collection',
  'cookie-store-read',
  'clear',
  'clear-login-only',
  'delete',
  'download',
  'edit',
  'export',
  'favorite',
  'getCategories',
  'getEmojiUrls',
  'getFeed',
  'getLevelProfile',
  'getReplies',
  'getReply',
  'getTopic',
  'getUserProfile',
  'guard',
  'hardware-back',
  'image-upload',
  'import',
  'interaction',
  'js-error',
  'load',
  'load-more',
  'load-more-replies',
  'load-more-topics',
  'load-stored',
  'load-summary',
  'mutate',
  'open',
  'page-state',
  'parse-topic',
  'recover',
  'refresh',
  'replace',
  'request',
  'resolveUser',
  'restore-webview',
  'rotate-read-runtime',
  'run',
  'save',
  'save-image',
  'save-preview',
  'screen-change',
  'searchSemanticTopics',
  'searchTagOptions',
  'searchTopics',
  'searchUserOptions',
  'set-enabled',
  'state-transition',
  'submit',
  'test',
  'toggle-quote',
  'topic-body-media',
  'topic-back',
  'transport-fallback',
  'uncaught-error',
  'user-back',
  'vote',
  'webview-transport'
);

const sourceValues = closedValues('all', ...registeredSources, 'unknown');

const screenValues = closedValues('feed', 'library', 'more', 'search', 'topic', 'user', 'unknown');

const sessionStateValues = closedValues(
  'anonymous',
  'expired',
  'logged-in',
  'verification-required',
  'verified',
  'verifying',
  'authorizing'
);

const stateValues = closedValues(
  ...sessionStateValues,
  'active',
  'applied',
  'applying',
  'body-ready',
  'busy',
  'cache-unavailable',
  'cached-detail-reused',
  'cached-quote',
  'canceled',
  'cleared',
  'collapsed',
  'complete',
  'confirmed',
  'content-plan-ready',
  'connect-finished',
  'connect-started',
  'current',
  'disabled',
  'document-picker',
  'empty',
  'empty-preview',
  'error',
  'failed',
  'failure',
  'fallback',
  'feed-return',
  'file-readable',
  'finish',
  'image-auth-panel-closed',
  'image-preview-closed',
  'incomplete-user',
  'initial',
  'installer-opened',
  'linuxdo-panel-closed',
  'load',
  'load-more',
  'loaded',
  'loading',
  'local',
  'login-cleared',
  'login-panel-closed',
  'media-library',
  'media-library-start',
  'merge-started',
  'missing-cursor',
  'missing-group',
  'missing-query',
  'missing-snapshot',
  'missing-topic',
  'missing-update',
  'missing-user',
  'native-back',
  'network-ready',
  'no-next-page',
  'not-loaded',
  'not-required',
  'open',
  'optimistic',
  'package-verification',
  'pending',
  'persisted',
  'queued',
  'quote-expanded',
  'ready',
  'recovery-mode',
  'refresh',
  'refresh-blocked',
  'refresh-canceled',
  'refresh-failure',
  'refresh-noop',
  'refresh-partial',
  'refresh-stale',
  'refresh-success',
  'refreshed',
  'reply-composer-closed',
  'reset',
  'restored',
  'retry',
  'return-screen',
  'route-restored',
  'same-screen',
  'same-topic',
  'saved',
  'session-check',
  'session-expired',
  'session-reused',
  'settings-panel-closed',
  'share-completed',
  'snapshot-restored',
  'source-parsed',
  'start',
  'started',
  'status-updated',
  'success',
  'summary',
  'system-back',
  'temporary-file',
  'topic-back',
  'topic-refresh-delegated',
  'topic-reload-scheduled',
  'topic-restore-scheduled',
  'topic-restored',
  'topic-route-activated',
  'topic-route-restored',
  'unconfirmed',
  'key-saved',
  'timeout',
  'unsupported-source',
  'update-available',
  'user-back',
  'waiting-for-save',
  'yaohuo-panel-closed'
);

const requestTypeValues = closedValues(
  'attendance',
  'bookmark',
  'collection',
  'delete',
  'edit',
  'favorite',
  'image-upload',
  'interaction',
  'reply',
  'unknown',
  'vote'
);

const mutationReasonValues = closedValues(
  'backup-imported',
  'favorite-toggled',
  'follow-removed',
  'follow-toggled',
  'history-cleared',
  'history-recorded',
  'library-topic-removed',
  'settings-updated',
  'unknown'
);

const parserVariantValues = closedValues(
  'access-restricted-topic',
  'aggregate-categories',
  'aggregate-feed',
  'aggregate-search',
  'api-categories',
  'api-latest-feed',
  'api-topic',
  'api-topic-fallback',
  'api-user',
  'api-user-basic',
  'atom-user-topics',
  'discourse-categories',
  'discourse-feed',
  'discourse-replies',
  'discourse-search',
  'discourse-search-page',
  'discourse-ai-search',
  'discourse-topic',
  'discourse-user',
  'embedded-categories',
  'embedded-list',
  'embedded-replies',
  'embedded-reply',
  'embedded-topic',
  'fetched-reply',
  'google-search',
  'html-all-feed',
  'html-hot-feed',
  'html-latest-feed',
  'html-list',
  'html-replies',
  'html-search',
  'html-topic',
  'html-topic-fallback',
  'html-topic-with-replies',
  'html-user',
  'html-user-replies',
  'html-user-topics',
  'html-window-feed',
  'multi-page-replies',
  'rendered-categories',
  'rendered-list',
  'rendered-replies',
  'rendered-search',
  'rendered-topic',
  'search-empty-query',
  'sov2ex-search',
  'static-categories',
  'unsupported-replies'
);

const categoricalFieldValues: Readonly<Record<string, ReadonlySet<string>>> = {
  source: sourceValues,
  site: closedValues(...sessionSources),
  variant: parserVariantValues,
  channel: closedValues('data', 'direct', 'managed', 'native', 'remote', 'unsupported', 'webview'),
  state: stateValues,
  previousState: closedValues(...screenValues, ...sessionStateValues),
  nextState: closedValues(...screenValues, ...sessionStateValues),
  owner: closedValues('account', 'feed', 'search', 'topic', 'user', 'write'),
  priority: closedValues('background', 'foreground', 'write'),
  store: closedValues('android-webview', 'cookie-manager', 'multi-store', 'secure-store'),
  provider: closedValues('document-picker', 'file-system', 'media-library', 'sharing'),
  route: screenValues,
  routeKind: closedValues('stack', 'tab'),
  emptyReason: closedValues(
    'load-failed',
    'loading',
    'no-items',
    'no-replies',
    'no-results',
    'no-topic',
    'no-user',
    'none',
    'not-loaded',
    'not-started',
    'source-error'
  ),
  mutationReason: mutationReasonValues,
  action: closedValues('bookmark', 'collection', 'dislike', 'like', 'nodeseek-verification', 'upvote', 'yaohuo-login'),
  mode: closedValues('add', 'after-submit', 'manual', 'open', 'refresh', 'remove', 'silent'),
  flow: closedValues('background', 'foreground', 'write'),
  requestType: requestTypeValues,
  credentialSource: closedValues('nodeimage', 'none', 'secure-store'),
  parserVariant: parserVariantValues,
  transport: closedValues('direct', 'managed', 'native', 'webview'),
  kind: closedValues(
    'action-required',
    'failed',
    'login-expired',
    'login-required',
    'ordinary',
    'permission-denied',
    'success',
    'verification-required'
  ),
  screen: screenValues,
  section: closedValues('favorites', 'history', 'replies', 'topics', 'users'),
  surface: closedValues('body', 'preview'),
  mediaRole: closedValues('body', 'preview-active', 'preview-adjacent'),
  candidateKind: closedValues('src', 'srcset', 'data-src', 'data-original', 'lightbox'),
  cacheType: closedValues('none', 'disk', 'memory'),
  replyOrder: closedValues('oldest', 'newest'),
  positionKind: closedValues('start', 'cursor', 'target'),
  navigationClass: closedValues('access-trouble', 'captcha', 'consent', 'login', 'unknown-google'),
  mediaClass: closedValues('same-source', 'cross-source', 'unmanaged', 'data'),
  fallback: closedValues('none', 'svg'),
  terminalReason: closedValues('loaded', 'fallback-loaded', 'native-error', 'fallback-error', 'stale', 'timeout'),
  protocol: closedValues('http', 'socks5'),
  eventType: closedValues(
    'authorization-started',
    'check-failed',
    'cleared',
    'cookie-loaded',
    'login-expired',
    'recovery-failed',
    'session-updated',
    'verification-required',
    'verification-started'
  ),
  result: closedValues('blocked', 'canceled', 'failure', 'noop', 'partial', 'stale', 'success'),
  level: closedValues('debug', 'error', 'info', 'warning'),
  queueState: closedValues('active', 'idle', 'queued'),
  csrfSource: closedValues('local-generated', 'none', 'session-endpoint'),
  userAgentSource: closedValues('default', 'stored', 'webview')
};

const reasonValues = new Set<string>(DIAGNOSTIC_REASONS);

const errorNameValues = closedValues(
  'AbortError',
  'AggregateError',
  'DOMException',
  'Error',
  'EvalError',
  'Invariant Violation',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError'
);

const endpointValues = closedValues(
  'action',
  'auth',
  'categories',
  'external',
  'feed',
  'github',
  'other',
  'relative',
  'replies',
  'search',
  'topic',
  'unknown',
  'update',
  'upload',
  'user'
);

const contentTypeValues = closedValues(
  'application/json',
  'application/xml',
  'binary',
  'image',
  'other',
  'text/html',
  'text/plain',
  'unknown'
);

const numberFieldKeys = new Set([
  'status',
  'byteCount',
  'count',
  'before',
  'after',
  'itemCount',
  'candidateCount',
  'validCount',
  'droppedCount',
  'partialErrorCount',
  'beforeCount',
  'afterCount',
  'missingFloorCount',
  'missingTitleCount',
  'selectedCount',
  'selectedOptionCount',
  'contentLength',
  'page',
  'resolvedPage',
  'generation',
  'iteration',
  'queueLength',
  'queuedCount',
  'runningCount',
  'replyCount',
  'topicCount',
  'floor',
  'attempt',
  'latencyMs',
  'timeoutMs',
  'transportDurationMs',
  'screenWidth',
  'screenHeight',
  'fontScale',
  'firstProgressMs',
  'loadMs',
  'displayMs',
  'loadedBytes',
  'totalBytes',
  'sourceWidth',
  'sourceHeight',
  'catalogReadyElapsedMs',
  'firstMediaElapsedMs',
  'firstRowElapsedMs',
  'plannedRowCount',
  'networkMediaCount',
  'warmHighWater',
  'runningHighWater',
  'timerHighWater',
  'timeoutCount',
  'cancelCount',
  'errorCount',
  'displayCount',
  'retryCount'
]);

const reservedFieldKeys = new Set([
  'schemaVersion',
  'time',
  'appSessionId',
  'traceId',
  'area',
  'operation',
  'phase',
  'outcome',
  'durationMs'
]);

export function diagnosticRef(kind: string, raw: unknown) {
  return referenceFor(kind, raw);
}

export function linkDiagnosticRefs(kind: string, rawValues: readonly unknown[]) {
  const safeKind = kind === 'topic' || kind === 'user' || kind === 'cursor' || kind === 'media' ? kind : 'ref';
  const values = [
    ...new Set(
      rawValues.filter(
        (raw): raw is string | number | boolean | null =>
          raw === null || ['string', 'number', 'boolean'].includes(typeof raw)
      )
    )
  ];
  if (values.length === 0) {
    return `${safeKind}-0`;
  }
  let refs = referenceMaps.get(safeKind);
  if (!refs) {
    refs = new Map();
    referenceMaps.set(safeKind, refs);
  }
  let linkedRef = '';
  for (const value of values) {
    linkedRef = readReferenceMapping(refs, value) || '';
    if (linkedRef) {
      break;
    }
  }
  linkedRef ||= nextReference(safeKind);
  values.forEach((value) => rememberReferenceMapping(refs, value, linkedRef));
  rememberIssuedReference(safeKind, linkedRef);
  return linkedRef;
}

export function normalizeDiagnosticReason(error: unknown): DiagnosticReason {
  const typedReason =
    error && typeof error === 'object' && typeof (error as { reason?: unknown }).reason === 'string'
      ? (error as { reason: string }).reason
      : '';
  if (typedReason === 'parse_empty') {
    return 'parse_empty';
  }
  if (typedReason === 'source-disabled') {
    return 'source_disabled';
  }
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : typeof error === 'string'
        ? error.toLowerCase()
        : '';
  if (/abort|cancel|取消/.test(text)) return 'canceled';
  if (/timeout|timed out|超时/.test(text)) return 'timeout';
  if (/captcha|challenge|verification|cloudflare|人机|验证/.test(text)) return 'verification_required';
  if (/unauthori[sz]ed|unauthenticated|login required|not logged|\b401\b|登录/.test(text)) return 'login_required';
  if (/forbidden|permission|\b403\b|权限|无权/.test(text)) return 'permission_denied';
  if (/renderer.*gone|render process gone|渲染进程/.test(text)) return 'renderer_gone';
  if (/share.*(?:not available|unavailable)|无法分享|不支持分享/.test(text)) return 'share_unavailable';
  if (/refresh failed|刷新失败/.test(text)) return 'refresh_failed';
  if (/too large|file size|文件过大|大小无法确认|文件不存在/.test(text))
    return /too large|文件过大/.test(text) ? 'invalid_response' : 'storage_error';
  if (/incompatible|unsupported version|格式不兼容|版本不兼容/.test(text)) return 'invalid_response';
  if (/storage|filesystem|file system|disk|asyncstorage|存储|磁盘/.test(text)) return 'storage_error';
  if (/missing.*(?:credential|cookie|auth)|(?:credential|cookie).*missing|缺少.*(?:凭据|登录态)/.test(text))
    return 'missing_credential';
  if (/parsed?.*(?:empty|no items)|empty.*parse|解析为空|未解析到/.test(text)) return 'parse_empty';
  if (/\bbusy\b|already in progress|正在处理/.test(text)) return 'busy';
  if (/not ready|尚未.*完成|未就绪/.test(text)) return 'not_ready';
  if (/duplicate|重复请求|重复操作/.test(text)) return 'duplicate';
  if (/not supported|unsupported|不支持/.test(text)) return 'unsupported';
  if (/stale|outdated|旧请求/.test(text)) return 'stale';
  if (/superseded|replaced by newer|已被替代/.test(text)) return 'superseded';
  if (/syntaxerror|invalid response|unexpected token|malformed|\bjson\b|\bparse\b|解析|响应格式/.test(text))
    return 'invalid_response';
  if (/network request failed|failed to fetch|\bnetwork\b|\bdns\b|\bsocket\b|网络|连接失败/.test(text))
    return 'network_error';
  if (/\bhttp\b.*\b[45]\d\d\b|\bstatus\b.*\b[45]\d\d\b/.test(text)) return 'http_error';
  return 'unknown';
}

export function sanitizeErrorStack(stack: string, errorName: string) {
  const frames = stack
    .split(/\r?\n/)
    .slice(1, 25)
    .filter((line) => /^\s*at\s+/.test(line))
    .map((line) => {
      const location = line.match(/:(\d{1,9}):(\d{1,9})\)?\s*$/);
      return location ? `    at [frame] ([bundle]:${location[1]}:${location[2]})` : '    at [frame]';
    });
  return [safeErrorName(errorName), ...frames].join('\n');
}

export function safeFields(fields: DiagnosticFields) {
  const safe: Record<string, DiagnosticScalar> = {};
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (count >= 24 || reservedFieldKeys.has(key)) continue;
    if (typeof value === 'string' && stringFieldKeys.has(key)) {
      safe[key] = safeStringField(key, value);
      count += 1;
    } else if (typeof value === 'number' && Number.isFinite(value) && numberFieldKeys.has(key)) {
      safe[key] = value;
      count += 1;
    } else if (
      typeof value === 'boolean' &&
      /^(?:has|is|can|did|was|should|server|local|refresh|save|message|fresh|native|apiKey|markup)[A-Z]/.test(key)
    ) {
      safe[key] = value;
      count += 1;
    }
  }
  return safe;
}

const RAW_REFERENCE_LIMIT = 4_096;

const ISSUED_REFERENCE_LIMIT = 8_192;

const referenceMaps = new Map<string, Map<string | number | boolean | null, string>>();

const issuedReferences = new Map<string, Set<string>>();

const referenceSequences = new Map<string, number>();

function nextReference(kind: string) {
  const sequence = (referenceSequences.get(kind) || 0) + 1;
  referenceSequences.set(kind, sequence);
  return `${kind}-${sequence}`;
}

function readReferenceMapping(
  refs: Map<string | number | boolean | null, string>,
  value: string | number | boolean | null
) {
  const reference = refs.get(value);
  if (reference) {
    refs.delete(value);
    refs.set(value, reference);
  }
  return reference;
}

function rememberReferenceMapping(
  refs: Map<string | number | boolean | null, string>,
  value: string | number | boolean | null,
  reference: string
) {
  refs.delete(value);
  refs.set(value, reference);
  if (refs.size > RAW_REFERENCE_LIMIT) {
    refs.delete(refs.keys().next().value!);
  }
}

function rememberIssuedReference(kind: string, reference: string) {
  const issued = issuedReferences.get(kind) || new Set<string>();
  issued.delete(reference);
  issued.add(reference);
  if (issued.size > ISSUED_REFERENCE_LIMIT) {
    issued.delete(issued.values().next().value!);
  }
  issuedReferences.set(kind, issued);
}

function referenceFor(kind: string, raw: unknown) {
  const safeKind = kind === 'topic' || kind === 'user' || kind === 'cursor' || kind === 'media' ? kind : 'ref';
  if (raw !== null && !['string', 'number', 'boolean'].includes(typeof raw)) {
    return `${safeKind}-0`;
  }
  const value = raw as string | number | boolean | null;
  let refs = referenceMaps.get(safeKind);
  if (!refs) {
    refs = new Map();
    referenceMaps.set(safeKind, refs);
  }
  const current = readReferenceMapping(refs, value);
  if (current) {
    rememberIssuedReference(safeKind, current);
    return current;
  }
  const next = nextReference(safeKind);
  rememberReferenceMapping(refs, value, next);
  rememberIssuedReference(safeKind, next);
  return next;
}

function safeStringField(key: string, value: string) {
  if (key === 'endpoint') return endpointClass(value);
  if (key === 'method') return safeMethod(value);
  if (key === 'contentType') return safeContentType(value) || 'unknown';
  if (key === 'reason' || key === 'message') return reasonValues.has(value) ? value : 'unknown';
  if (key === 'errorName') return safeErrorName(value);
  if (key === 'stack') return safeStack(value);
  if (key === 'topicRef') return safeReference(value, 'topic');
  if (key === 'userRef') return safeReference(value, 'user');
  if (key === 'cursorRef') return safeReference(value, 'cursor');
  if (key === 'mediaRef') return safeReference(value, 'media');
  if (key === 'navigationHost') {
    return closedValues('www.google.com', 'consent.google.com', 'accounts.google.com').has(value) ? value : 'redacted';
  }
  if (key === 'navigationPath') {
    return /^\/[a-z0-9._~/-]{0,127}$/i.test(value) && !value.includes('//') ? value : 'redacted';
  }
  if (key === 'navigationParamKeys') {
    const keys = value === 'none' ? [] : value.split(',');
    return value === 'none' || (keys.length <= 16 && keys.every((item) => /^[a-z][a-z0-9_]{0,31}$/i.test(item)))
      ? value
      : 'redacted';
  }
  return categoricalFieldValues[key]?.has(value) ? value : 'redacted';
}

function safeErrorName(value: string) {
  return errorNameValues.has(value) ? value : 'Error';
}

function safeStack(value: string) {
  const lines = value.split('\n');
  if (
    value.length > 2_048 ||
    !errorNameValues.has(lines[0] || '') ||
    lines.length > 25 ||
    lines.slice(1).some((line) => !/^    at \[frame\](?: \(\[bundle\]:\d{1,9}:\d{1,9}\))?$/.test(line))
  ) {
    return 'redacted';
  }
  return value;
}

function safeReference(value: string, kind: 'topic' | 'user' | 'cursor' | 'media') {
  return issuedReferences.get(kind)?.has(value) ? value : 'redacted';
}

function endpointTypeFromPath(pathname: string, method?: string) {
  const path = pathname.toLowerCase();
  const requestMethod = safeMethod(method);
  if (/upload|nodeimage|image/.test(path)) return 'upload';
  if (/login|signin|session|csrf|challenge|captcha|auth|user-api-key/.test(path)) return 'auth';
  if (requestMethod !== 'GET' && requestMethod !== 'HEAD' && requestMethod !== 'OPTIONS') return 'action';
  if (/search|sov2ex|google/.test(path)) return 'search';
  if (/categor|\/nodes?(?:\/|$)|\/site\.json$|board/.test(path)) return 'categories';
  if (/userinfo|\/users?(?:\/|$)|\/u(?:\/|$)|\/members?(?:\/|$)|profile|current-user|account\/getinfo/.test(path))
    return 'user';
  if (/repl|comment|\/posts?(?:\/|$)|book_re/.test(path)) return 'replies';
  if (/topic|\/t(?:\/|$)|book_view|discussion/.test(path)) return 'topic';
  if (path === '/' || /latest|newest|recent|\/hot(?:\/|$)|\/feed(?:\/|$)|\/list(?:\/|$)/.test(path)) return 'feed';
  return 'other';
}

export function endpointClass(value: string, method?: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host.includes('nodeimage')) return 'upload';
    if (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com'))
      return 'update';
    if (
      host === 'linux.do' ||
      host.endsWith('.linux.do') ||
      host === 'nodeseek.com' ||
      host.endsWith('.nodeseek.com') ||
      host === 'v2ex.com' ||
      host.endsWith('.v2ex.com') ||
      host === 'yaohuo.me' ||
      host.endsWith('.yaohuo.me')
    ) {
      return endpointTypeFromPath(url.pathname, method);
    }
    return 'external';
  } catch {
    if (value.startsWith('/')) return endpointTypeFromPath(value.split(/[?#]/, 1)[0], method);
    const classified = value.trim().toLowerCase();
    return endpointValues.has(classified) ? classified : 'unknown';
  }
}

export function safeMethod(value?: string) {
  const method = String(value || 'GET')
    .trim()
    .toUpperCase();
  return /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? method : 'OTHER';
}

export function safeContentType(value: string | null) {
  const contentType = String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentTypeValues.has(contentType)) return contentType;
  if (/^(?:application|text)\/(?:[a-z0-9.+-]+\+)?json$/.test(contentType)) return 'application/json';
  if (/^(?:application|text)\/(?:[a-z0-9.+-]+\+)?xml$/.test(contentType)) return 'application/xml';
  if (contentType === 'application/octet-stream') return 'binary';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('text/')) return 'text/plain';
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)) return 'other';
  return undefined;
}

export function safeByteCount(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

export function safeDiagnosticOperation(operation: string) {
  return operationValues.has(operation) ? operation : 'unknown';
}
