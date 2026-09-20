import * as Notifications from 'expo-notifications';
import type { ForumNotification, NotificationPage } from '@/domain/notifications/models';
import {
  clearNotificationSourceForContentDisable,
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  saveNotificationState
} from '@/platform/notifications/notificationStore';
import {
  notificationIdentifiersForIdentity,
  runNotificationBackgroundWorker
} from '@/platform/notifications/notificationWorker';
import {
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots
} from '@/platform/notifications/notificationSystem';

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function verifyNotificationQuality(mode: 'partial' | 'invalid' | 'legacy') {
  const identityKey = 'nodeseek:quality-proof';
  const identifiers = notificationIdentifiersForIdentity('nodeseek', identityKey);
  const state = defaultNotificationState();
  state.globalEnabled = true;
  state.sources.nodeseek = {
    ...state.sources.nodeseek,
    identityKey,
    intentEnabled: true,
    baselineReady: mode === 'legacy',
    deliveredIds: mode === 'legacy' ? ['message:fallback:legacy'] : [],
    unreadCount: 8
  };
  const item = (id: string): ForumNotification => ({
    source: 'nodeseek',
    id,
    kind: 'private-message',
    actor: { name: '隔离测试' },
    title: '合成私信',
    createdAt: null,
    unread: true,
    target: { type: 'private-conversation', conversationId: '1' }
  });
  let pages: NotificationPage[] = [
    {
      items: mode === 'invalid' ? [] : [item('message:101')],
      cursor: null,
      hasMore: false,
      quality: mode === 'invalid' ? 'invalid' : 'partial'
    }
  ];
  let presentations = 0;
  const visible = async () =>
    (await Notifications.getPresentedNotificationsAsync()).filter((notification) =>
      identifiers.includes(notification.request.identifier)
    );
  const run = () =>
    runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: () => true,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey, userId: 'quality-proof' }),
        listPage: async (_source, _access, _signal, cursor) => pages[cursor ? Number(cursor) : 0]
      },
      store: {
        load: loadNotificationState,
        record: recordNotificationDelivery,
        clearForContentDisable: clearNotificationSourceForContentDisable
      },
      system: {
        permissionGranted: notificationPermissionGranted,
        reconcileDigests: reconcileSourceNotificationSlots,
        presentDigest: async (...args) => {
          presentations += 1;
          return presentSourceNotification(...args);
        },
        dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
      }
    });
  try {
    await saveNotificationState(state);
    const before = JSON.stringify(await loadNotificationState());
    const failed = await run();
    check(failed.failedSources === 1 && failed.delivered === 0, 'Untrusted scan was accepted');
    check(JSON.stringify(await loadNotificationState()) === before, 'Untrusted scan advanced the ledger');
    check(presentations === 0 && (await visible()).length === 0, 'Untrusted scan reached the native sink');

    pages = [{ items: [item('message:101')], cursor: null, hasMore: false, quality: 'complete' }];
    const baseline = await run();
    check(baseline.failedSources === 0 && baseline.delivered === 0, 'First trusted scan delivered old messages');
    check(
      (await loadNotificationState()).sources.nodeseek.deliveredIds.join() === 'message:101',
      'Trusted baseline was not persisted'
    );
    check(presentations === 0 && (await visible()).length === 0, 'Trusted baseline was not silent');

    pages = [
      { items: [item('message:102'), item('message:101')], cursor: '1', hasMore: true, quality: 'complete' },
      { items: [item('message:102'), item('message:101')], cursor: null, hasMore: false, quality: 'partial' }
    ];
    const beforeSecondPageFailure = JSON.stringify(await loadNotificationState());
    check((await run()).failedSources === 1, 'Second-page failure did not reject the round');
    check(
      JSON.stringify(await loadNotificationState()) === beforeSecondPageFailure,
      'Second-page failure advanced the ledger'
    );
    check(presentations === 0, 'Second-page failure presented a digest');

    pages[1].quality = 'complete';
    const delivered = await run();
    check(
      delivered.delivered === 1 && delivered.failedSources === 0,
      'Overlapping pages changed the new-message count'
    );
    const presented = await visible();
    const saved = (await loadNotificationState()).sources.nodeseek;
    check(
      presented.length === 1 && saved.notificationIdentifier === presented[0].request.identifier,
      'Digest did not reach Android'
    );
    check(!presented[0].request.content.body?.includes('另有'), 'Duplicate row inflated the system summary');
    check((await run()).delivered === 0 && Number(presentations) === 1, 'Repeated scan duplicated native delivery');
    check(saved.unreadCount === 8, 'Scan replaced the authoritative unread count');
  } finally {
    for (const identifier of identifiers) await dismissSourceNotificationExact(identifier);
  }
}
