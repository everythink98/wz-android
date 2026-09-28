import { createContext, useContext, type ReactNode } from 'react';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { Fetcher } from '@/platform/network/request';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export type TopicComposerRouteRuntimeValue = {
  enabledSources: Source[];
  sessions: SiteSessionViewModels;
  sessionEpochs: ForumSessionEpochs;
  appActive: boolean;
  fetcher: Fetcher;
  ensureNetworkProxyReady: () => Promise<void>;
  ensureWritableSession: (source: TopicCreationSource) => Promise<WritableSessionTicket>;
  isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  ensureNodeImageApiKey: () => Promise<string | null>;
  getUserAgent: (source: TopicCreationSource) => string;
  getEmojiUrls: ReadGateway['getEmojiUrls'];
  getLinuxDoTopicCreationContext: ReadGateway['getLinuxDoTopicCreationContext'];
  getTopicEditContext: ReadGateway['getTopicEditContext'];
  getTopic: ReadGateway['getTopic'];
  openAccount: (
    source: TopicCreationSource,
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | Promise<boolean>;
  notify: (message: string) => void;
};

const Context = createContext<TopicComposerRouteRuntimeValue | null>(null);
export function TopicComposerRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: TopicComposerRouteRuntimeValue;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTopicComposerRouteRuntime() {
  const value = useContext(Context);
  if (!value) throw new Error('TopicComposerRouteRuntimeProvider is required');
  return value;
}
