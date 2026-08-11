import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Source } from '@/domain/forum/models';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';

type ForumMediaEpochContext = {
  sessionEpochs: ForumSessionEpochs;
  transportIdentity: string;
};

const ForumSessionEpochContext = createContext<ForumMediaEpochContext>({
  sessionEpochs: initialForumSessionEpochs,
  transportIdentity: 'ready'
});
const mediaProcessIdentity = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function mediaSessionIdentityForSource(
  source: Source | null | undefined,
  sessionEpochs: ForumSessionEpochs,
  transportIdentity = 'ready'
) {
  return source && source !== 'v2ex'
    ? `${source}:${mediaProcessIdentity}:${sessionEpochs[source]}:${transportIdentity}`
    : `public:0:${transportIdentity}`;
}

export function mediaRequestContextForSource(
  source: Source | null | undefined,
  sessionEpochs: ForumSessionEpochs,
  transportIdentity = 'ready'
): ForumMediaRequestContext {
  return {
    contentSource: source || null,
    sessionIdentity: mediaSessionIdentityForSource(source, sessionEpochs, transportIdentity)
  };
}

export function ForumSessionEpochProvider({
  children,
  sessionEpochs,
  transportIdentity = 'ready'
}: {
  children: ReactNode;
  sessionEpochs: ForumSessionEpochs;
  transportIdentity?: string;
}) {
  const value = useMemo(() => ({ sessionEpochs, transportIdentity }), [sessionEpochs, transportIdentity]);
  return <ForumSessionEpochContext.Provider value={value}>{children}</ForumSessionEpochContext.Provider>;
}

export function useForumMediaSessionIdentity(source?: Source | null) {
  const { sessionEpochs, transportIdentity } = useContext(ForumSessionEpochContext);
  return mediaSessionIdentityForSource(source, sessionEpochs, transportIdentity);
}

export function useForumMediaRequestContext(source?: Source | null) {
  const { sessionEpochs, transportIdentity } = useContext(ForumSessionEpochContext);
  const sessionIdentity = mediaSessionIdentityForSource(source, sessionEpochs, transportIdentity);
  return useMemo(
    () => ({
      contentSource: source || null,
      sessionIdentity
    }),
    [sessionIdentity, source]
  );
}
