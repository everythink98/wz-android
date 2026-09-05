import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '../render';
import appConfig from '../../../app.json';
import { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import { MoreUpdatePanel } from '@/features/more/components/MoreUpdatePanel';
import { type AppUpdateInfo, UPDATE_APK_NAME } from '@/platform/update/appUpdate';
import type { DownloadProgress, DownloadTaskOptions } from 'expo-file-system';

const mockFiles = new Map<string, number>();
const mockStore = new Map<string, string>();
const mockCheck = jest.fn<() => Promise<AppUpdateInfo | null>>();
const mockOpen = jest.fn<() => Promise<boolean>>();
const mockNetwork = jest.fn<() => Promise<void>>();
const mockNotify = jest.fn();
const mockReceivedOffsets: number[] = [];
type Transfer = (uri: string, progress: (data: DownloadProgress) => void) => Promise<object | null>;
const mockPlans: Transfer[] = [];
const mockPause = jest.fn<() => Promise<void>>();
let mockLastProgress: ((data: DownloadProgress) => void) | undefined;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  })
}));

jest.mock('@/platform/update/appUpdate', () => ({
  ...jest.requireActual<typeof import('@/platform/update/appUpdate')>('@/platform/update/appUpdate'),
  checkGithubAppUpdate: () => mockCheck()
}));

jest.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri) ?? 0;
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async move(destination: MockFile) {
      mockFiles.set(destination.uri, this.size);
      this.delete();
      this.uri = destination.uri;
    }
    static createDownloadTask(_url: string, file: MockFile, options: DownloadTaskOptions) {
      return task(file.uri, 0, options);
    }
  }
  class MockDirectory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...mockFiles.keys()]
        .filter((path) => path.slice(0, path.lastIndexOf('/')) === this.uri)
        .map((path) => new MockFile(path));
    }
  }
  function task(uri: string, offset: number, options: DownloadTaskOptions) {
    const result = {
      state: offset ? 'paused' : 'idle',
      release: jest.fn(),
      pauseAsync: async () => {
        await mockPause();
        result.state = 'paused';
      },
      downloadAsync: async () => {
        result.state = 'active';
        mockReceivedOffsets.push(offset);
        if (options.headers?.['Accept-Encoding'] !== 'identity') throw new Error('Expected identity encoding');
        const progress = options.onProgress!;
        mockLastProgress = progress;
        const plan = mockPlans.shift();
        if (plan) return plan(uri, progress);
        mockFiles.set(uri, 100);
        progress({ bytesWritten: 100, totalBytes: 100 });
        result.state = 'completed';
        return new MockFile(uri);
      },
      resumeAsync: async (): Promise<object | null> => result.downloadAsync()
    };
    return result;
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { cache: new MockDirectory('file:///cache'), document: new MockDirectory('file:///documents') },
    DownloadTask: {
      fromSavable: (saved: { fileUri: string; resumeData: string }, options: DownloadTaskOptions) =>
        task(saved.fileUri, Number(saved.resumeData), options)
    }
  };
});

function update(increment = 1): AppUpdateInfo {
  const [major, minor, patch] = appConfig.expo.version.split('.').map(Number);
  const version = `${major}.${minor}.${patch + increment}`;
  return {
    version,
    versionName: version,
    versionCode: appConfig.expo.android.versionCode + increment,
    sha256: String(increment).repeat(64),
    signerSha256: appConfig.expo.extra.releaseSignerSha256,
    packageName: appConfig.expo.android.package,
    notes: '更新说明',
    apkUrl: `https://github.com/everythink98/wz-android/releases/download/v${version}/${UPDATE_APK_NAME}`
  };
}
function target(info = update(), complete = false) {
  return `file:///documents/wz-update/wz-update-${info.versionCode}-${info.sha256}.${complete ? 'apk' : 'part'}`;
}
function save(info = update(), totalBytes: number | null = 100) {
  mockStore.set('app-update-download', JSON.stringify({ format: 1, update: info, totalBytes }));
}
const options = { fetcher: jest.fn<typeof fetch>(), beforeRequest: mockNetwork, notify: mockNotify };
async function readyHook(autoCheck = false) {
  const hook = await renderHook(() => useAppUpdateRuntime({ ...options, autoCheck }));
  await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
  return hook;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockStore.clear();
  mockPlans.length = 0;
  mockReceivedOffsets.length = 0;
  mockCheck.mockResolvedValue(update());
  mockOpen.mockResolvedValue(true);
  mockNetwork.mockResolvedValue();
  mockPause.mockResolvedValue();
  mockLastProgress = undefined;
  AppState.currentState = 'active';
  NativeModules.ApkInstallerModule = {
    installApk: mockOpen,
    inspectApk: jest.fn(async (uri: string) => {
      if (mockFiles.get(uri) !== 100) throw Object.assign(new Error('APK 文件无法识别'), { code: 'apk_invalid' });
      return uri.includes(update(2).sha256) ? update(2) : update();
    })
  };
});

