interface CookieLike {
  name?: string;
}

interface CookieStore {
  get(url: string): Promise<Record<string, CookieLike | undefined>>;
  setFromResponse(url: string, cookie: string): Promise<boolean>;
  flush(): Promise<void>;
}

function expiredCookieHeader(name: string) {
  return `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/`;
}

export async function clearCookieUrls(
  store: CookieStore,
  urls: string[],
  onlyNames?: string[],
  isCurrent: () => boolean = () => true
) {
  if (!isCurrent()) {
    return false;
  }
  const allowedNames = onlyNames ? new Set(onlyNames) : null;
  const cleanupErrors: unknown[] = [];
  let cookieNamesByUrl: Array<{ url: string; names: string[] }>;
  if (allowedNames) {
    const names = [...allowedNames].filter(isValidCookieName);
    cookieNamesByUrl = urls.map((url) => ({ url, names }));
  } else {
    const readResults = await Promise.allSettled(urls.map(async (url) => {
      const cookies = await store.get(url);
      const names = Object.entries(cookies)
        .map(([key, cookie]) => cookie?.name || key)
        .filter(isValidCookieName);
      return { url, names };
    }));
    cookieNamesByUrl = readResults.flatMap((result) => {
      if (result.status === 'rejected') {
        cleanupErrors.push(result.reason);
        return [];
      }
      return [result.value];
    });
  }

  if (!isCurrent()) {
    return false;
  }
  const deletionResults = await Promise.allSettled(cookieNamesByUrl.flatMap(({ url, names }) => (
    [...new Set(names)].map(async (name) => {
      if (isCurrent()) {
        const deleted = await store.setFromResponse(url, expiredCookieHeader(name));
        if (!deleted) {
          throw new Error('Cookie 删除未确认');
        }
      }
    })
  )));
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
