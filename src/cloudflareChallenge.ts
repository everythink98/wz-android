const CHALLENGE_BODY_MARKERS = [
  'just a moment',
  'checking your browser',
  'cf-browser-verification',
  'challenge-running',
  'challenge-platform',
  'cf-turnstile',
  'cf_chl_',
  'needs to review the security',
  'attention required',
  'enable javascript and cookies',
  '请稍候',
  '正在检查'
];

function isCloudflareChallengeBody(body: string) {
  const text = body.toLowerCase();
  return CHALLENGE_BODY_MARKERS.some((marker) => text.includes(marker));
}

export function isCloudflareChallengeResponse(
  response: Pick<Response, 'status' | 'headers'> & { bodyText?: string },
  { bodyIsReadable = false }: { bodyIsReadable?: boolean } = {}
) {
  const mitigated = response.headers?.get?.('cf-mitigated') || response.headers?.get?.('CF-Mitigated');
  if (mitigated && /challenge/i.test(mitigated)) {
    return true;
  }
  if (bodyIsReadable) {
    return false;
  }
  if (typeof response.bodyText === 'string') {
    return isCloudflareChallengeBody(response.bodyText);
  }
  return false;
}
