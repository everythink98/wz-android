import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { activeNetworkProxyProfile, applyNetworkProxy, loadNetworkProxyState } from '@/platform/network/networkProxy';
import { notificationAdapters } from '@/sources/notificationAdapters';
import { probeBackgroundNotificationAccess } from '@/sources/notificationBackgroundAccess';
import {
  clearNotificationSourceForContentDisable,
  loadNotificationState,
  recordNotificationDelivery
} from '@/platform/notifications/notificationStore';
import {
  NOTIFICATION_BACKGROUND_TASK,
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots
} from '@/platform/notifications/notificationSystem';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import { loadReaderSettings } from '@/platform/storage/readerDataStore';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

async function loadEnabledNotificationSources() {
  return projectContentSourcePreferences((await loadReaderSettings()).contentSources).notificationSources;
}

if (!TaskManager.isTaskDefined(NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask(NOTIFICATION_BACKGROUND_TASK, async () => {
    const trace = beginDiagnosticTrace('app', 'notification-background-task', { flow: 'background' });
    try {
      markDiagnosticStage(trace, 'persist', { state: 'state-load' });
      const sources = await loadEnabledNotificationSources();
      const result = await runNotificationBackgroundWorker({
        sources,
        parentTrace: trace,
        sourceAllowed: async (source) => (await loadEnabledNotificationSources()).includes(source),
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
          clearForContentDisable: clearNotificationSourceForContentDisable,
          load: loadNotificationState,
          record: recordNotificationDelivery
        },
        system: {
          permissionGranted: notificationPermissionGranted,
          reconcileDigests: reconcileSourceNotificationSlots,
          presentDigest: presentSourceNotification,
          dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
        }
      });
      finishDiagnosticTrace(
        trace,
        result.status === 'failed' ? 'failure' : result.failedSources ? 'partial' : 'success',
        {
          delivered: result.delivered,
          failedSources: result.failedSources
        }
      );
      return result.status === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  });
}
