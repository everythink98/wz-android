import { Linking, NativeModules, Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationState } from './notificationStore';
import { notificationIdentifiersForIdentity } from './notificationWorker';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';

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

let pendingAndroidPermissionRequest: Promise<boolean> | null = null;

function requestOsNotificationPermissionSingleFlight(): Promise<boolean> {
  if (pendingAndroidPermissionRequest) return pendingAndroidPermissionRequest;
  const trace = beginDiagnosticTrace('app', 'notification-permission', { mode: 'manual' });
  let osCall: Promise<Notifications.NotificationPermissionsStatus>;
  try {
    osCall = Notifications.requestPermissionsAsync();
  } catch (error) {
    osCall = Promise.reject(error);
  }
  const request = osCall
    .then((permissions) => {
      finishDiagnosticTrace(trace, permissions.granted ? 'success' : 'blocked', {
        isGranted: permissions.granted,
        ...(!permissions.granted ? { reason: 'permission_denied' } : {})
      });
      return permissions.granted;
    })
    .catch((error) => {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    })
    .finally(() => {
      if (pendingAndroidPermissionRequest === request) pendingAndroidPermissionRequest = null;
    });
  pendingAndroidPermissionRequest = request;
  return request;
}

export async function notificationPermissionGranted() {
  const trace = beginDiagnosticTrace('app', 'notification-permission', { mode: 'silent' });
  try {
    const permissions = await Notifications.getPermissionsAsync();
    finishDiagnosticTrace(trace, permissions.granted ? 'success' : 'blocked', {
      isGranted: permissions.granted,
      ...(!permissions.granted ? { reason: 'permission_denied' } : {})
    });
    return permissions.granted;
  } catch (error) {
    finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
    throw error;
  }
}

export async function requestNotificationPermission(options?: { prepareChannel?: boolean }) {
  if (options?.prepareChannel !== false) {
    await ensureMessageNotificationChannel();
  }
  return requestOsNotificationPermissionSingleFlight();
}

export function openNotificationSystemSettings() {
  return Linking.openSettings();
}

const backgroundRegistrationRunner = createKeyedSerialRunner<null>();

export function syncNotificationBackgroundRegistration(
  state: NotificationState,
  permissionGranted: boolean,
  eligibleSources: readonly NotificationSource[]
) {
  const shouldRun =
    state.globalEnabled &&
    permissionGranted &&
    eligibleSources.some((source) => state.sources[source].intentEnabled && state.sources[source].identityKey);
  const operation = backgroundRegistrationRunner.run(null, async () => {
    const trace = beginDiagnosticTrace('app', 'notification-registration', { shouldRun, isGranted: permissionGranted });
    try {
      const registered = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_BACKGROUND_TASK);
      const state = shouldRun && !registered ? 'register' : !shouldRun && registered ? 'unregister' : 'unchanged';
      markDiagnosticStage(trace, 'apply', { state });
      if (shouldRun && !registered) {
        await BackgroundTask.registerTaskAsync(NOTIFICATION_BACKGROUND_TASK, { minimumInterval: 15 });
      } else if (!shouldRun && registered) {
        await BackgroundTask.unregisterTaskAsync(NOTIFICATION_BACKGROUND_TASK);
      }
      finishDiagnosticTrace(trace, state === 'unchanged' ? 'noop' : 'success', { state });
      return shouldRun;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  });
  return operation;
}

export async function presentSourceNotification(
  source: NotificationSource,
  digest: { title: string; body: string; data: { source: NotificationSource } },
  identifier: string,
  assertCurrent: () => Promise<void>
) {
  await ensureMessageNotificationChannel();
  await assertCurrent();
  return notificationDigestNativeModule().present(identifier, digest.title, digest.body, source);
}

export async function dismissSourceNotificationExact(identifier: string) {
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
  const trace = beginDiagnosticTrace('source', 'notification-cleanup', { source });
  const settled = await Promise.allSettled(
    [
      ...new Set(
        [
          identifier,
          ...(identityKey ? notificationIdentifiersForIdentity(source, identityKey) : []),
          `wz-message-${source}`
        ].filter((value): value is string => Boolean(value))
      )
    ].map(dismissSourceNotificationExact)
  );
  const failures = settled.filter((result) => result.status === 'rejected');
  for (const failure of failures) {
    markDiagnosticStage(trace, 'apply', {
      source,
      result: 'failure',
      reason: normalizeDiagnosticReason(failure.reason)
    });
  }
  finishDiagnosticTrace(trace, failures.length ? 'partial' : 'success', { source, errorCount: failures.length });
  if (failures.length)
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      '无法撤销消息通知'
    );
}
