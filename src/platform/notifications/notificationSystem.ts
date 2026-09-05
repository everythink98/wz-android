import { Linking, NativeModules, Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationState } from './notificationStore';
import { notificationIdentifiersForIdentity } from './notificationWorker';

export const NOTIFICATION_BACKGROUND_TASK = 'wz-message-notifications';
export const NOTIFICATION_CHANNEL_ID = 'message-notifications';
const NOTIFICATION_COLOR = '#1677FF';

type NotificationDigestNativeModule = {
  dismiss(identifier: string): Promise<void>;
  present(identifier: string, title: string, body: string, source: NotificationSource): Promise<string>;
};

function notificationDigestNativeModule() {
  const module = NativeModules.NotificationDigestModule as NotificationDigestNativeModule | undefined;
  if (!module?.present || !module.dismiss) throw new Error('Android 消息通知模块不可用');
  return module;
}

export function installMessageNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false
    })
  });
}

export async function ensureMessageNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
    name: '消息通知',
    description: 'NodeSeek、linux.do 与妖火的新消息摘要',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: NOTIFICATION_COLOR,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true
  });
}

export async function notificationPermissionGranted() {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.granted;
}

export async function requestNotificationPermission() {
  await ensureMessageNotificationChannel();
  const permissions = await Notifications.requestPermissionsAsync();
  return permissions.granted;
}

export function openNotificationSystemSettings() {
  return Linking.openSettings();
}

let backgroundRegistrationQueue = Promise.resolve<unknown>(undefined);

export function syncNotificationBackgroundRegistration(
  state: NotificationState,
  permissionGranted: boolean,
  eligibleSources: readonly NotificationSource[]
) {
  const shouldRun =
    state.globalEnabled &&
    permissionGranted &&
    eligibleSources.some((source) => state.sources[source].intentEnabled && state.sources[source].identityKey);
  const operation = backgroundRegistrationQueue.then(async () => {
    const registered = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_BACKGROUND_TASK);
    if (shouldRun && !registered) {
      await BackgroundTask.registerTaskAsync(NOTIFICATION_BACKGROUND_TASK, { minimumInterval: 15 });
    } else if (!shouldRun && registered) {
      await BackgroundTask.unregisterTaskAsync(NOTIFICATION_BACKGROUND_TASK);
    }
    return shouldRun;
  });
  backgroundRegistrationQueue = operation.catch(() => undefined);
  return operation;
}

export async function presentSourceNotification(
  source: NotificationSource,
  digest: { title: string; body: string; data: { source: NotificationSource } },
  identifier: string
) {
  await ensureMessageNotificationChannel();
  return notificationDigestNativeModule().present(identifier, digest.title, digest.body, source);
}

export function dismissSourceNotificationExact(identifier: string) {
  return notificationDigestNativeModule().dismiss(identifier);
}

export async function reconcileSourceNotificationSlots(
  source: NotificationSource,
  identityKey: string,
  currentIdentifier?: string
) {
  const settled = await Promise.allSettled(
    [...notificationIdentifiersForIdentity(source, identityKey), `wz-message-${source}`]
      .filter((identifier) => identifier !== currentIdentifier)
      .map(dismissSourceNotificationExact)
  );
  const failed = settled.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export async function dismissSourceNotification(source: NotificationSource, identifier?: string, identityKey?: string) {
  await Promise.all(
    [
      ...new Set(
        [
          identifier,
          ...(identityKey ? notificationIdentifiersForIdentity(source, identityKey) : []),
          `wz-message-${source}`
        ].filter((value): value is string => Boolean(value))
      )
    ].map((value) => Notifications.dismissNotificationAsync(value).catch(() => undefined))
  );
}
