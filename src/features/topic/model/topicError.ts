export function readableTopicError(message: string) {
  if (/upstream unavailable/i.test(message)) return '来源暂时不可用，请稍后重试';
  if (/^HTTP 5\d\d$/i.test(message)) return `来源暂时不可用（${message}）`;
  return message;
}
