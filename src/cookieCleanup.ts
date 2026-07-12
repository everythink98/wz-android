interface CookieLike {
  name?: string;
  value?: string;
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
  expectedValues?: Record<string, string>
) {
  const allowedNames = onlyNames ? new Set(onlyNames) : null;
  let changedSinceSnapshot = false;
  const observedExpectedNames = new Set<string>();
  const cookieNamesByUrl = await Promise.all(urls.map(async (url) => {
    const cookies = await store.get(url);
    const names = Object.entries(cookies).flatMap(([key, cookie]) => {
      const name = cookie?.name || key;
      if (!isValidCookieName(name) || (allowedNames && !allowedNames.has(name))) {
        return [];
      }
      if (expectedValues) {
        const wasExpected = Object.prototype.hasOwnProperty.call(expectedValues, name);
        if (wasExpected) {
          observedExpectedNames.add(name);
        }
        if (!wasExpected || cookie?.value !== expectedValues[name]) {
          changedSinceSnapshot = true;
          return [];
        }
      }
      return [name];
    });
    return { url, names };
  }));

  if (expectedValues && Object.keys(expectedValues).some((name) => (
    isValidCookieName(name)
    && (!allowedNames || allowedNames.has(name))
    && !observedExpectedNames.has(name)
  ))) {
    changedSinceSnapshot = true;
  }

  if (changedSinceSnapshot) {
    await store.flush();
    return false;
  }

  const results = await Promise.all(cookieNamesByUrl.flatMap(({ url, names }) => (
    [...new Set(names)].map((name) => store.setFromResponse(url, expiredCookieHeader(name)))
  )));

  await store.flush();
  if (results.some((cleared) => !cleared)) {
    throw new Error('Cookie 清理失败');
  }
  const targetNames = new Set(cookieNamesByUrl.flatMap(({ names }) => names));
  const remainingCookies = (await Promise.all(urls.map(async (url) => {
    const cookies = await store.get(url);
    return Object.entries(cookies).flatMap(([key, cookie]) => {
      const name = cookie?.name || key;
      return targetNames.has(name) ? [{ name, value: cookie?.value }] : [];
    });
  }))).flat();
  if (remainingCookies.some(({ name, value }) => !expectedValues || value === expectedValues[name])) {
    throw new Error('Cookie 清理失败');
  }
  if (remainingCookies.length) {
    return false;
  }
  return true;
}

function isValidCookieName(name: string) {
  return /^[^\s;=]+$/.test(name);
}
