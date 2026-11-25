import { check } from '../proofCheck';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { File, Paths } from 'expo-file-system';
import { deleteDatabaseAsync, openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text, ToastAndroid, View } from 'react-native';
import { createEmptyReaderData, MAX_HISTORY_RECORDS, type ReaderData } from '@/domain/reader/readerData';
import type { ForumNotification, NotificationMarkResult } from '@/domain/notifications/models';
import {
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel
} from '@/domain/session/siteSessionState';
import { NotificationDetailRoute } from '@/features/notifications/NotificationRoute';
import {
  NotificationRouteRuntimeProvider,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRouteRuntime';
import { defaultNotificationState, NOTIFICATION_STORAGE_KEY } from '@/platform/notifications/notificationStore';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { readReaderMeta, readReaderSnapshot } from '@/platform/storage/readerDatabase';
import { loadReaderState } from '@/platform/storage/readerDataStore';
import { diagnosticBuildContext } from '@/platform/diagnostics/nativeDiagnosticJournal';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { notificationAdapters } from '@/sources/notificationAdapters';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { verifyDeletionBoundaries } from '../reader-storage-proof/deletionBoundaries';

function receipt(mode: string, token: string, data: object) {
  const file = new File(Paths.cache, `acceptance-${mode}.json`);
  file.create({ overwrite: true });
  file.write(
    JSON.stringify({
      ...diagnosticBuildContext(),
      token,
      mode,
      isHermes: 'HermesInternal' in globalThis,
      isDev: __DEV__,
      ...data
    })
  );
}
async function snapshot() {
  const db = await openDatabaseAsync('reader-data.db', { useNewConnection: true });
  try {
    return (await readReaderMeta(db)) ? await readReaderSnapshot(db) : null;
  } finally {
    await db.closeAsync();
  }
}

export function AcceptanceProof({ mode, token }: { mode: string; token: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      check((await AsyncStorage.getItem('reader-storage-proof-owner')) === 'isolated', 'Refusing unowned data');
      globalThis.fetch = async () => {
        throw new Error('Remote network denied by device acceptance');
      };
      if (mode === 'boundaries') {
        const results = await verifyDeletionBoundaries();
        receipt(mode, token, { checkpoint: 'passed', results, restored: true });
      }
      setReady(true);
    })().catch((failure: unknown) => {
      setError(String(failure));
      receipt(mode, token, { checkpoint: 'failed', error: String(failure) });
    });
  }, [mode, token]);
  if (error) return <Text>{error}</Text>;
  if (!ready) return <Text>准备隔离验收</Text>;
  if (mode === 'recovery' || mode === 'cold-recovery') return <RecoveryProof token={token} mode={mode} />;
  if (mode === 'notification') return <NotificationProof token={token} />;
  return <Text>SQLite 27 个边界组合通过，原资料已恢复</Text>;
}

