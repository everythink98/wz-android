import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Source } from './types';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import {
  initialForumSessionEpochs,
  type ForumSessionEpochs
} from './app/serverState';

const ForumSessionEpochContext = createContext<ForumSessionEpochs>(
  initialForumSessionEpochs
);
const mediaProcessIdentity = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function mediaSessionIdentityForSource(
  source: Source | null | undefined,
  sessionEpochs: ForumSessionEpochs
) {
  return source && source !== 'v2ex'
    ? `${source}:${mediaProcessIdentity}:${sessionEpochs[source]}`
    : 'public:0';
}

export function mediaRequestContextForSource(
  source: Source | null | undefined,
  sessionEpochs: ForumSessionEpochs
): ForumMediaRequestContext {
  return {
    contentSource: source || null,
    sessionIdentity: mediaSessionIdentityForSource(source, sessionEpochs)
  };
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

export function useForumMediaSessionIdentity(source?: Source | null) {
  const sessionEpochs = useContext(ForumSessionEpochContext);
  return mediaSessionIdentityForSource(source, sessionEpochs);
}

export function useForumMediaRequestContext(source?: Source | null) {
  const sessionEpochs = useContext(ForumSessionEpochContext);
  const sessionIdentity = mediaSessionIdentityForSource(source, sessionEpochs);
  return useMemo(() => ({
    contentSource: source || null,
    sessionIdentity
  }), [sessionIdentity, source]);
}
