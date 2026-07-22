export class LinuxDoCloudflareError extends Error {
  source = 'linuxdo' as const;
  reason = 'cloudflare' as const;
  verificationRequired = true as const;

  constructor() {
    super('linux.do 需要完成 Cloudflare 验证');
  }
}

function isCloudflareChallengeBody(body: string) {
  return /<title\b[^>]*>[^<]*(?:just a moment|checking your browser|needs to review the security|attention required|enable javascript and cookies|请稍候|正在检查)[^<]*<\/title>/i.test(body)
    || /<h[12]\b[^>]*>\s*(?:just a moment|checking your browser|attention required|verify you are human|请稍候|正在检查|正在进行安全验证|请完成验证)[.!…\s]*<\/h[12]>/i.test(body)
    || /<(?:form|input|div|iframe|script)\b[^>]*(?:id|class|name|src|action)=["'][^"']*(?:cf-turnstile|cf-browser-verification|challenge-running|challenge-platform|cf_chl_|__cf_chl|challenge-error|challenges\.cloudflare\.com|\/cdn-cgi\/challenge)[^"']*["'][^>]*>/i.test(body)
    || /<script\b[^>]*>[\s\S]*?(?:window\._cf_chl_opt|__cf_chl|cf_chl_)[\s\S]*?<\/script>/i.test(body);
}

export function canContainCloudflareChallengePage(headers: Pick<Headers, 'get'> | undefined) {
  const contentType = headers?.get?.('content-type') || headers?.get?.('Content-Type') || '';
  return !contentType || /^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType.trim());
}

export function isCloudflareChallengeResponse(response: Pick<Response, 'status' | 'headers'> & { bodyText?: string }) {
  const mitigated = response.headers?.get?.('cf-mitigated') || response.headers?.get?.('CF-Mitigated');
  if (mitigated && /challenge/i.test(mitigated)) {
    return true;
  }
  if (typeof response.bodyText === 'string'
    && !/^\s*[{[]/.test(response.bodyText)
    && canContainCloudflareChallengePage(response.headers)) {
    return isCloudflareChallengeBody(response.bodyText);
  }
  return false;
}
