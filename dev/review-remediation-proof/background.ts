import { check } from '../proofCheck';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import { File, Paths } from 'expo-file-system';
import { SQLiteDatabase } from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { runNotificationBackgroundTask } from '@/app/notificationBackgroundTask';
import { withReaderSettings } from '@/platform/storage/readerDataStore';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import {
  clearNotificationSourceForContentDisable,
  defaultNotificationState,
  loadNotificationState,
  recordNotificationDelivery,
  saveNotificationState
} from '@/platform/notifications/notificationStore';
import { runNotificationBackgroundWorker } from '@/platform/notifications/notificationWorker';
import {
  dismissSourceNotificationExact,
  notificationPermissionGranted,
  presentSourceNotification,
  reconcileSourceNotificationSlots
} from '@/platform/notifications/notificationSystem';

const taskName = 'wz-isolated-headless-proof';
const configFile = () => new File(Paths.cache, 'background-proof-config.json');
const receiptFile = () => new File(Paths.cache, 'background-proof.json');
type Config = { token: string; mode: 'success' | 'deadline'; run: number };
function write(config: Config, checkpoint: string, evidence: object = {}) {
  const file = receiptFile();
  file.create({ overwrite: true });
  file.write(
    JSON.stringify({
      ...diagnosticBuildContext(),
      ...config,
      checkpoint,
      isDev: __DEV__,
      isHermes: 'HermesInternal' in globalThis,
      ...evidence
    })
  );
}

async function verifyDelayedSettingsDeadline() {
  let release!: () => void;
  let finishSession!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sessionFinished = new Promise<void>((resolve) => {
    finishSession = resolve;
  });
  let reads = 0;
  let connectionCloses = 0;
  let workerStarts = 0;
  let sessionError: unknown;
  const close = SQLiteDatabase.prototype.closeAsync;
  SQLiteDatabase.prototype.closeAsync = async function () {
    await close.call(this);
    if (this.databasePath.endsWith('/reader-data.db')) connectionCloses++;
  };
  const started = Date.now();
  // A broken task must still release the isolated read and produce a failing receipt.
  const watchdog = setTimeout(release, 60_000);
  try {
    const result = await runNotificationBackgroundTask(
      (work) => {
        const session = withReaderSettings((read) =>
          work(async () => {
            const settings = await read();
            reads++;
            await blocked;
            return settings;
          })
        );
        void session.then(finishSession, (error: unknown) => {
          sessionError = error;
          finishSession();
        });
        return session;
      },
      async () => {
        workerStarts++;
        throw new Error('Late settings started a notification worker');
      }
    );
    const elapsedMs = Date.now() - started;
    release();
    await sessionFinished;
    check(
      result === BackgroundTask.BackgroundTaskResult.Failed && reads === 1 && workerStarts === 0,
      'Delayed settings escaped the task deadline'
    );
    check(elapsedMs >= 49_000 && elapsedMs < 60_000, 'Settings did not share the original deadline');
    check(
      connectionCloses === 1 && sessionError instanceof Error && !(sessionError instanceof AggregateError),
      'Late settings did not close the temporary SQLite connection'
    );
    return { elapsedMs, reads, workerStarts, connectionCloses, connectionReleased: true };
  } finally {
    clearTimeout(watchdog);
    release();
    SQLiteDatabase.prototype.closeAsync = close;
  }
}

// Only this developer entry imports the synthetic task. No upstream requests are made.
TaskManager.defineTask(taskName, async () => {
  const config = JSON.parse(await configFile().text()) as Config;
  config.run += 1;
  const startedAt = Date.now();
  const states = [AppState.currentState];
  const subscription = AppState.addEventListener('change', (state) => states.push(state));
  try {
    check((await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated', 'Unowned device');
    check(config.mode === 'success' || config.mode === 'deadline', 'Invalid mode');
    check(Number.isSafeInteger(config.run) && config.run > 0, 'Invalid periodic run sequence');
    check(AppState.currentState === 'background', 'Task did not start in the background');
    configFile().write(JSON.stringify(config));
    write(config, 'running', { startedAt, states });
    const before = JSON.stringify(await loadNotificationState());
    const worker = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: () => true,
      network: {
        restoreProxy: () =>
          config.mode === 'deadline'
            ? new Promise<void>(() => {})
            : new Promise<void>((resolve) => setTimeout(resolve, 500)),
        probeAccess: async () => ({ identityKey: 'nodeseek:headless-proof', userId: 'headless-proof' }),
        listPage: async () => ({ items: [], quality: 'complete', hasMore: false, cursor: null })
      },
      store: {
        load: loadNotificationState,
        record: recordNotificationDelivery,
        clearForContentDisable: clearNotificationSourceForContentDisable
      },
      system: {
        permissionGranted: notificationPermissionGranted,
        reconcileDigests: reconcileSourceNotificationSlots,
        presentDigest: presentSourceNotification,
        dismissDigest: (_source, identifier) => dismissSourceNotificationExact(identifier)
      }
    });
    const [result, settingsDeadline] = await Promise.all([
      worker,
      config.mode === 'deadline' ? verifyDelayedSettingsDeadline() : undefined
    ]);
    const elapsedMs = Date.now() - startedAt;
    const state = await loadNotificationState();
    check(
      states.every((value) => value === 'background'),
      'App returned to the foreground during task'
    );
    if (config.mode === 'deadline') {
      check(result.status === 'failed' && result.reason === 'deadline', 'Deadline did not fail closed');
      check(elapsedMs >= 49000 && elapsedMs < 65000, 'Original 50-second deadline was not respected');
      check(JSON.stringify(state) === before, 'Timed-out task changed notification state');
    } else {
      check(result.status === 'success' && result.failedSources === 0, 'Background worker failed');
      check(elapsedMs >= 500 && elapsedMs < 15000, 'Background timer did not run promptly');
      check(state.sources.nodeseek.baselineReady, 'Native storage baseline did not commit');
    }
    write(config, 'passed', { startedAt, finishedAt: Date.now(), elapsedMs, states, result, settingsDeadline });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    write(config, 'failed', { elapsedMs: Date.now() - startedAt, states, error: String(error) });
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    subscription.remove();
  }
});

export async function prepareBackgroundProof(mode: 'success' | 'deadline' | 'cleanup', token: string) {
  check((await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated', 'Unowned device');
  if (mode === 'cleanup') {
    await BackgroundTask.unregisterTaskAsync(taskName);
    if (configFile().exists) configFile().delete();
    write({ token, mode: 'success', run: 0 }, 'cleaned');
    return;
  }
  const otherTasks = (await TaskManager.getRegisteredTasksAsync()).filter((task) => task.taskName !== taskName);
  check(otherTasks.length === 0, 'Other registered tasks would contaminate isolated proof');
  const state = defaultNotificationState();
  state.globalEnabled = true;
  state.sources.nodeseek.intentEnabled = true;
  state.sources.nodeseek.identityKey = 'nodeseek:headless-proof';
  await saveNotificationState(state);
  const config = { token, mode, run: 0 };
  configFile().create({ overwrite: true });
  configFile().write(JSON.stringify(config));
  await BackgroundTask.registerTaskAsync(taskName, { minimumInterval: 15 });
  check(await TaskManager.isTaskRegisteredAsync(taskName), 'Background task registration failed');
  write(config, 'ready');
}
