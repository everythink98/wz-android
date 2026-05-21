interface CookieLike {
  name?: string;
}

interface CookieStore {
  get(url: string): Promise<Record<string, CookieLike | undefined>>;
  setFromResponse(url: string, cookie: string): Promise<boolean>;
  flush(): Promise<void>;
}

export function expiredCookieHeader(name: string) {
  return `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/`;
}

export async function clearCookieUrls(store: CookieStore, urls: string[]) {
  const cookieNamesByUrl = await Promise.all(urls.map(async (url) => {
    const cookies = await store.get(url);
    const names = Object.entries(cookies)
      .map(([key, cookie]) => cookie?.name || key)
      .filter(isValidCookieName);
    return { url, names };
  }));

  await Promise.all(cookieNamesByUrl.flatMap(({ url, names }) => (
    [...new Set(names)].map((name) => store.setFromResponse(url, expiredCookieHeader(name)))
  )));

  await store.flush();
}

function isValidCookieName(name: string) {
  return /^[^\s;=]+$/.test(name);
}
