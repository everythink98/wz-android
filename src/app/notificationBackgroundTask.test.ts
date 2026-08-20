import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedWorkerDependencies {
  sources: readonly string[];
  sourceAllowed(source: string): Promise<boolean>;
  system: {
    dismissDigest(source: string, identifier: string): Promise<void>;
    reconcileDigests(source: string, identityKey: string, currentIdentifier?: string): Promise<void>;
  };
}

const mocks = vi.hoisted(() => ({
  task: undefined as undefined | (() => Promise<unknown>),
  dismissBroad: vi.fn(async () => undefined),
  dismissExact: vi.fn(async () => undefined),
  loadReaderSettings: vi.fn(),
  reconcile: vi.fn(async () => undefined),
  runWorker: vi.fn(async (_dependencies: CapturedWorkerDependencies) => ({ status: 'success' as const }))
}));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Failed: 'failed', Success: 'success' }
}));
vi.mock('expo-task-manager', () => ({
  isTaskDefined: vi.fn(() => false),
  defineTask: vi.fn((_name: string, task: () => Promise<unknown>) => {
    mocks.task = task;
  })
}));
vi.mock('@/platform/network/networkProxy', () => ({
  activeNetworkProxyProfile: vi.fn(),
  applyNetworkProxy: vi.fn(),
  loadNetworkProxyState: vi.fn()
}));
vi.mock('@/sources/notificationAdapters', () => ({ notificationAdapters: {} }));
vi.mock('@/sources/notificationBackgroundAccess', () => ({ probeBackgroundNotificationAccess: vi.fn() }));
vi.mock('@/platform/notifications/notificationStore', () => ({
  clearNotificationSourceForContentDisable: vi.fn(),
  loadNotificationState: vi.fn(),
  recordNotificationDelivery: vi.fn()
}));
vi.mock('@/platform/notifications/notificationSystem', () => ({
  NOTIFICATION_BACKGROUND_TASK: 'wz-message-notifications',
  dismissSourceNotification: mocks.dismissBroad,
  dismissSourceNotificationExact: mocks.dismissExact,
  notificationPermissionGranted: vi.fn(),
  presentSourceNotification: vi.fn(),
  reconcileSourceNotificationSlots: mocks.reconcile
}));
vi.mock('@/platform/notifications/notificationWorker', () => ({
  runNotificationBackgroundWorker: mocks.runWorker
}));
vi.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderSettings: mocks.loadReaderSettings
}));

import './notificationBackgroundTask';

beforeEach(() => {
  mocks.loadReaderSettings.mockReset();
  mocks.runWorker.mockClear();
});

describe('notification background task content-source allowlist', () => {
  it('loads preferences for each invocation and rechecks them through the worker current-source gate', async () => {
    mocks.loadReaderSettings
      .mockResolvedValueOnce({
        contentSources: [
          { source: 'nodeseek', enabled: true },
          { source: 'linuxdo', enabled: false }
        ]
      })
      .mockResolvedValueOnce({ contentSources: [{ source: 'nodeseek', enabled: false }] })
      .mockResolvedValueOnce({ contentSources: [{ source: 'linuxdo', enabled: true }] });

    await expect(mocks.task?.()).resolves.toBe('success');
    const firstDependencies = mocks.runWorker.mock.calls[0]![0];
    expect(firstDependencies.sources).toEqual(['nodeseek', 'yaohuo']);
    await expect(firstDependencies.sourceAllowed('nodeseek')).resolves.toBe(false);
    await firstDependencies.system.dismissDigest('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.dismissExact).toHaveBeenCalledWith('wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.dismissBroad).not.toHaveBeenCalled();
    await firstDependencies.system.reconcileDigests('nodeseek', 'nodeseek:7', 'wz-message-nodeseek-nodeseek%3A7-a');
    expect(mocks.reconcile).toHaveBeenCalledWith('nodeseek', 'nodeseek:7', 'wz-message-nodeseek-nodeseek%3A7-a');

    await expect(mocks.task?.()).resolves.toBe('success');
    expect(mocks.runWorker.mock.calls[1]![0].sources).toEqual(['linuxdo', 'nodeseek', 'yaohuo']);
    expect(mocks.loadReaderSettings).toHaveBeenCalledTimes(3);
  });
});
