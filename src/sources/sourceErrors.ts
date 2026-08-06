import type { FeedSource, SourceErrorInfo, SourceErrorKind, SourceErrors } from '@/domain/forum/models';
import { isCanceledRequest } from '@/platform/network/errors';

type LegacySourceErrorInfo = string | (Omit<SourceErrorInfo, 'kind'> & { kind?: SourceErrorKind });

const REPLY_COUNT_REFRESH_REQUIRED = 'reply-count-refresh-required';

export function replyCountRefreshRequiredError(message: string) {
  return Object.assign(new Error(message), { reason: REPLY_COUNT_REFRESH_REQUIRED });
}

export function isReplyCountRefreshRequired(error: unknown) {
  return errorProperty(error, 'reason') === REPLY_COUNT_REFRESH_REQUIRED;
}

function unknownErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '读取失败');
}

function errorProperty(error: unknown, key: 'reason' | 'source' | 'status' | 'statusCode') {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined;
}

function errorFlag(error: unknown, key: 'loginRequired' | 'verificationRequired') {
  return Boolean(error && typeof error === 'object' && (error as Record<string, unknown>)[key]);
}

function errorStatus(error: unknown) {
  const status = errorProperty(error, 'status') ?? errorProperty(error, 'statusCode');
  return typeof status === 'number' ? status : Number(status) || 0;
}

function classifiedKind(error: unknown): SourceErrorKind {
  if (error && typeof error === 'object' && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind;
    if (
      kind === 'login-required' ||
      kind === 'login-expired' ||
      kind === 'verification-required' ||
      kind === 'permission-denied' ||
      kind === 'ordinary'
    ) {
      return kind;
    }
  }
  const reason = errorProperty(error, 'reason');
  if (errorFlag(error, 'verificationRequired') || reason === 'cloudflare' || reason === 'verification') {
    return 'verification-required';
  }
  if (errorFlag(error, 'loginRequired')) {
    return reason === 'expired' ? 'login-expired' : 'login-required';
  }
  if (errorStatus(error) === 401) {
    return 'login-expired';
  }
  if (errorStatus(error) === 403) {
    return 'permission-denied';
  }
  return 'ordinary';
}

export function sourceErrorFromUnknown(source: FeedSource, error: unknown): SourceErrorInfo {
  const message = unknownErrorMessage(error);
  const reason = errorProperty(error, 'reason');
  const errorSource = errorProperty(error, 'source');
  const kind = classifiedKind(error);
  if (source === 'nodeseek' && errorSource === 'nodeseek' && reason === 'cloudflare') {
    return {
      message,
      kind,
      reason: 'cloudflare',
      verificationRequired: true
    };
  }
  return {
    message,
    kind,
    ...(errorFlag(error, 'loginRequired') ? { loginRequired: true } : {}),
    ...(kind === 'verification-required' ? { verificationRequired: true } : {})
  };
}

export function sourceReadRecoveryOutcome(
  source: FeedSource,
  error: unknown
): 'failed' | 'verification-required' | 'stale' {
  if (isCanceledRequest(error)) {
    return 'stale';
  }
  return sourceErrorFromUnknown(source, error).kind === 'verification-required' ? 'verification-required' : 'failed';
}

export function normalizeSourceErrorInfo(error?: SourceErrorInfo | LegacySourceErrorInfo): SourceErrorInfo | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return { message: error, kind: 'ordinary' };
  }
  return {
    ...error,
    kind: classifiedKind(error)
  };
}

export function sourceErrorMessage(error?: SourceErrorInfo | LegacySourceErrorInfo) {
  return normalizeSourceErrorInfo(error)?.message || '';
}

export function sourceErrorRequiresVerification(error?: SourceErrorInfo | LegacySourceErrorInfo) {
  return normalizeSourceErrorInfo(error)?.kind === 'verification-required';
}

export function yaohuoErrorRequiresLoginPanel(error?: SourceErrorInfo | LegacySourceErrorInfo) {
  const kind = sourceErrorKind(error);
  return kind === 'login-required' || kind === 'login-expired' || kind === 'verification-required';
}

export function sourceErrorKind(error?: SourceErrorInfo | LegacySourceErrorInfo): SourceErrorKind {
  return normalizeSourceErrorInfo(error)?.kind || 'ordinary';
}

export function formatSourceErrorMessages(errors: SourceErrors, sourceLabel: (source: FeedSource) => string) {
  return Object.entries(errors)
    .map(([sourceName, error]) => `${sourceLabel(sourceName as FeedSource)}：${sourceErrorMessage(error)}`)
    .join('；');
}

export function nodeSeekVerificationErrorMessage(errors: SourceErrors, fallback = 'NodeSeek 需要完成 Cloudflare 验证') {
  return sourceErrorRequiresVerification(errors.nodeseek) ? sourceErrorMessage(errors.nodeseek) || fallback : '';
}

export function nodeSeekVerificationNavigationMessage(source: FeedSource, errors: SourceErrors) {
  return source === 'all' ? '' : nodeSeekVerificationErrorMessage(errors);
}

export function linuxDoVerificationNavigationMessage(
  source: FeedSource,
  errors: SourceErrors,
  fallback = 'linux.do 需要完成 Cloudflare 验证'
) {
  return source === 'linuxdo' && sourceErrorRequiresVerification(errors.linuxdo)
    ? sourceErrorMessage(errors.linuxdo) || fallback
    : '';
}
