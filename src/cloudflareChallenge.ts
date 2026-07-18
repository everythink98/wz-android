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

export class LinuxDoCloudflareError extends Error {
  source = 'linuxdo' as const;
  reason = 'cloudflare' as const;
  verificationRequired = true as const;

  constructor() {
    super('linux.do 需要完成 Cloudflare 验证');
  }
}

function isCloudflareChallengeBody(body: string) {
  const text = body.toLowerCase();
  return CHALLENGE_BODY_MARKERS.some((marker) => text.includes(marker));
}

export function isCloudflareChallengeResponse(response: Pick<Response, 'status' | 'headers'> & { bodyText?: string }) {
  const mitigated = response.headers?.get?.('cf-mitigated') || response.headers?.get?.('CF-Mitigated');
  if (mitigated && /challenge/i.test(mitigated)) {
    return true;
  }
  if (typeof response.bodyText === 'string') {
    return isCloudflareChallengeBody(response.bodyText);
  }
  return false;
}
