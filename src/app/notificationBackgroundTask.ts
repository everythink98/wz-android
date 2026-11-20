import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { accountSessionAccess } from '@/domain/session/siteSessionState';
import { restoreBackgroundNetworkProxy } from '@/platform/network/networkProxyAuthority';
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
import { createNotificationWorkerDeadline } from '@/platform/notifications/notificationWorkerDeadline';
import { withReaderSettings } from '@/platform/storage/readerDataStore';
import { loadAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export async function runNotificationBackgroundTask(
  settingsSession = withReaderSettings,
  runWorker = runNotificationBackgroundWorker
) {
  const trace = beginDiagnosticTrace('app', 'notification-background-task', { flow: 'background' });
  const deadline = createNotificationWorkerDeadline();
  const assertActive = () => {
    if (deadline.signal.aborted) throw deadline.error;
  };
  try {
    markDiagnosticStage(trace, 'persist', { state: 'state-load' });
    const work = settingsSession(async (readSettings) => {
      const loadEnabledNotificationSources = async () => {
        assertActive();
        const settings = await readSettings();
        assertActive();
        return projectContentSourcePreferences(settings.contentSources).notificationSources;
      };
      const sources = await loadEnabledNotificationSources();
      return runWorker({
        sources,
        deadline,
        parentTrace: trace,
        sourceAllowed: async (source) => (await loadEnabledNotificationSources()).includes(source),
        privateAccessAllowed: async (source, identityKey) => {
          const snapshot = await loadAccountSessionSnapshot(source).catch(() => null);
          if (!snapshot) return false;
          const access = accountSessionAccess(snapshot);
          return access.authenticated && access.identityTrust === 'confirmed' && access.identityKey === identityKey;
        },
        network: {
          restoreProxy: () => restoreBackgroundNetworkProxy(assertActive),
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
    });
    const result = await deadline.before(work);
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
    if (error === deadline.error) {
      finishDiagnosticTrace(trace, 'failure', { reason: 'timeout' });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
    finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
    throw error;
  } finally {
    deadline.release();
  }
}

if (!TaskManager.isTaskDefined(NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask(NOTIFICATION_BACKGROUND_TASK, () => runNotificationBackgroundTask());
}
