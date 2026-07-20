import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkGithubAppUpdate: vi.fn(),
  createDownloadResumable: vi.fn(),
  initialUpdateInfo: null as null | {
    version: string;
    apkUrl: string;
    notes: string;
    sha256: string;
    packageName: string;
    versionName: string;
    versionCode: number;
    signerSha256: string;
  },
  nullStateIndex: 0
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let value = typeof initial === 'function' ? (initial as () => T)() : initial;
    if (value === null && mocks.nullStateIndex++ === 0 && mocks.initialUpdateInfo) {
      value = mocks.initialUpdateInfo as T;
    }
    return [value, vi.fn()];
  }
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  createDownloadResumable: mocks.createDownloadResumable,
  deleteAsync: vi.fn(async () => undefined)
}));

vi.mock('../appUpdate', async () => ({
  ...await vi.importActual<typeof import('../appUpdate')>('../appUpdate'),
  checkGithubAppUpdate: mocks.checkGithubAppUpdate,
  installVerifiedApk: vi.fn(async () => undefined)
}));

import { useAppUpdateController } from './useAppUpdateController';

afterEach(() => {
  mocks.initialUpdateInfo = null;
  mocks.nullStateIndex = 0;
  vi.clearAllMocks();
});

describe('app update controller', () => {
  it('REG-UPDATE-001 blocks an old update download while a new update check is running', async () => {
    mocks.initialUpdateInfo = {
      version: '1.4.0',
      apkUrl: 'https://github.com/everythink98/wz-android/releases/download/v1.4.0/app.apk',
      notes: 'old release',
      sha256: 'a'.repeat(64),
      packageName: 'com.wz.reader',
      versionName: '1.4.0',
      versionCode: 140,
      signerSha256: 'b'.repeat(64)
    };
    const check = Promise.withResolvers<null>();
    mocks.checkGithubAppUpdate.mockReturnValueOnce(check.promise);
    mocks.createDownloadResumable.mockReturnValue({
      downloadAsync: vi.fn(async () => ({ status: 200, uri: 'file:///cache/update.apk' }))
    });
    const controller = useAppUpdateController({
      fetcher: vi.fn(),
      notify: vi.fn()
    });

    const activeCheck = controller.checkAppUpdate();
    await vi.waitFor(() => expect(mocks.checkGithubAppUpdate).toHaveBeenCalledTimes(1));
    await controller.downloadAppUpdate();

    expect(mocks.createDownloadResumable).not.toHaveBeenCalled();
    check.resolve(null);
    await activeCheck;
  });
});
