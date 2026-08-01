import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkGithubAppUpdate: vi.fn(),
  createDownloadResumable: vi.fn(),
  deleteAsync: vi.fn(async () => undefined),
  installVerifiedApk: vi.fn(async () => undefined),
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
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(initial: T | (() => T)) => {
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
  deleteAsync: mocks.deleteAsync
}));

vi.mock('../appUpdate', async () => ({
  ...(await vi.importActual<typeof import('../appUpdate')>('../appUpdate')),
  checkGithubAppUpdate: mocks.checkGithubAppUpdate,
  installVerifiedApk: mocks.installVerifiedApk
}));

import { useAppUpdateController } from './useAppUpdateController';

afterEach(() => {
  mocks.initialUpdateInfo = null;
  mocks.nullStateIndex = 0;
  vi.clearAllMocks();
});

describe('app update controller', () => {
  function updateInfo(version: string) {
    return {
      version,
      apkUrl: `https://github.com/everythink98/wz-android/releases/download/v${version}/app.apk`,
      notes: 'release',
      sha256: 'a'.repeat(64),
      packageName: 'com.wz.reader',
      versionName: version,
      versionCode: Number(version.replace(/\D/g, '')),
      signerSha256: 'b'.repeat(64)
    };
  }

  it('REG-UPDATE-001 blocks an old update download while a new update check is running', async () => {
    mocks.initialUpdateInfo = updateInfo('1.4.0');
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

  it('[REG-UPDATE-005] reuses one cache target across versions and keeps a successful APK', async () => {
    mocks.createDownloadResumable.mockImplementation((_url, target) => ({
      downloadAsync: vi.fn(async () => ({ status: 200, uri: target }))
    }));

    for (const version of ['1.4.0', '1.5.0']) {
      mocks.initialUpdateInfo = updateInfo(version);
      mocks.nullStateIndex = 0;
      await useAppUpdateController({ fetcher: vi.fn(), notify: vi.fn() }).downloadAppUpdate();
    }

    expect(mocks.createDownloadResumable.mock.calls.map((call) => call[1])).toEqual([
      'file:///cache/wz-update.apk',
      'file:///cache/wz-update.apk'
    ]);
    expect(mocks.deleteAsync).toHaveBeenCalledTimes(2);
    expect(mocks.installVerifiedApk).toHaveBeenCalledTimes(2);
  });

  it('[REG-UPDATE-005] removes the fixed partial APK after a failed download', async () => {
    mocks.initialUpdateInfo = updateInfo('1.6.0');
    mocks.createDownloadResumable.mockReturnValue({
      downloadAsync: vi.fn(async () => {
        throw new Error('network failed');
      })
    });

    await useAppUpdateController({ fetcher: vi.fn(), notify: vi.fn() }).downloadAppUpdate();

    expect(mocks.deleteAsync).toHaveBeenCalledTimes(2);
    expect(mocks.deleteAsync).toHaveBeenNthCalledWith(2, 'file:///cache/wz-update.apk', { idempotent: true });
    expect(mocks.installVerifiedApk).not.toHaveBeenCalled();
  });
});
