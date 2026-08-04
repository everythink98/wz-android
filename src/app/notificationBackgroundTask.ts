import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { activeNetworkProxyProfile, applyNetworkProxy, loadNetworkProxyState } from '@/platform/network/networkProxy';
import { notificationAdapters } from '@/sources/notificationAdapters';
import { probeBackgroundNotificationAccess } from '@/sources/notificationBackgroundAccess';
import {
  loadNotificationState,
  recordNotificationDelivery,
  setNotificationIdentifier
} from '@/platform/notifications/notificationStore';
import {
  NOTIFICATION_BACKGROUND_TASK,
  dismissSourceNotification,
  notificationPermissionGranted,
  replaceSourceNotification
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';

if (!TaskManager.isTaskDefined(NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask(NOTIFICATION_BACKGROUND_TASK, async () => {
    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => {
          const state = await loadNetworkProxyState();
          const active = state.enabled ? activeNetworkProxyProfile(state) : null;
          await applyNetworkProxy(active);
        },
        probeAccess: probeBackgroundNotificationAccess,
        listPage: (source, access, _signal, cursor) =>
          notificationAdapters[source].listPage({ ...access, cursor, limit: 60 })
      },
      store: {
        load: loadNotificationState,
        record: recordNotificationDelivery,
        setIdentifier: setNotificationIdentifier
      },
      system: {
        permissionGranted: notificationPermissionGranted,
        replaceDigest: replaceSourceNotification,
        dismissDigest: (source, identifier) => dismissSourceNotification(source, identifier)
      }
    });
    return result.status === 'failed'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  });
}
