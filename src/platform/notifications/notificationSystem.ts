import { Linking, Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationState } from './notificationStore';
import { notificationIdentifierForIdentity } from './notificationWorker';

export const NOTIFICATION_BACKGROUND_TASK = 'wz-message-notifications';
export const NOTIFICATION_CHANNEL_ID = 'message-notifications';
const NOTIFICATION_COLOR = '#1677FF';

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
    description: 'NodeSeek、linux.do、妖火与小隐寺的新消息摘要',
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

export async function replaceSourceNotification(
  source: NotificationSource,
  digest: { title: string; body: string; data: { source: NotificationSource } },
  previousIdentifier: string | undefined,
  identifier: string
) {
  await ensureMessageNotificationChannel();
  await Promise.all(
    [...new Set([previousIdentifier, identifier].filter((value): value is string => Boolean(value)))].map((value) =>
      Notifications.dismissNotificationAsync(value).catch(() => undefined)
    )
  );
  return Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: digest.title,
      body: digest.body,
      data: { source },
      color: NOTIFICATION_COLOR,
      sound: 'default'
    },
    trigger: { channelId: NOTIFICATION_CHANNEL_ID }
  });
}

export async function dismissSourceNotification(source: NotificationSource, identifier?: string, identityKey?: string) {
  await Promise.all(
    [
      ...new Set(
        [
          identifier,
          identityKey ? notificationIdentifierForIdentity(source, identityKey) : undefined,
          `wz-message-${source}`
        ].filter((value): value is string => Boolean(value))
      )
    ].map((value) => Notifications.dismissNotificationAsync(value).catch(() => undefined))
  );
}
