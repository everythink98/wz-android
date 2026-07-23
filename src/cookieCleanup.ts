interface CookieLike {
  name?: string;
}

interface CookieStore {
  get(url: string): Promise<Record<string, CookieLike | undefined>>;
  setFromResponse(url: string, cookie: string): Promise<boolean>;
  flush(): Promise<void>;
}

type CookieCleanupOptions = {
  domains?: readonly string[];
};

function expiredCookieHeader(name: string, domain?: string) {
  return `${name}=;${domain ? ` Domain=${domain};` : ''} Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/`;
}

function validCookieDomains(domains: readonly string[] = []) {
  return [...new Set(domains
    .map((domain) => domain.trim().replace(/^\./, '').toLowerCase())
    .filter((domain) => /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(domain)))];
}

function urlForCookieDomain(urls: readonly string[], domain: string) {
  return urls.find((url) => {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

function hasCookieName(cookies: Record<string, CookieLike | undefined>, names: Set<string>) {
  return Object.entries(cookies).some(([key, cookie]) => names.has(cookie?.name || key));
}

export async function clearCookieUrls(
  store: CookieStore,
  urls: readonly string[],
  onlyNames?: readonly string[],
  isCurrent: () => boolean = () => true,
  options: CookieCleanupOptions = {}
) {
  if (!isCurrent()) {
    return false;
  }
  const allowedNames = onlyNames ? new Set(onlyNames) : null;
  const cleanupErrors: unknown[] = [];
  const readResults = await Promise.allSettled(urls.map(async (url) => {
    const cookies = await store.get(url);
    const names = allowedNames
      ? [...allowedNames].filter(isValidCookieName)
      : Object.entries(cookies)
        .map(([key, cookie]) => cookie?.name || key)
        .filter(isValidCookieName);
    return { url, names };
  }));
  const cookieNamesByUrl = readResults.flatMap((result) => {
    if (result.status === 'rejected') {
      cleanupErrors.push(result.reason);
      return [];
    }
    return [result.value];
  });

  if (!isCurrent()) {
    return false;
  }
  const cookieNames = [...new Set(cookieNamesByUrl.flatMap(({ names }) => names))];
  const deletionOperations = [
    ...cookieNamesByUrl.flatMap(({ url, names }) => (
      [...new Set(names)].map((name) => ({ url, header: expiredCookieHeader(name) }))
    )),
    ...validCookieDomains(options.domains).flatMap((domain) => {
      const url = urlForCookieDomain(urls, domain);
      return url
        ? cookieNames.map((name) => ({ url, header: expiredCookieHeader(name, domain) }))
        : [];
    })
  ];
  const deletionResults = await Promise.allSettled(deletionOperations.map(async ({ url, header }) => {
      if (isCurrent()) {
        const deleted = await store.setFromResponse(url, header);
        if (!deleted) {
          throw new Error('Cookie 删除未确认');
        }
      }
    }));
  for (const result of deletionResults) {
    if (result.status === 'rejected') {
      cleanupErrors.push(result.reason);
    }
  }

  if (!isCurrent()) {
    return false;
  }
  try {
    await store.flush();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (allowedNames && isCurrent()) {
    const verificationResults = await Promise.allSettled(urls.map(async (url) => {
      const cookies = await store.get(url);
      if (hasCookieName(cookies, allowedNames)) {
        throw new Error('Cookie 删除未确认');
      }
    }));
    for (const result of verificationResults) {
      if (result.status === 'rejected') {
        cleanupErrors.push(result.reason);
      }
    }
  }
  if (cleanupErrors.length === 1) {
    throw cleanupErrors[0];
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Cookie 清理未完成，请重试。');
  }
  return isCurrent();
}

function isValidCookieName(name: string) {
  return /^[^\s;=]+$/.test(name);
}
