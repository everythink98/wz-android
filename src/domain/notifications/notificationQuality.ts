import type { NotificationPage } from './models';

export function notificationPageQuality(
  candidateCount: number,
  validCount: number,
  ambiguousIdentity = false
): NotificationPage['quality'] {
  if (candidateCount > 0 && validCount === 0) return 'invalid';
  return validCount < candidateCount || ambiguousIdentity ? 'partial' : 'complete';
}

export function notificationPageError(quality: NotificationPage['quality']) {
  if (quality === 'complete') return undefined;
  return Object.assign(new Error(quality === 'invalid' ? '消息内容无法解析，请重试' : '部分消息内容无法解析，请重试'), {
    reason: quality === 'invalid' ? 'parse_empty' : 'invalid_response',
    retryable: true
  });
}
