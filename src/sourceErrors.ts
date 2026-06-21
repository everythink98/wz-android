import type { FeedSource, SourceErrorInfo, SourceErrors } from './types';

function unknownErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '读取失败');
}

function errorProperty(error: unknown, key: 'reason' | 'source') {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined;
}

export function sourceErrorFromUnknown(source: FeedSource, error: unknown): SourceErrorInfo {
  const message = unknownErrorMessage(error);
  const reason = errorProperty(error, 'reason');
  const errorSource = errorProperty(error, 'source');
  if (source === 'nodeseek' && errorSource === 'nodeseek' && reason === 'cloudflare') {
    return {
      message,
      reason: 'cloudflare',
      verificationRequired: true
    };
  }
  return { message };
}

export function sourceErrorMessage(error?: SourceErrorInfo) {
  if (!error) {
    return '';
  }
  return typeof error === 'string' ? error : error.message;
}

export function sourceErrorRequiresVerification(error?: SourceErrorInfo) {
  return typeof error === 'object' && Boolean(error.verificationRequired);
}

export function formatSourceErrorMessages(
  errors: SourceErrors,
  sourceLabel: (source: FeedSource) => string
) {
  return Object.entries(errors)
    .map(([sourceName, error]) => `${sourceLabel(sourceName as FeedSource)}：${sourceErrorMessage(error)}`)
    .join('；');
}

export function nodeSeekVerificationErrorMessage(
  errors: SourceErrors,
  fallback = 'NodeSeek 需要完成 Cloudflare 验证'
) {
  return sourceErrorRequiresVerification(errors.nodeseek)
    ? sourceErrorMessage(errors.nodeseek) || fallback
    : '';
}
