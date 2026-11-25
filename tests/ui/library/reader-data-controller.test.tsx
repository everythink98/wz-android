import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClient } from '@tanstack/react-query';
import { createQueryTestWrapper } from '../QueryTestWrapper';
import {
  createEmptyReaderState,
  type ReaderChange,
  type ReaderCommand,
  type ReaderState
} from '@/domain/reader/readerRecordState';
import type { Topic } from '@/domain/forum/models';
const mockLoad = jest.fn<() => Promise<ReaderState>>();
const mockCommit = jest.fn<(command: ReaderCommand) => Promise<ReaderChange>>();
const mockImport = jest.fn<(json: string, recovery: boolean) => Promise<ReaderState>>();
const mockExport = jest.fn<() => Promise<string>>();
const mockFreezeListeners = new Set<() => void>();
jest.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderState: () => mockLoad(),
  subscribeReaderStorageFreeze: (listener: () => void) => {
    mockFreezeListeners.add(listener);
    return () => mockFreezeListeners.delete(listener);
  },
  commitReaderCommand: (command: ReaderCommand) => mockCommit(command),
  importReaderDataBackup: (json: string, recovery: boolean) => mockImport(json, recovery),
  exportReaderDataBackup: () => mockExport()
}));
import { useReaderRuntime } from '@/app/useReaderRuntime';
const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'Topic',
  author: 'alice',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-01-01T00:00:00Z'
};
const favorite: ReaderCommand = { type: 'favorite', topic, enabled: true, at: topic.createdAt };
const added: ReaderChange = {
  membership: [{ collection: 'favorites', key: 'nodeseek:1', present: true }],
  counts: { favorites: 1 },
  changed: ['favorites']
};
async function setup() {
  const notify = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = createQueryTestWrapper(client);
  const hook = await renderHook(() => useReaderRuntime({ notify }), { wrapper });
  await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));
  return { hook, notify, client };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockFreezeListeners.clear();
  mockLoad.mockResolvedValue(createEmptyReaderState());
  mockCommit.mockResolvedValue(added);
  mockImport.mockResolvedValue(createEmptyReaderState());
  mockExport.mockResolvedValue('{}');
});
describe('reader command optimistic persistence', () => {
  it('keeps durable command invalidation after the observing runtime unmounts', async () => {
    const pending = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(pending.promise);
    const { hook, notify, client } = await setup();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    await hook.unmount();
    await act(async () => {
      pending.resolve(added);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reader-library', 'favorites'] });
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'keeps current reader hydration and commands after StrictMode retires a late %s load',
    async (outcome) => {
      const pending = Promise.withResolvers<ReaderState>();
      mockLoad.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(createEmptyReaderState());
      const notify = jest.fn();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Wrapper = createQueryTestWrapper(client);
      let controller!: ReturnType<typeof useReaderRuntime>;
      let setups = 0;
      function Harness() {
        controller = useReaderRuntime({ notify });
        useLayoutEffect(() => {
          setups += 1;
        }, []);
        return null;
      }
      const root = createRoot({ isStrictMode: true });
      try {
        await act(async () =>
          root.render(
            <Wrapper>
              <Harness />
            </Wrapper>
          )
        );
        expect(setups).toBe(2);
        expect(controller.readerStatus).toBe('ready');
        await act(async () => {
          if (outcome === 'success') pending.resolve(createEmptyReaderState());
          else pending.reject(new Error('old reader load failure'));
          controller.commitReaderData(favorite);
        });
        expect(mockLoad).toHaveBeenCalledTimes(2);
        expect(mockCommit).toHaveBeenCalledTimes(1);
        expect(controller.readerData.counts.favorites).toBe(1);
        expect(notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve(createEmptyReaderState());
        await act(async () => root.unmount());
      }
    }
  );
  it('finishes a dispatched reader command without notifying its retired runtime', async () => {
    const pending = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(pending.promise);
    const { hook, notify } = await setup();
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
    await hook.unmount();
    await act(async () => {
      pending.reject(new Error('retired reader failure'));
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps a held reader command and uses the latest notice without reloading for callback changes', async () => {
    const pending = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(pending.promise);
    const firstNotify = jest.fn();
    const latestNotify = jest.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = await renderHook(
      ({ notify }: Parameters<typeof useReaderRuntime>[0]) => useReaderRuntime({ notify }),
      {
        initialProps: { notify: firstNotify },
        wrapper: createQueryTestWrapper(client)
      }
    );
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    await hook.rerender({ notify: latestNotify });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error('current reader failure'));
    });
    expect(firstNotify).not.toHaveBeenCalled();
    expect(latestNotify).toHaveBeenCalledWith('current reader failure');
  });

  it('shows favorite intent immediately and restores committed state on failure', async () => {
    const save = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(save.promise);
    const { hook, notify } = await setup();
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(hook.result.current.readerData.counts.favorites).toBe(1);
    await act(async () => {
      save.reject(new Error('write failed'));
    });
    await waitFor(() => expect(hook.result.current.readerData.counts.favorites).toBe(0));
    expect(notify).toHaveBeenCalledWith('write failed');
  });
  it('rebases later settings after an earlier favorite fails without keeping its uncommitted record', async () => {
    const first = Promise.withResolvers<ReaderChange>();
    const second = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook } = await setup();
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
      hook.result.current.commitReaderData({ type: 'settings', patch: { theme: 'dark' } });
    });
    await act(async () => {
      first.reject(new Error('first failed'));
    });
    expect(hook.result.current.readerData.favorites).toEqual({});
    expect(hook.result.current.readerData.settings.theme).toBe('dark');
    expect(hook.result.current.readerDataRef.current).toBe(hook.result.current.readerData);
    expect(hook.result.current.readerDataRef.current.favorites).toEqual({});
    await act(async () => {
      second.resolve({
        membership: [],
        counts: {},
        changed: [],
        settings: { ...createEmptyReaderState().settings, theme: 'dark' }
      });
    });
    expect(hook.result.current.readerData.settings.theme).toBe('dark');
  });
  it('does not turn a queued disable into enable when an earlier enable fails', async () => {
    const first = Promise.withResolvers<ReaderChange>();
    const second = Promise.withResolvers<ReaderChange>();
    mockCommit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook } = await setup();
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
      hook.result.current.commitReaderData({ ...favorite, enabled: false });
    });
    await act(async () => {
      first.reject(new Error('first failed'));
    });
    expect(hook.result.current.readerData.counts.favorites).toBe(0);
    await act(async () => {
      second.resolve({ membership: [], counts: {}, changed: [] });
    });
    expect(hook.result.current.readerData.favorites).toEqual({});
    expect(mockCommit.mock.calls[1][0]).toMatchObject({ type: 'favorite', enabled: false });
  });
  it('preserves key references on repeated visits and refreshes only affected library queries', async () => {
    const state = createEmptyReaderState();
    state.history = { 'nodeseek:1': true };
    state.counts.history = 1;
    mockLoad.mockResolvedValue(state);
    mockCommit.mockResolvedValue({
      membership: [{ collection: 'history', key: 'nodeseek:1', present: true }],
      counts: { history: 1 },
      changed: ['history']
    });
    const { hook, client } = await setup();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const keys = hook.result.current.readerData.history;
    await act(async () => {
      hook.result.current.commitReaderData({ type: 'visit', topic, at: topic.createdAt });
    });
    expect(hook.result.current.readerData.history).toBe(keys);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reader-library', 'history'] });
  });
  it('blocks ordinary writes in recovery and uses the explicit backup recovery operation', async () => {
    mockLoad.mockRejectedValue(new Error('bad disk'));
    const { hook, notify } = await setup();
    expect(hook.result.current.readerStatus).toBe('recovery');
    await expect(hook.result.current.exportBackup()).rejects.toThrow('尚未恢复');
    mockImport.mockRejectedValueOnce(new Error('invalid backup'));
    await act(async () => {
      await expect(hook.result.current.importBackup('bad')).rejects.toThrow('invalid backup');
    });
    expect(hook.result.current.readerStatus).toBe('recovery');
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('先导入备份'));
    await act(async () => {
      await hook.result.current.importBackup('{"version":2}');
    });
    expect(mockImport).toHaveBeenCalledWith('{"version":2}', true);
    expect(hook.result.current.readerStatus).toBe('ready');
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
  it('blocks later mutations when rollback cannot establish committed state', async () => {
    mockCommit.mockImplementationOnce(async () => {
      for (const listener of mockFreezeListeners) listener();
      throw new AggregateError([], 'rollback failed');
    });
    const { hook } = await setup();
    expect(hook.result.current.readerStatus).toBe('ready');
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.readerStatus).toBe('restart-required');
  });
  it('protects settings when backup import rollback fails after a ready startup', async () => {
    const { hook } = await setup();
    mockImport.mockImplementationOnce(async () => {
      for (const listener of mockFreezeListeners) listener();
      throw new AggregateError([], 'import rollback failed');
    });
    await act(async () => {
      await expect(hook.result.current.importBackup('backup')).rejects.toThrow('import rollback failed');
      hook.result.current.commitReaderData(favorite);
    });
    expect(hook.result.current.readerStatus).toBe('restart-required');
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('blocks further changes and preserves the known data after a backup export freezes storage', async () => {
    const { hook } = await setup();
    await act(async () => hook.result.current.commitReaderData(favorite));
    const trusted = hook.result.current.readerData;
    mockExport.mockImplementationOnce(async () => {
      for (const listener of mockFreezeListeners) listener();
      throw new AggregateError([], 'export rollback failed');
    });

    await act(async () => {
      await expect(hook.result.current.exportBackup()).rejects.toThrow('export rollback failed');
      hook.result.current.commitReaderData({ ...favorite, enabled: false });
      await expect(hook.result.current.importBackup('backup')).rejects.toThrow(
        '本机资料事务状态不明，请重新启动后恢复。'
      );
    });

    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockImport).not.toHaveBeenCalled();
    expect(hook.result.current.readerStatus).toBe('restart-required');
    expect(hook.result.current.readerData).toBe(trusted);
  });
});
