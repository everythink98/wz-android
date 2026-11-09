import { afterAll, afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import type { ComponentType } from 'react';
import path from 'node:path';
import { Linking } from 'react-native';
import { appQueryClient } from '@/platform/query/serverState';
import { act, fireEvent, render } from '../render';

const mockEntries = new Map<string, ComponentType>();
const mockFiles = new Map<string, string>();
const mockWrites: string[] = [];
const mockSnapshot = jest.fn<() => Promise<object>>();
const mockVerify = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockOpenInstaller = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockResumeFactory = jest.fn<(...args: unknown[]) => unknown>();
let mockSizeFailure: Error | undefined;
const files = ['dev/app-update-proof/index.tsx', 'dev/composer-proof/index.tsx', 'dev/diagnostics-proof/index.tsx'];
const originalFetch = globalThis.fetch;

jest.mock('expo-dev-client', () => ({}));
jest.mock('@/platform/diagnostics/diagnosticBootstrap', () => ({}));
jest.mock('expo', () => ({
  ...jest.requireActual<typeof import('expo')>('expo'),
  registerRootComponent: (component: ComponentType) => mockEntries.set(component.name, component)
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    throw new Error('No database IO is admitted by these entry observers');
  }
}));
jest.mock('expo-file-system', () => {
  const uri = (parts: (string | { uri: string })[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    create() {}
    get exists() {
      return true;
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uri(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      if (this.uri.endsWith('/fixture.part') && mockSizeFailure) throw mockSizeFailure;
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    textSync() {
      return mockFiles.get(this.uri) ?? '';
    }
    create() {}
    write(value: string) {
      mockFiles.set(this.uri, value);
      mockWrites.push(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    move(target: File) {
      mockFiles.set(target.uri, this.textSync());
      mockFiles.delete(this.uri);
      this.uri = target.uri;
    }
  }
  return {
    Directory,
    File,
    Paths: { document: 'document', cache: 'cache' },
    DownloadTask: { fromSavable: (...args: unknown[]) => mockResumeFactory(...args) }
  };
});
jest.mock('@/platform/update/appUpdate', () => ({
  verifyDownloadedApk: (...args: unknown[]) => mockVerify(...args),
  openApkInstaller: (...args: unknown[]) => mockOpenInstaller(...args)
}));
jest.mock('@/platform/diagnostics/nativeDiagnosticJournal', () => ({
  nativeDiagnosticJournal: () => ({ snapshot: mockSnapshot }),
  diagnosticBuildContext: () => ({})
}));
jest.mock('@/platform/diagnostics/diagnostics', () => ({
  beginDiagnosticTrace: () => ({ traceId: 'entry-trace', appSessionId: 'entry-session' }),
  markDiagnosticStage: () => {},
  createTrace: () => ({}),
  finishDiagnosticTrace: () => {},
  recordError: () => {},
  recordDiagnostic: () => {},
  beginDiagnosticSpan: () => ({}),
  finishDiagnosticSpan: () => {}
}));

beforeAll(() => {
  // Complete, unchanged developer entry modules register their actual root components.
  for (const file of files) require(path.resolve(file));
});
beforeEach(() => {
  mockFiles.clear();
  mockWrites.length = 0;
  mockSizeFailure = undefined;
  mockSnapshot.mockReset();
  mockVerify.mockClear();
  mockOpenInstaller.mockClear();
  mockResumeFactory.mockReset();
  globalThis.fetch = jest.fn<typeof fetch>(async (input) => {
    if (input !== 'http://127.0.0.1:39081/manifest') throw new Error('Unmatched entry probe network');
    return new Response(JSON.stringify({ version: 'fixture', versionCode: 1, sha256: 'a'.repeat(64), size: 7 }));
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function entry(name: string) {
  const component = mockEntries.get(name);
  if (!component) throw new Error('Original component did not register: ' + name);
  return component;
}

it('keeps a late initial composer link from clearing shared query data after full-entry unmount', async () => {
  const initial = Promise.withResolvers<string>();
  jest.spyOn(Linking, 'getInitialURL').mockReturnValue(initial.promise);
  const App = entry('App');
  const view = await render(<App />);
  appQueryClient.setQueryData(['whole-entry-proof'], 'retained');
  await view.unmount();
  const clear = jest.spyOn(appQueryClient, 'clear');
  await act(async () => {
    initial.resolve(`wzcomposerproof://${'c'.repeat(32)}?source=nodeseek`);
    await initial.promise;
  });
  expect(clear).not.toHaveBeenCalled();
  expect(appQueryClient.getQueryData(['whole-entry-proof'])).toBe('retained');
});

it('keeps a late diagnostic snapshot from writing after full-entry unmount', async () => {
  const snapshot = Promise.withResolvers<object>();
  mockSnapshot.mockReturnValue(snapshot.promise);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`wzdiag://export/${'d'.repeat(32)}`);
  const App = entry('DiagnosticProofApp');
  const view = await render(<App />);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  await view.unmount();
  await act(async () => {
    snapshot.resolve({});
    await snapshot.promise;
  });
  expect(mockWrites.length).toBe(0);
});

it('unlocks the full update entry after final disk-size observation fails', async () => {
  const App = entry('UpdateDownloadProof');
  const view = await render(<App />);
  mockFiles.set('document/wz-update-proof/fixture.part', 'partial');
  mockSizeFailure = new Error('Whole-entry disk-size failure');
  await fireEvent.press(view.getByRole('button', { name: '载入测试 APK' }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const disabled = view.getByRole('button', { name: '载入测试 APK' }).props.accessibilityState?.disabled;
  expect(disabled).toBe(false);
  mockSizeFailure = undefined;
  await fireEvent.press(view.getByRole('button', { name: '载入测试 APK' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it('keeps the original live diagnostic ready receipt', async () => {
  const snapshot = Promise.withResolvers<object>();
  mockSnapshot.mockReturnValue(snapshot.promise);
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`wzdiag://export/${'e'.repeat(32)}`);
  const App = entry('DiagnosticProofApp');
  const view = await render(<App />);
  await act(async () => {
    snapshot.resolve({});
    await snapshot.promise;
  });
  expect(mockWrites).toEqual(['cache/diagnostic-proof.json']);
  expect(JSON.parse(mockFiles.get(mockWrites[0]!)!)).toMatchObject({ checkpoint: 'ready', proofToken: 'e'.repeat(32) });
  await view.unmount();
});

it('reuses the restored complete update file without fetching an APK', async () => {
  mockFiles.set(
    'document/wz-update-proof/fixture.json',
    JSON.stringify({ version: 'fixture', versionCode: 1, sha256: 'a'.repeat(64), size: 7 })
  );
  mockFiles.set('document/wz-update-proof/fixture.apk', 'fullapk');
  const App = entry('UpdateDownloadProof');
  const view = await render(<App />);
  await fireEvent.press(view.getByRole('button', { name: '校验并打开安装确认' }));
  expect(mockVerify).toHaveBeenCalledWith(
    undefined,
    'document/wz-update-proof/fixture.apk',
    expect.objectContaining({ sha256: 'a'.repeat(64) })
  );
  expect(mockOpenInstaller).toHaveBeenCalledWith(undefined, 'document/wz-update-proof/fixture.apk');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(mockFiles.get('document/wz-update-proof/fixture.apk')).toBe('fullapk');
  await view.unmount();
});

it('pauses and resumes from the retained real entry disk offset before completing', async () => {
  mockFiles.set(
    'document/wz-update-proof/fixture.json',
    JSON.stringify({ version: 'fixture', versionCode: 1, sha256: 'a'.repeat(64), size: 7 })
  );
  mockFiles.set('document/wz-update-proof/fixture.part', '123');
  const pending = Promise.withResolvers<object | null>();
  const first = {
    resumeAsync: jest.fn(() => pending.promise),
    pauseAsync: jest.fn(async () => {
      pending.resolve(null);
    }),
    release: jest.fn()
  };
  const second = {
    resumeAsync: jest.fn(async () => {
      mockFiles.set('document/wz-update-proof/fixture.part', 'fullapk');
      return {};
    }),
    release: jest.fn()
  };
  mockResumeFactory.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const App = entry('UpdateDownloadProof');
  const view = await render(<App />);
  await fireEvent.press(view.getByRole('button', { name: /下载\/续传 APK/i }));
  await fireEvent.press(view.getByRole('button', { name: '暂停' }));
  await act(async () => {
    await pending.promise;
  });
  expect(first.pauseAsync).toHaveBeenCalledTimes(1);
  expect(first.release).toHaveBeenCalledTimes(1);
  expect(mockVerify).not.toHaveBeenCalled();
  expect(mockFiles.get('document/wz-update-proof/fixture.part')).toBe('123');
  await fireEvent.press(view.getByRole('button', { name: /下载\/续传 APK/i }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockResumeFactory.mock.calls.map(([value]) => value)).toEqual([
    expect.objectContaining({ resumeData: '3', fileUri: 'document/wz-update-proof/fixture.part' }),
    expect.objectContaining({ resumeData: '3', fileUri: 'document/wz-update-proof/fixture.part' })
  ]);
  expect(second.release).toHaveBeenCalledTimes(1);
  expect(mockVerify).toHaveBeenCalledTimes(1);
  expect(mockFiles.get('document/wz-update-proof/fixture.apk')).toBe('fullapk');
  expect(mockFiles.has('document/wz-update-proof/fixture.part')).toBe(false);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await view.unmount();
});

it('preserves the primary update feedback and disk observation failure while unlocking', async () => {
  const primary = Object.assign(new Error('Manifest failed'), { code: 'E_MANIFEST' });
  globalThis.fetch = jest.fn<typeof fetch>(async () => {
    throw primary;
  });
  const App = entry('UpdateDownloadProof');
  const view = await render(<App />);
  mockFiles.set('document/wz-update-proof/fixture.part', 'partial');
  mockSizeFailure = new Error('Disk observation failed');
  await fireEvent.press(view.getByRole('button', { name: '载入测试 APK' }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const feedback = view.queryByText(/测试操作失败：E_MANIFEST/);
  expect(feedback).toBeTruthy();
  expect(feedback?.props.children).toContain('测试操作失败：E_MANIFEST Manifest failed');
  expect(feedback?.props.children).toContain('Disk observation failed');
  expect(view.getByRole('button', { name: '载入测试 APK' }).props.accessibilityState?.disabled).toBe(false);
});