function RecoveryProof({ token, mode }: { token: string; mode: 'recovery' | 'cold-recovery' }) {
  const cold = mode === 'cold-recovery';
  const [AppRoot] = useState(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Only this mode owns the production splash lifecycle.
    return (require('@/app/AppRoot') as typeof import('@/app/AppRoot')).AppRoot;
  });
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState('准备恢复验收');
  const [notice, setNotice] = useState('');
  const { current: control } = useRef({
    original: undefined as ReaderData | undefined,
    notifications: '',
    notificationIntentChecks: 0,
    restoredHistoryCount: 0,
    failures: 0,
    legacyReads: 0,
    invalidImports: 0,
    hosts: [] as string[],
    stages: [] as string[]
  });
  const save = useCallback(
    (checkpoint: string) =>
      receipt(mode, token, {
        checkpoint,
        failures: control.failures,
        legacyReads: control.legacyReads,
        notificationIntentChecks: control.notificationIntentChecks,
        restoredHistoryCount: control.restoredHistoryCount,
        invalidImports: control.invalidImports,
        hosts: control.hosts,
        stages: control.stages
      }),
    [control, mode, token]
  );
  useEffect(() => {
    const originalRead = SQLiteDatabase.prototype.getFirstAsync;
    const originalLegacyRead = AsyncStorage.getItem;
    const originalToast = ToastAndroid.show;
    // Latch the actual production toast so replay can observe short-lived feedback.
    ToastAndroid.show = (message, duration) => {
      if (message === '备份格式不兼容，请使用当前 Android 版本导出的 JSON。') {
        setNotice(message);
        control.invalidImports++;
      }
      originalToast(message, duration);
    };
    void (async () => {
      const notifications = defaultNotificationState();
      notifications.globalEnabled = true;
      notifications.hasOptedIn = true;
      notifications.sources.nodeseek.intentEnabled = true;
      control.notifications = JSON.stringify(notifications);
      await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, control.notifications);
      check(
        (await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY)) === control.notifications,
        'Could not seed the isolated notification opt-in'
      );
      globalThis.fetch = async (input) => {
        const host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
          .hostname;
        control.hosts.push(host);
        save('running');
        // No actual traffic; V2EX public reads get a valid empty response.
        return new Response(host.endsWith('v2ex.com') ? '[]' : '{}', {
          headers: { 'Content-Type': 'application/json' }
        });
      };
      const backup = createEmptyReaderData();
      backup.settings.contentSources = backup.settings.contentSources.map((item) => ({
        ...item,
        enabled: item.source === 'v2ex'
      }));
      backup.favorites['v2ex:917'] = {
        topic: {
          source: 'v2ex',
          id: '917',
          title: '恢复验收资料',
          author: 'fixture',
          category: '测试',
          url: 'https://www.v2ex.com/t/917',
          createdAt: '2026-09-17T00:00:00Z',
          replyCount: 0
        },
        savedAt: '2026-09-17T00:00:00Z'
      };
      if (cold) {
        const legacy = createEmptyReaderData();
        const favorite = backup.favorites['v2ex:917'];
        legacy.history['v2ex:916'] = {
          ...favorite,
          topic: { ...favorite.topic, id: '916', url: 'https://www.v2ex.com/t/916', title: '迁移前的阅读历史' },
          visitCount: 7
        };
        const savedAt = '2025-01-01T00:00:00Z';
        backup.history['v2ex:916'] = { ...legacy.history['v2ex:916'], savedAt, visitCount: 1 };
        for (let index = 0; index <= MAX_HISTORY_RECORDS; index++) {
          const id = String(10_000 + index);
          backup.history[`v2ex:${id}`] = {
            topic: {
              source: 'v2ex',
              id,
              title: id,
              author: 'fixture',
              url: `https://www.v2ex.com/t/${id}`,
              createdAt: ''
            },
            savedAt
          };
        }
        control.original = legacy;
        // The runner has checkpointed the isolated fixture. Leave only pre-migration reader data at bootstrap.
        await deleteDatabaseAsync('reader-data.db');
        await AsyncStorage.setMany({
          'reader-data': JSON.stringify(legacy),
          'reader-settings': JSON.stringify(legacy.settings)
        });
        AsyncStorage.getItem = (key) => {
          if (key === 'reader-data' && ++control.legacyReads === 1) {
            control.failures++;
            return Promise.reject(new Error('隔离验收：旧资料读取暂时失败'));
          }
          return originalLegacyRead.call(AsyncStorage, key);
        };
      } else {
        await loadReaderState();
        const baseline = await snapshot();
        check(baseline, 'Missing migrated reader baseline');
        control.original = baseline;
        SQLiteDatabase.prototype.getFirstAsync = function (
          this: SQLiteDatabase,
          ...args: Parameters<typeof originalRead>
        ) {
          if (String(args[0]).includes('FROM reader_meta') && control.failures === 0) {
            control.failures++;
            return Promise.reject(new Error('隔离验收：读取暂时失败'));
          }
          return originalRead.apply(this, args);
        } as typeof originalRead;
      }
      for (const [name, content] of [
        ['acceptance-valid.json', JSON.stringify(backup)],
        ['acceptance-invalid.json', JSON.stringify({ version: -1, settings: backup.settings })]
      ]) {
        const file = new File(Paths.cache, name);
        file.create({ overwrite: true });
        file.write(content);
      }
      setMounted(true);
      setStatus('恢复模式验收');
      save('ready');
    })().catch((error: unknown) => {
      setStatus(String(error));
      save('failed');
    });
    return () => {
      SQLiteDatabase.prototype.getFirstAsync = originalRead;
      AsyncStorage.getItem = originalLegacyRead;
      ToastAndroid.show = originalToast;
    };
  }, [cold, control, save]);
  const inspect = async (restored: boolean) => {
    check(control.failures === 1, 'Bootstrap fault was not exercised');
    const actual = await snapshot();
    const sourceHosts = control.hosts.filter((host) => /nodeseek|linux\.do|yaohuo|v2ex/.test(host));
    if (!restored) {
      check(sourceHosts.length === 0, 'Recovery started source business requests');
      if (cold) {
        const stored = await AsyncStorage.getMany(['reader-data', 'reader-settings']);
        check(actual === null && control.legacyReads === 1, 'Cold recovery committed or retried before valid import');
        check(stored['reader-data'] === JSON.stringify(control.original), 'Recovery changed legacy records');
        check(
          stored['reader-settings'] === JSON.stringify(control.original?.settings),
          'Recovery changed legacy settings'
        );
      } else {
        check(JSON.stringify(actual) === JSON.stringify(control.original), 'Recovery changed stored data');
      }
      check(
        (await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY)) === control.notifications,
        'Recovery cleared notification intent'
      );
      control.notificationIntentChecks++;
      control.stages.push(control.invalidImports === 1 ? 'invalid-import-preserved' : 'recovery-preserved');
    } else {
      check(actual?.favorites['v2ex:917'], 'Imported record missing');
      if (cold) {
        const record = actual.history['v2ex:916'];
        check(record?.topic.title === '迁移前的阅读历史' && record.visitCount === 7, 'Cold import lost legacy history');
        control.restoredHistoryCount = Object.keys(actual.history).length;
        check(control.restoredHistoryCount === MAX_HISTORY_RECORDS + 2, 'Cold import truncated exported history');
        for (let index = 0; index <= MAX_HISTORY_RECORDS; index++) {
          const id = String(10_000 + index);
          check(actual.history[`v2ex:${id}`]?.topic.id === id, 'Cold import lost a backed-up topic');
        }
        const stored = await AsyncStorage.getMany(['reader-data', 'reader-settings']);
        check(
          control.legacyReads >= 2 && stored['reader-data'] === null && stored['reader-settings'] === null,
          'Cold import did not reread and clean legacy data'
        );
        control.stages.push('cold-legacy-merged');
      }
      check(
        actual.settings.contentSources
          .filter((item) => item.enabled)
          .map((item) => item.source)
          .join() === 'v2ex',
        'Restored source permissions wrong'
      );
      check(
        sourceHosts.length > 0 && sourceHosts.every((host) => host.endsWith('v2ex.com')),
        'Restored source requests wrong'
      );
      control.stages.push('restored-v2ex-only');
    }
    setStatus(restored ? '恢复结果核对通过' : '保护状态核对通过');
    save('checked');
  };
  const finish = async () => {
    check(
      control.original &&
        control.invalidImports === 1 &&
        control.stages.includes('recovery-preserved') &&
        control.stages.includes('invalid-import-preserved') &&
        control.stages.includes('restored-v2ex-only'),
      'Missing recovery/failed-import/success evidence'
    );
    setMounted(false);
    setStatus('恢复业务核对通过');
    save('passed');
  };
  const run = (action: () => Promise<void>) =>
    void action().catch((error: unknown) => {
      setStatus(String(error));
      save('failed');
    });
  return (
    <View style={{ flex: 1 }}>
      <Text>{status}</Text>
      {notice ? <Text>{notice}</Text> : null}
      <View style={{ flexDirection: 'row' }}>
        <Button title="核对保护" onPress={() => run(() => inspect(false))} />
        <Button title="核对恢复" onPress={() => run(() => inspect(true))} />
        <Button title="结束恢复验收" onPress={() => run(finish)} />
      </View>
      {mounted && <AppRoot />}
    </View>
  );
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const item: ForumNotification = {
  source: 'nodeseek',
  id: 'device-917',
  kind: 'reply',
  actor: { name: '隔离用户' },
  title: '已读生命周期验收',
  createdAt: null,
  unread: true,
  target: { type: 'information' }
};
function NotificationProof({ token }: { token: string }) {
  const [navigation] = useState(() => createNavigationContainerRef<RootStackParamList>());
  const [, render] = useState(0);
  const [control] = useState(() => ({
    details: 0,
    marks: 0,
    canceled: 0,
    confirmed: 0,
    reconcileRequests: 0,
    inflight: 0,
    maxInflight: 0,
    detailsAtMark: [] as number[],
    routeKeys: [] as string[],
    pending: undefined as undefined | ((result: NotificationMarkResult | Error) => void)
  }));
  const save = () => {
    receipt('notification', token, { checkpoint: 'running', ...control, pending: Boolean(control.pending) });
    render((value) => value + 1);
  };
  const [gateway] = useState(() =>
    createNotificationGateway({
      sourceAllowed: () => true,
      privateAccessAllowed: () => true,
      readAccess: () => ({ identityKey: 'nodeseek:917', userId: '917' }),
      adapters: {
        ...notificationAdapters,
        nodeseek: {
          ...notificationAdapters.nodeseek,
          loadDetail: async () => {
            control.details++;
            save();
            return { notification: item, title: item.title, contentText: '受控消息正文' };
          },
          markRead: async (_item, _detail, access) => {
            control.marks++;
            control.detailsAtMark.push(control.details);
            control.inflight++;
            control.maxInflight = Math.max(control.maxInflight, control.inflight);
            save();
            try {
              return await new Promise<NotificationMarkResult>((resolve, reject) => {
                const abort = () => {
                  control.canceled++;
                  settle(new Error('aborted'));
                };
                const settle = (value: NotificationMarkResult | Error) => {
                  access.signal?.removeEventListener('abort', abort);
                  control.pending = undefined;
                  if (value instanceof Error) reject(value);
                  else {
                    if (value.confirmed) control.confirmed++;
                    resolve(value);
                  }
                };
                control.pending = settle;
                if (access.signal?.aborted) abort();
                else access.signal?.addEventListener('abort', abort, { once: true });
              });
            } finally {
              control.inflight--;
              save();
            }
          }
        }
      }
    })
  );
  const [runtime] = useState<NotificationRouteRuntimeValue>(() => ({
    gateway,
    clearReadBlock: () => undefined,
    getReadBlock: () => undefined,
    reportReadError: () => undefined,
    sessionEpochs: { nodeseek: 0, linuxdo: 0, yaohuo: 0, v2ex: 0 },
    activeSources: ['nodeseek'],
    enabledNotificationSources: ['nodeseek'],
    identityKeys: { nodeseek: 'nodeseek:917' },
    identitySignature: 'nodeseek:917',
    backgroundEnabled: false,
    backgroundError: '',
    initializationError: '',
    permission: 'denied',
    ready: true,
    retryInitialization: async () => undefined,
    openSystemSettings: async () => undefined,
    onNavigationReady: () => undefined,
    setCenterVisible: () => undefined,
    setGlobalEnabled: async () => false,
    setSourceEnabled: async () => undefined,
    state: defaultNotificationState(),
    unreadTotal: 1,
    sessions: {
      nodeseek: createAccountSessionViewModel(
        accountSessionSnapshotFromObservation(createAccountSessionSnapshot('nodeseek'), {
          session: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: [],
            isVerifying: false,
            currentUser: {
              source: 'nodeseek',
              id: '917',
              username: 'fixture',
              url: 'https://account.invalid/nodeseek/917'
            }
          }
        })
      ),
      linuxdo: createAccountSessionViewModel(createAccountSessionSnapshot('linuxdo')),
      yaohuo: createAccountSessionViewModel(createAccountSessionSnapshot('yaohuo'))
    },
    refreshSnapshots: async () => {
      control.reconcileRequests++;
      save();
      return [];
    },
    composer: {
      ensureNodeImageApiKey: async () => null,
      ensureWritableSession: async () => ({ source: 'nodeseek', identityKey: 'nodeseek:917', sessionEpoch: 0 }),
      getDiscourseEmojiUrls: async () => ({}),
      isWritableSessionTicketCurrent: () => true
    },
    contentWidth: 360,
    notify: () => undefined,
    openAccountSurface: async () => undefined,
    reconcileAccountStatus: async () => ({ status: 'same', session: createAccountSessionSnapshot('nodeseek') })
  }));
  const detailKey = forumQueryKeys.notificationDetail({
    source: 'nodeseek',
    identityKey: 'nodeseek:917',
    notificationId: item.id,
    sessionEpoch: runtime.sessionEpochs.nodeseek
  });
  return (
    <View style={{ flex: 1 }}>
      <Text>{`详情 ${control.details} / 尝试 ${control.marks} / 取消 ${control.canceled} / 确认 ${control.confirmed} / 对账请求 ${control.reconcileRequests}`}</Text>
      <View style={{ flexDirection: 'row' }}>
        <Button title="覆盖详情" onPress={() => navigation.navigate('ReadingSettings')} />
        <Button title="刷新详情" onPress={() => void appQueryClient.invalidateQueries({ queryKey: detailKey })} />
        <Button title="响应失败" onPress={() => control.pending?.(new Error('隔离服务器失败'))} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Button
          title="响应未确认"
          onPress={() => control.pending?.({ confirmed: false, message: '隔离服务器未确认' })}
        />
        <Button title="响应成功" onPress={() => control.pending?.({ confirmed: true })} />
        <Button
          title="核对通知"
          onPress={() => {
            const passed =
              control.marks === 4 &&
              control.canceled === 1 &&
              control.confirmed === 1 &&
              control.reconcileRequests === 4 &&
              control.maxInflight === 1 &&
              new Set(control.routeKeys).size === 1 &&
              control.detailsAtMark[2] > control.detailsAtMark[1] &&
              control.detailsAtMark[3] > control.detailsAtMark[2];
            receipt('notification', token, {
              ...control,
              pending: Boolean(control.pending),
              checkpoint: passed ? 'passed' : 'failed'
            });
          }}
        />
      </View>
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer
          ref={navigation}
          onStateChange={() => {
            const current = navigation.getCurrentRoute();
            if (current?.name === 'NotificationDetail') control.routeKeys.push(current.key);
            save();
          }}
          onReady={() => {
            const current = navigation.getCurrentRoute();
            if (current) control.routeKeys.push(current.key);
            save();
          }}
        >
          <Stack.Navigator initialRouteName="NotificationDetail">
            <Stack.Screen
              name="NotificationDetail"
              component={NotificationDetailRoute}
              initialParams={{ notification: item, identityKey: 'nodeseek:917' }}
            />
            <Stack.Screen name="ReadingSettings">{() => <Text>详情暂时失焦，返回同一实例</Text>}</Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    </View>
  );
}
