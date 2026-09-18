import { useEffect, useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NotificationDetailRoute } from '@/features/notifications/NotificationRoute';
import {
  NotificationRouteRuntimeProvider,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRouteRuntime';
import { createNotificationGateway } from '@/sources/notificationGateway';
import type { NotificationAdapter } from '@/sources/notificationAdapter';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { ForumNotification } from '@/domain/notifications/models';
import { defaultNotificationState } from '@/platform/notifications/notificationStore';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { ensureWritableSessionTicket, validateWritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { composerAccount, type ComposerTransport } from './composerSubmissionFixture';

const Stack = createNativeStackNavigator<RootStackParamList>();
const unused = async (): Promise<never> => {
  throw new Error('Unexpected proof adapter call');
};

export function MessageSubmissionFixture({
  transport,
  source = 'nodeseek',
  conversationId = '9',
  epoch = 0,
  onNotice
}: {
  transport: ComposerTransport;
  source?: SessionSite;
  conversationId?: string;
  epoch?: number;
  onNotice?: (notice: string) => void;
}) {
  const [notice, setNotice] = useState('');
  const [touches, setTouches] = useState(0);
  useEffect(() => onNotice?.(notice), [notice, onNotice]);
  const account = useMemo(() => composerAccount(source, epoch), [source, epoch]);
  const notification = useMemo<ForumNotification>(
    () => ({
      source,
      id: `conversation:${conversationId}`,
      kind: 'private-message',
      actor: { name: 'Local sender' },
      title: 'Local conversation',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation', conversationId }
    }),
    [source, conversationId]
  );
  const gateway = useMemo(() => {
    const adapter: NotificationAdapter = {
      getCategories: unused,
      listPage: unused,
      readUnreadSnapshot: unused,
      markRead: unused,
      loadDetail: async () => {
        if (transport.confirmations > 0 && transport.outcome === 'refresh-error')
          throw new Error('Mock refresh offline');
        return {
          notification,
          title: 'Local conversation',
          messages: [],
          reply: { format: source === 'yaohuo' ? 'plain-text' : 'markdown' }
        };
      },
      replyToConversation: async (_item, content, access) => {
        transport.requests.push({ path: 'adapter:replyToConversation', method: 'POST', body: content });
        transport.onChange();
        await transport.respond(access.signal);
        if (transport.outcome === 'rejected') throw new Error('Mock rejected');
        if (transport.outcome === 'unconfirmed') return { confirmed: false, message: 'Mock unconfirmed' };
        transport.confirm();
        return { confirmed: true };
      }
    };
    return createNotificationGateway({
      adapters: { nodeseek: adapter, linuxdo: adapter, yaohuo: adapter },
      sourceAllowed: (candidate) => candidate === source,
      privateAccessAllowed: (candidate, identity) => candidate === source && identity === account.snapshot.identityKey,
      readAccess: () => ({
        identityKey: account.snapshot.identityKey,
        userId: '123',
        username: 'fixture-user',
        fetcher: transport.fetcher
      }),
      requestSessionEpoch: () => epoch
    });
  }, [account, epoch, notification, source, transport]);
  const runtime = useMemo<NotificationRouteRuntimeValue>(
    () => ({
      gateway,
      sessions: account.sessions,
      sessionEpochs: { ...initialForumSessionEpochs, [source]: epoch },
      activeSources: [source],
      enabledNotificationSources: [source],
      identityKeys: { [source]: account.snapshot.identityKey },
      identitySignature: account.snapshot.identityKey,
      ready: true,
      permission: 'denied',
      backgroundEnabled: false,
      backgroundError: '',
      initializationError: '',
      partialUnavailable: false,
      state: defaultNotificationState(),
      snapshotErrors: {},
      unreadTotal: 0,
      contentWidth: 360,
      clearReadBlock: () => {},
      getReadBlock: () => undefined,
      reportReadError: () => {},
      onNavigationReady: () => {},
      setCenterVisible: () => {},
      openSystemSettings: async () => {},
      retryInitialization: async () => {},
      setGlobalEnabled: async () => false,
      setSourceEnabled: async () => {},
      refreshSnapshots: async () => {
        await transport.refresh();
        return [];
      },
      notify: setNotice,
      openAccountSurface: async () => {},
      reconcileAccountStatus: async () => ({ status: 'same', session: account.sessions[source] }),
      composer: {
        ensureNodeImageApiKey: async () => null,
        getDiscourseEmojiUrls: async () => ({}),
        ensureWritableSession: () =>
          ensureWritableSessionTicket(
            () => account.snapshot,
            async () => ({ status: 'same' })
          ),
        isWritableSessionTicketCurrent: (ticket) => validateWritableSessionTicket(ticket, account.snapshot)
      }
    }),
    [gateway, account, source, epoch, transport]
  );
  return (
    <View style={{ flex: 1 }}>
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name="NotificationDetail"
              initialParams={{ notification, identityKey: account.snapshot.identityKey }}
            >
              {(props) => (
                <NotificationDetailRoute
                  {...props}
                  route={{ ...props.route, params: { notification, identityKey: account.snapshot.identityKey } }}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
      <View style={{ position: 'absolute', top: 120, left: 12 }}>
        <Button title="底层按钮" onPress={() => setTouches((value) => value + 1)} />
        <Text>{`touches=${touches}`}</Text>
        <Text testID="composer-proof-notice">{notice}</Text>
      </View>
    </View>
  );
}
