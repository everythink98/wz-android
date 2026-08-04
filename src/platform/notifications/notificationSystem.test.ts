import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registered: false,
  dismiss: vi.fn(async () => undefined),
  handler: vi.fn(),
  register: vi.fn(async () => undefined),
  schedule: vi.fn(async ({ identifier }: { identifier: string }) => identifier),
  setChannel: vi.fn(async () => undefined),
  unregister: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  Linking: { openSettings: vi.fn(async () => undefined) },
  Platform: { OS: 'android' }
}));
vi.mock('expo-background-task', () => ({
  registerTaskAsync: mocks.register,
  unregisterTaskAsync: mocks.unregister
}));
vi.mock('expo-task-manager', () => ({
  isTaskRegisteredAsync: vi.fn(async () => mocks.registered)
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default' },
  AndroidNotificationVisibility: { PRIVATE: 'private' },
  dismissNotificationAsync: mocks.dismiss,
  getPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: false })),
  scheduleNotificationAsync: mocks.schedule,
  setNotificationHandler: mocks.handler,
  setNotificationChannelAsync: mocks.setChannel
}));

import { defaultNotificationState } from './notificationStore';
import {
  dismissSourceNotification,
  ensureMessageNotificationChannel,
  installMessageNotificationHandler,
  replaceSourceNotification,
  syncNotificationBackgroundRegistration
} from './notificationSystem';

beforeEach(() => {
  mocks.registered = false;
  vi.clearAllMocks();
});

describe('Android notification system', () => {
  it('registers only with permission, user intent, and a bound account identity', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };

    await expect(syncNotificationBackgroundRegistration(state, true, ['nodeseek'])).resolves.toBe(true);
    expect(mocks.register).toHaveBeenCalledWith('wz-message-notifications', { minimumInterval: 15 });

    mocks.registered = true;
    await expect(syncNotificationBackgroundRegistration(state, false, ['nodeseek'])).resolves.toBe(false);
    expect(mocks.unregister).toHaveBeenCalledWith('wz-message-notifications');
  });

  it('[REG-NOTIFY-022] leaves background registration at the latest requested intent', async () => {
    const enabled = defaultNotificationState();
    enabled.globalEnabled = true;
    enabled.sources.nodeseek = {
      ...enabled.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    const disabled = { ...enabled, globalEnabled: false };
    let releaseRegistration!: () => void;
    const registrationBlocked = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    let registrationStarted!: () => void;
    const registrationDidStart = new Promise<void>((resolve) => {
      registrationStarted = resolve;
    });
    mocks.register.mockImplementationOnce(async () => {
      registrationStarted();
      await registrationBlocked;
      mocks.registered = true;
    });
    mocks.unregister.mockImplementationOnce(async () => {
      mocks.registered = false;
    });

    const enableOperation = syncNotificationBackgroundRegistration(enabled, true, ['nodeseek']);
    await registrationDidStart;
    const disableOperation = syncNotificationBackgroundRegistration(disabled, true, ['nodeseek']);
    releaseRegistration();
    await Promise.all([enableOperation, disableOperation]);

    expect(mocks.registered).toBe(false);
    expect(mocks.unregister).toHaveBeenCalledWith('wz-message-notifications');

    mocks.registered = true;
    let releaseUnregistration!: () => void;
    const unregistrationBlocked = new Promise<void>((resolve) => {
      releaseUnregistration = resolve;
    });
    let unregistrationStarted!: () => void;
    const unregistrationDidStart = new Promise<void>((resolve) => {
      unregistrationStarted = resolve;
    });
    mocks.unregister.mockImplementationOnce(async () => {
      unregistrationStarted();
      await unregistrationBlocked;
      mocks.registered = false;
    });
    mocks.register.mockImplementationOnce(async () => {
      mocks.registered = true;
    });

    const disableAgain = syncNotificationBackgroundRegistration(disabled, true, ['nodeseek']);
    await unregistrationDidStart;
    const enableAgain = syncNotificationBackgroundRegistration(enabled, true, ['nodeseek']);
    releaseUnregistration();
    await Promise.all([disableAgain, enableAgain]);

    expect(mocks.registered).toBe(true);
    expect(mocks.register).toHaveBeenCalledTimes(2);
  });

  it('[REG-NOTIFY-020] does not register when the only intended source is not currently eligible', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.xiaoyinsi = {
      ...state.sources.xiaoyinsi,
      intentEnabled: true,
      identityKey: 'xiaoyinsi:7'
    };

    await expect(syncNotificationBackgroundRegistration(state, true, [])).resolves.toBe(false);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-018] presents local message notifications while the app is foregrounded', async () => {
    installMessageNotificationHandler();
    const handler = mocks.handler.mock.calls[0]?.[0] as {
      handleNotification(): Promise<Record<string, boolean>>;
    };

    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false
    });
  });

  it('uses one private Android channel and replaces the stable per-source summary', async () => {
    const identityIdentifier = 'wz-message-nodeseek-nodeseek%3A7';
    await ensureMessageNotificationChannel();
    await replaceSourceNotification(
      'nodeseek',
      { title: 'NodeSeek', body: '张三回复了你的主题', data: { source: 'nodeseek' } },
      'previous-id',
      identityIdentifier
    );

    expect(mocks.setChannel).toHaveBeenCalledWith(
      'message-notifications',
      expect.objectContaining({ lockscreenVisibility: 'private', lightColor: '#1677FF' })
    );
    expect(mocks.dismiss).toHaveBeenCalledWith('previous-id');
    expect(mocks.dismiss).toHaveBeenCalledWith(identityIdentifier);
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: identityIdentifier,
        content: expect.objectContaining({
          title: 'NodeSeek',
          body: '张三回复了你的主题',
          data: { source: 'nodeseek' }
        }),
        trigger: { channelId: 'message-notifications' }
      })
    );

    await dismissSourceNotification('nodeseek', undefined, 'nodeseek:7');
    expect(mocks.dismiss).toHaveBeenCalledWith(identityIdentifier);
    expect(mocks.dismiss).toHaveBeenCalledWith('wz-message-nodeseek');
    expect(mocks.dismiss).not.toHaveBeenCalledWith('wz-message-nodeseek-nodeseek%3A8');
  });
});
