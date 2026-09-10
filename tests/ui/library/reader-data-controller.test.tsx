import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
jest.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderState: () => mockLoad(),
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useReaderRuntime({ notify }), { wrapper });
  await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));
  return { hook, notify, client };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(createEmptyReaderState());
  mockCommit.mockResolvedValue(added);
  mockImport.mockResolvedValue(createEmptyReaderState());
  mockExport.mockResolvedValue('{}');
});
describe('reader command optimistic persistence', () => {
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
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('先导入备份'));
    await act(async () => {
      await hook.result.current.importBackup('{"version":2}');
    });
    expect(mockImport).toHaveBeenCalledWith('{"version":2}', true);
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
  it('blocks later mutations when rollback cannot establish committed state', async () => {
    mockCommit.mockRejectedValueOnce(new AggregateError([], 'rollback failed'));
    const { hook } = await setup();
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    await act(async () => {
      hook.result.current.commitReaderData(favorite);
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
});
