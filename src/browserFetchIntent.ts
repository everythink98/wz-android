export type BrowserFetchOwner = 'feed' | 'topic' | 'user' | 'search' | 'account' | 'write';
export type BrowserFetchPriority = 'background' | 'foreground' | 'write';

export type BrowserFetchIntent = {
  owner: BrowserFetchOwner;
  priority: BrowserFetchPriority;
  cancelable: boolean;
};

const BROWSER_FETCH_INTENT = Symbol.for('wz.browserFetchIntent');

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
