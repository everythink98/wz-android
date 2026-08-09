import { sourceCatalog, sourceValues, type Source } from '@/domain/forum/sourceCatalog';

export type BrowserFetchOwner = 'feed' | 'topic' | 'user' | 'search' | 'account' | 'write';
export type BrowserFetchPriority = 'background' | 'foreground' | 'write';

export type BrowserFetchIntent = {
  owner: BrowserFetchOwner;
  priority: BrowserFetchPriority;
};

const BROWSER_FETCH_INTENT = Symbol.for('wz.browserFetchIntent');

export const FORUM_READ_SOURCE_HEADER = 'X-WZ-Forum-Read-Source';
export const FORUM_READ_CANCEL_CLASS_HEADER = 'X-WZ-Forum-Read-Cancel-Class';

export type ForumReadCancelClass = 'content' | 'health' | 'retained';

type BrowserFetchIntentInit = RequestInit & {
  [BROWSER_FETCH_INTENT]?: BrowserFetchIntent;
};

export function withBrowserFetchIntent(init: RequestInit, intent: BrowserFetchIntent): RequestInit {
  return {
    ...init,
    [BROWSER_FETCH_INTENT]: intent
  } as RequestInit;
}

export function browserFetchIntentFromInit(init: RequestInit | undefined) {
  return (init as BrowserFetchIntentInit | undefined)?.[BROWSER_FETCH_INTENT];
}

function forumReadSourceForUrl(input: string): Source | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    return (
      sourceValues.find((source) => {
        const sourceHost = new URL(sourceCatalog[source].baseUrl).hostname.toLowerCase();
        return host === sourceHost || host.endsWith(`.${sourceHost}`);
      }) || null
    );
  } catch {
    return null;
  }
}

function forumReadCancelClass(intent: BrowserFetchIntent): ForumReadCancelClass {
  if (intent.owner === 'write') return 'retained';
  if (intent.owner === 'account' && intent.priority === 'background') return 'health';
  return 'content';
}

export function withNativeForumReadIntent(input: string, init: RequestInit | undefined): RequestInit | undefined {
  const intent = browserFetchIntentFromInit(init);
  const source = intent ? forumReadSourceForUrl(input) : null;
  if (!intent || !source) return init;
  const headers = new Headers(init?.headers);
  headers.set(FORUM_READ_SOURCE_HEADER, source);
  headers.set(FORUM_READ_CANCEL_CLASS_HEADER, forumReadCancelClass(intent));
  return { ...init, headers };
}