function RuntimePanel({ visible = true }: { visible?: boolean }) {
  const runtime = useAppUpdateRuntime(options);
  return visible ? (
    <MoreUpdatePanel
      runtime={{
        phase: runtime.phase,
        artifact: runtime.artifact,
        info: runtime.appUpdateInfo,
        message: runtime.appUpdateMessage,
        progress: runtime.appUpdateDownloadProgress,
        check: runtime.checkAppUpdate,
        start: runtime.startAppUpdateDownload,
        pause: runtime.pauseAppUpdateDownload,
        resume: runtime.resumeAppUpdateDownload,
        install: runtime.installAppUpdate
      }}
    />
  ) : null;
}

describe('recoverable app updates', () => {
  it('reuses the complete APK for repeated offline installation', async () => {
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(hook.result.current.artifact?.ready).toBe(true);
    mockNetwork.mockRejectedValue(new Error('offline'));
    await act(() => hook.result.current.installAppUpdate());
    expect(mockReceivedOffsets).toEqual([0]);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockFiles.get(target(update(), true))).toBe(100);
  });

  it('keeps the verified package when opening the installer fails', async () => {
    mockOpen.mockRejectedValueOnce(new Error('请允许安装未知应用'));
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(hook.result.current.artifact?.ready).toBe(true);
    expect(mockFiles.get(target(update(), true))).toBe(100);
    await act(() => hook.result.current.installAppUpdate());
    expect(mockReceivedOffsets).toEqual([0]);
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it('restores the complete package after restart without a network check', async () => {
    save();
    mockFiles.set(target(update(), true), 100);
    mockNetwork.mockRejectedValue(new Error('offline'));
    const hook = await readyHook();
    await act(() => hook.result.current.installAppUpdate());
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockNetwork).not.toHaveBeenCalled();
    expect(mockReceivedOffsets).toEqual([]);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('recovers a finished partial file even if the process ended before rename', async () => {
    save(update(), null);
    mockFiles.set(target(), 100);
    const hook = await readyHook();
    expect(hook.result.current.artifact?.ready).toBe(true);
    expect(mockFiles.has(target())).toBe(false);
    expect(mockReceivedOffsets).toEqual([]);
  });

  it('resumes from the bytes on disk after a network failure and remount', async () => {
    mockPlans.push(async (uri, progress) => {
      mockFiles.set(uri, 40);
      progress({ bytesWritten: 50, totalBytes: 100 });
      throw new Error('network failed');
    });
    const first = await readyHook();
    await act(() => first.result.current.checkAppUpdate());
    await act(() => first.result.current.startAppUpdateDownload());
    expect(first.result.current.artifact?.downloadedBytes).toBe(40);
    await first.unmount();
    const restored = await readyHook();
    await act(() => restored.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0, 40]);
    expect(restored.result.current.artifact?.ready).toBe(true);
  });

  it('pauses and ignores late progress before resuming from the saved file', async () => {
    const pending = Promise.withResolvers<object | null>();
    mockPlans.push(async (uri, progress) => {
      mockFiles.set(uri, 30);
      progress({ bytesWritten: 30, totalBytes: 100 });
      return pending.promise;
    });
    mockPause.mockImplementationOnce(async () => {
      pending.resolve(null);
    });
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    let download!: Promise<void>;
    await act(async () => {
      download = hook.result.current.startAppUpdateDownload();
    });
    await waitFor(() => expect(mockReceivedOffsets).toEqual([0]));
    const oldProgress = mockLastProgress!;
    await act(() => hook.result.current.pauseAppUpdateDownload());
    await act(async () => {
      await download;
      oldProgress({ bytesWritten: 99, totalBytes: 100 });
    });
    expect(hook.result.current.artifact?.downloadedBytes).toBe(30);
    expect(hook.result.current.appUpdateDownloadProgress).toBeNull();
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0, 30]);
  });

  it('preserves the local target when a check fails or finds a different version', async () => {
    save();
    mockFiles.set(target(update(), true), 100);
    const hook = await readyHook();
    mockCheck.mockRejectedValueOnce(new Error('check failed'));
    await act(() => hook.result.current.checkAppUpdate());
    expect(hook.result.current.artifact?.ready).toBe(true);
    mockCheck.mockResolvedValue(update(2));
    await act(() => hook.result.current.checkAppUpdate());
    expect(hook.result.current.artifact?.update).toEqual(update());
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(hook.result.current.artifact?.update).toEqual(update(2));
    expect(mockFiles.has(target(update(), true))).toBe(false);
  });

  it('keeps unrelated files while migrating a verified legacy cache', async () => {
    const legacy = `file:///cache/wz-update-${update().versionCode}-${update().sha256}.apk`;
    mockFiles.set(legacy, 100);
    mockFiles.set('file:///cache/avatar.png', 20);
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    mockNetwork.mockRejectedValue(new Error('offline'));
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([]);
    expect(mockFiles.has(legacy)).toBe(false);
    expect(mockFiles.get('file:///cache/avatar.png')).toBe(20);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('does not install in the background or automatically when returning', async () => {
    AppState.currentState = 'background';
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(hook.result.current.artifact?.ready).toBe(true);
    expect(mockOpen).not.toHaveBeenCalled();
    AppState.currentState = 'active';
    await hook.rerender(undefined);
    expect(mockOpen).not.toHaveBeenCalled();
    await act(() => hook.result.current.installAppUpdate());
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('restarts once on a rejected range while preserving the same trusted identity', async () => {
    save();
    mockFiles.set(target(), 40);
    mockPlans.push(async () => {
      throw Object.assign(new Error('range'), { code: 'ERR_DOWNLOAD_RANGE_NOT_SATISFIABLE' });
    });
    const hook = await readyHook();
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([40, 0]);
    expect(hook.result.current.artifact?.ready).toBe(true);
  });

  it('ignores callbacks from a replaced native task during the full retry', async () => {
    save();
    mockFiles.set(target(), 40);
    let oldProgress!: (data: DownloadProgress) => void;
    mockPlans.push(async (_uri, progress) => {
      oldProgress = progress;
      throw Object.assign(new Error('range'), { code: 'ERR_DOWNLOAD_RANGE' });
    });
    mockPlans.push(async (uri, progress) => {
      mockFiles.set(uri, 20);
      progress({ bytesWritten: 20, totalBytes: 100 });
      oldProgress({ bytesWritten: 95, totalBytes: 200 });
      throw new Error('offline');
    });
    const hook = await readyHook();
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(hook.result.current.artifact?.totalBytes).toBe(100);
    expect(hook.result.current.artifact?.downloadedBytes).toBe(20);
  });

  it('waits for the old writer to stop before a rebuilt runtime recovers the file', async () => {
    const finished = Promise.withResolvers<object | null>();
    const stopped = Promise.withResolvers<void>();
    mockPlans.push(async (uri) => {
      mockFiles.set(uri, 30);
      await stopped.promise;
      mockFiles.set(uri, 40);
      finished.resolve(null);
      return finished.promise;
    });
    mockPause.mockImplementationOnce(async () => {
      await stopped.promise;
    });
    const first = await readyHook();
    await act(() => first.result.current.checkAppUpdate());
    let download!: Promise<void>;
    await act(async () => {
      download = first.result.current.startAppUpdateDownload();
    });
    await waitFor(() => expect(mockReceivedOffsets).toEqual([0]));
    await first.unmount();
    const next = await renderHook(() => useAppUpdateRuntime(options));
    expect(next.result.current.phase).toBe('restoring');
    await act(async () => {
      stopped.resolve();
      await download;
    });
    await waitFor(() => expect(next.result.current.phase).toBe('idle'));
    expect(next.result.current.artifact?.downloadedBytes).toBe(40);
    await act(() => next.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0, 40]);
  });

  it('keeps a verified complete file usable when saving the progress size fails', async () => {
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    jest
      .mocked(AsyncStorage.setItem)
      .mockImplementationOnce(async (key, value) => {
        mockStore.set(key, value);
      })
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(hook.result.current.artifact?.ready).toBe(true);
    expect(mockFiles.get(target(update(), true))).toBe(100);
    await act(() => hook.result.current.installAppUpdate());
    expect(mockReceivedOffsets).toEqual([0]);
  });

  it('blocks the transport when proxy preparation fails and preserves the partial file', async () => {
    save();
    mockFiles.set(target(), 40);
    const hook = await readyHook();
    mockNetwork.mockRejectedValueOnce(new Error('代理尚未就绪'));
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([]);
    expect(mockFiles.get(target())).toBe(40);
    expect(hook.result.current.phase).toBe('idle');
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([40]);
  });

  it('does not loop when both the range request and full retry fail', async () => {
    save();
    mockFiles.set(target(), 40);
    for (let i = 0; i < 2; i++)
      mockPlans.push(async () => {
        throw Object.assign(new Error('range'), { code: 'ERR_DOWNLOAD_RANGE_NOT_SATISFIABLE' });
      });
    const hook = await readyHook();
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([40, 0]);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe('idle');
  });

  it('discards a fully transferred invalid APK and retries only on the next user action', async () => {
    mockPlans.push(async (uri) => {
      mockFiles.set(uri, 90);
      return {};
    });
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    await act(() => hook.result.current.startAppUpdateDownload());
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockFiles.has(target())).toBe(false);
    expect(hook.result.current.artifact?.downloadedBytes).toBe(0);
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0, 0]);
    expect(hook.result.current.artifact?.ready).toBe(true);
  });

  it('recovers a missing file as a fresh download and removes only an installed target', async () => {
    save();
    const missing = await readyHook();
    expect(missing.result.current.artifact?.downloadedBytes).toBe(0);
    await act(() => missing.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0]);
    await missing.unmount();
    save(update(0));
    mockFiles.set(target(update(0), true), 100);
    mockFiles.set('file:///documents/reader.json', 10);
    const installed = await readyHook();
    expect(installed.result.current.artifact).toBeNull();
    expect(mockFiles.has(target(update(0), true))).toBe(false);
    expect(mockFiles.get('file:///documents/reader.json')).toBe(10);
  });

  it('blocks duplicate actions and downloading the old target during a new check', async () => {
    const hook = await readyHook();
    await act(() => hook.result.current.checkAppUpdate());
    const check = Promise.withResolvers<AppUpdateInfo | null>();
    mockCheck.mockReturnValueOnce(check.promise);
    let activeCheck!: Promise<void>;
    await act(async () => {
      activeCheck = hook.result.current.checkAppUpdate();
      await hook.result.current.startAppUpdateDownload();
    });
    expect(mockReceivedOffsets).toEqual([]);
    await act(async () => {
      check.resolve(update());
      await activeCheck;
    });
    await act(async () => {
      await Promise.all([hook.result.current.startAppUpdateDownload(), hook.result.current.startAppUpdateDownload()]);
    });
    expect(mockReceivedOffsets).toEqual([0]);
  });

  it('runs the startup check only after local recovery', async () => {
    save();
    mockFiles.set(target(update(), true), 100);
    const hook = await readyHook(true);
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
    expect(hook.result.current.artifact?.ready).toBe(true);
  });

  it('rejects untrusted metadata and corrupted complete files without installing', async () => {
    save({ ...update(), sha256: '../../escape' });
    const invalid = await readyHook();
    expect(invalid.result.current.artifact).toBeNull();
    await invalid.unmount();
    save();
    mockFiles.set(target(update(), true), 15);
    const corrupt = await readyHook();
    expect(corrupt.result.current.artifact?.ready).toBe(false);
    expect(mockFiles.has(target(update(), true))).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('projects an installation failure into an actionable install button', async () => {
    mockOpen.mockRejectedValueOnce(new Error('无法打开安装确认'));
    const view = await render(<RuntimePanel />);
    await waitFor(() => expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('检查更新'));
    await waitFor(() => expect(view.getByLabelText('下载并安装')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('下载并安装'));
    await waitFor(() => expect(view.getByLabelText('安装').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('安装'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(2));
    expect(mockReceivedOffsets).toEqual([0]);
  });

  it('explains recovery and checking while their actions are disabled', async () => {
    const recovery = Promise.withResolvers<string | null>();
    jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(recovery.promise);
    const view = await render(<RuntimePanel />);
    try {
      expect(view.getByText('正在恢复下载记录')).toBeTruthy();
      expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(true);
      expect(view.queryByLabelText('下载并安装')).toBeNull();
    } finally {
      await act(async () => recovery.resolve(null));
    }
    const checked = Promise.withResolvers<AppUpdateInfo | null>();
    mockCheck.mockReturnValueOnce(checked.promise);
    await act(async () => {
      void fireEvent.press(view.getByLabelText('检查更新'));
    });
    try {
      expect(view.getByLabelText('检查中').props.accessibilityState.disabled).toBe(true);
      expect(view.getByText('正在检查更新')).toBeTruthy();
    } finally {
      await act(async () => checked.resolve(update()));
    }
  });

  it('shows verification and installer stages instead of stale downloading progress', async () => {
    const inspected = Promise.withResolvers<AppUpdateInfo>();
    const opened = Promise.withResolvers<boolean>();
    const view = await render(<RuntimePanel />);
    await waitFor(() => expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('检查更新'));
    jest.mocked(NativeModules.ApkInstallerModule.inspectApk).mockReturnValueOnce(inspected.promise);
    mockOpen.mockReturnValueOnce(opened.promise);
    await act(async () => {
      void fireEvent.press(view.getByLabelText('下载并安装'));
    });
    await waitFor(() => expect(view.getByLabelText('校验中')).toBeTruthy());
    try {
      expect(view.queryByText(`正在下载 ${update().version}`)).toBeNull();
      expect(view.getByText('正在校验安装包')).toBeTruthy();
      expect(view.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
      expect(view.queryByLabelText('暂停下载')).toBeNull();
      expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(true);
      await act(async () => inspected.resolve(update()));
      await waitFor(() => expect(view.getByLabelText('打开安装确认中')).toBeTruthy());
      expect(view.getByText('正在打开安装确认')).toBeTruthy();
      expect(view.queryByText(`正在下载 ${update().version}`)).toBeNull();
    } finally {
      await act(async () => {
        inspected.resolve(update());
        opened.resolve(true);
      });
    }
    await waitFor(() => expect(view.getByLabelText('安装').props.accessibilityState.disabled).toBe(false));
    expect(view.getByText('已打开安装确认，可随时回来再次安装')).toBeTruthy();
    expect(view.queryByText('安装成功')).toBeNull();
  });

  it('keeps local installation beside an explicit action to replace it with the newer version', async () => {
    save();
    mockFiles.set(target(update(), true), 100);
    mockCheck.mockResolvedValue(update(2));
    const view = await render(<RuntimePanel />);
    await waitFor(() => expect(view.getByLabelText('安装').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('检查更新'));
    expect(view.getByText(`下载新版将替换本地 ${update().version} 的下载任务。`)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('安装'));
    expect(mockReceivedOffsets).toEqual([]);
    expect(mockFiles.has(target(update(), true))).toBe(true);
    await fireEvent.press(view.getByLabelText(`下载新版 ${update(2).version}`));
    await waitFor(() => expect(view.getByText(`本地安装包 ${update(2).version} · 已就绪`)).toBeTruthy());
    expect(mockFiles.has(target(update(), true))).toBe(false);
    expect(mockReceivedOffsets).toEqual([0]);
  });

  it('keeps downloading off the panel and projects pause, resume and install from the same runtime', async () => {
    const stopped = Promise.withResolvers<object | null>();
    mockPlans.push(async (uri, progress) => {
      mockFiles.set(uri, 40);
      progress({ bytesWritten: 40, totalBytes: 100 });
      return stopped.promise;
    });
    mockPause.mockImplementationOnce(async () => {
      stopped.resolve(null);
    });
    const view = await render(<RuntimePanel />);
    await waitFor(() => expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('检查更新'));
    await act(async () => {
      void fireEvent.press(view.getByLabelText('下载并安装'));
    });
    await waitFor(() => expect(view.getByText('40%')).toBeTruthy());
    await view.rerender(<RuntimePanel visible={false} />);
    expect(mockPause).not.toHaveBeenCalled();
    await act(async () => {
      mockFiles.set(target(), 60);
      mockLastProgress!({ bytesWritten: 60, totalBytes: 100 });
    });
    await view.rerender(<RuntimePanel />);
    expect(view.getByText('60%')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('暂停下载'));
    await waitFor(() => expect(view.getByLabelText('继续下载').props.accessibilityState.disabled).toBe(false));
    expect(view.getByText('60%')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('继续下载'));
    await waitFor(() => expect(view.getByLabelText('安装').props.accessibilityState.disabled).toBe(false));
    mockCheck.mockRejectedValueOnce(new Error('检查失败'));
    await fireEvent.press(view.getByLabelText('检查更新'));
    await waitFor(() => expect(view.getByLabelText('安装').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('安装'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(2));
    expect(mockReceivedOffsets).toEqual([0, 60]);
  });

  it('shows unknown total bytes and waits for pausing to settle before enabling resume', async () => {
    const stopped = Promise.withResolvers<object | null>();
    mockPlans.push(async (uri, progress) => {
      mockFiles.set(uri, 40);
      progress({ bytesWritten: 40, totalBytes: -1 });
      return stopped.promise;
    });
    mockPause.mockImplementationOnce(async () => {
      await stopped.promise;
    });
    const view = await render(<RuntimePanel />);
    await waitFor(() => expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(view.getByLabelText('检查更新'));
    await act(async () => {
      void fireEvent.press(view.getByLabelText('下载并安装'));
    });
    await waitFor(() => expect(view.getByRole('progressbar')).toBeTruthy());
    try {
      expect(view.getByRole('progressbar').props.accessibilityValue).toMatchObject({ text: '已下载 40 B' });
      expect(view.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
      await act(async () => {
        void fireEvent.press(view.getByLabelText('暂停下载'));
      });
      expect(view.getByText('正在暂停下载')).toBeTruthy();
      expect(view.getByLabelText('暂停中').props.accessibilityState.disabled).toBe(true);
      expect(view.queryByLabelText('继续下载')).toBeNull();
      expect(view.getByLabelText('检查更新').props.accessibilityState.disabled).toBe(true);
    } finally {
      await act(async () => stopped.resolve(null));
    }
    await waitFor(() => expect(view.getByLabelText('继续下载').props.accessibilityState.disabled).toBe(false));
    expect(view.getByText('下载已暂停，进度已保留')).toBeTruthy();
  });

  it('never resumes a known complete but corrupted partial file', async () => {
    save(update(), 90);
    mockFiles.set(target(), 90);
    const hook = await readyHook();
    expect(hook.result.current.artifact?.downloadedBytes).toBe(0);
    await act(() => hook.result.current.resumeAppUpdateDownload());
    expect(mockReceivedOffsets).toEqual([0]);
  });
});
