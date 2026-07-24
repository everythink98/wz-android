import { createContext, useContext, type ReactNode } from 'react';
import type { Source } from './types';
import {
  initialForumSessionEpochs,
  type ForumSessionEpochs
} from './app/serverState';

const ForumSessionEpochContext = createContext<ForumSessionEpochs>(
  initialForumSessionEpochs
);

function isHost(host: string, expected: string) {
  return host === expected || host.endsWith(`.${expected}`);
}

export function mediaSessionIdentityForSource(
  source: Source | null | undefined,
  sessionEpochs: ForumSessionEpochs
) {
  return source && source !== 'v2ex'
    ? `${source}:${sessionEpochs[source]}`
    : 'public:0';
}

export function mediaSourceForUrl(url: string): Exclude<Source, 'v2ex'> | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      isHost(host, 'nodeseek.com')
      || isHost(host, 'nodeimage.com')
      || isHost(host, '111666.best')
    ) {
      return 'nodeseek';
    }
    if (isHost(host, 'linux.do')) {
      return 'linuxdo';
    }
    if (isHost(host, 'yaohuo.me')) {
      return 'yaohuo';
    }
    if (isHost(host, 'forum.xiaoyinsi.com')) {
      return 'xiaoyinsi';
    }
    return null;
  } catch {
    return null;
  }
}

export function managedMediaSessionIdentity(
  url: string,
  sessionEpochs: ForumSessionEpochs
) {
  return mediaSessionIdentityForSource(mediaSourceForUrl(url), sessionEpochs);
}

export function ForumSessionEpochProvider({
  children,
  sessionEpochs
}: {
  children: ReactNode;
  sessionEpochs: ForumSessionEpochs;
}) {
  return (
    <ForumSessionEpochContext.Provider value={sessionEpochs}>
      {children}
    </ForumSessionEpochContext.Provider>
  );
}

export function useManagedMediaSessionIdentity(url?: string) {
  const sessionEpochs = useContext(ForumSessionEpochContext);
  return managedMediaSessionIdentity(url || '', sessionEpochs);
}

export function useForumMediaSessionIdentity(source?: Source | null) {
  const sessionEpochs = useContext(ForumSessionEpochContext);
  return mediaSessionIdentityForSource(source, sessionEpochs);
}
