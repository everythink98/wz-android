import { createContext, useContext, type ReactNode } from 'react';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { ReadGateway } from '@/sources/readGateway';
import type { NotificationsRuntimeValue } from './useNotificationsRuntime';

export type NotificationRouteRuntimeValue = NotificationsRuntimeValue & {
  composer: {
    ensureNodeImageApiKey: () => Promise<string | null>;
    ensureWritableSession: (source: NotificationSource) => Promise<WritableSessionTicket>;
    getDiscourseEmojiUrls: ReadGateway['getEmojiUrls'];
    isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
  };
  contentWidth: number;
  notify: (message: string) => void;
  reconcileAccountStatus: (source: NotificationSource) => Promise<AccountReconcileResult>;
  openAccountSurface: (source: NotificationSource, message: string, recovery?: LinuxDoReadRecovery) => Promise<void>;
};

const NotificationRouteRuntimeContext = createContext<NotificationRouteRuntimeValue | null>(null);

export function NotificationRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: NotificationRouteRuntimeValue;
}) {
  return <NotificationRouteRuntimeContext.Provider value={value}>{children}</NotificationRouteRuntimeContext.Provider>;
}

export function useNotificationRouteRuntime() {
  const runtime = useContext(NotificationRouteRuntimeContext);
  if (!runtime) throw new Error('NotificationRouteRuntimeProvider is required');
  return runtime;
}
