import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createEmptyReaderData, recordHistory, toggleFavorite, type ReaderData } from '@/domain/reader/readerData';
import type { Topic } from '@/domain/forum/models';

const mockLoadReaderData = jest.fn<() => Promise<ReaderData>>();
const mockSaveCleanReaderData =
  jest.fn<(data: ReaderData, previousJson?: string | null, cleanJson?: string) => Promise<ReaderData>>();
const mockSaveReaderSettings = jest.fn<() => Promise<void>>();

jest.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderData: () => mockLoadReaderData(),
  saveCleanReaderData: (data: ReaderData, previousJson?: string | null, cleanJson?: string) =>
    mockSaveCleanReaderData(data, previousJson, cleanJson),
  saveReaderSettings: () => mockSaveReaderSettings()
}));

import { useReaderDataController } from '@/features/library/useReaderDataController';

const topic: Topic = {
  source: 'nodeseek',
  id: 'reader-data-race',
  title: 'Reader data race',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-reader-data-race-1',
  createdAt: '2026-07-19T00:00:00.000Z',
  replyCount: 1
};

describe('reader data controller persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadReaderData.mockResolvedValue(createEmptyReaderData());
    mockSaveCleanReaderData.mockImplementation(async (data) => data);
    mockSaveReaderSettings.mockResolvedValue(undefined);
  });

  it('[REG-PERF-001] persists the bounded history snapshot through the existing save queue', async () => {
    const hook = await renderHook(() => useReaderDataController({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));

    await act(async () => {
      hook.result.current.commitReaderData('history-recorded', (current) => recordHistory(current, topic));
    });
    await act(async () => {
      await hook.result.current.waitForReaderDataSave();
    });

    expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1);
    expect(mockSaveCleanReaderData.mock.calls[0]?.[0].history['nodeseek:reader-data-race']?.visitCount).toBe(1);
  });

  it('[REG-DATA-002] persists a full snapshot after an older record save fails before a settings change', async () => {
    const firstSave = Promise.withResolvers<ReaderData>();
    mockSaveCleanReaderData.mockImplementationOnce(() => firstSave.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useReaderDataController({ notify }));
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));

    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    });
    await waitFor(() => expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1));

    await act(async () => {
      hook.result.current.commitReaderData('settings-updated', (current) => ({
        ...current,
        settings: { ...current.settings, theme: 'dark' }
      }));
      firstSave.reject(new Error('first record save failed'));
    });

    await waitFor(() => expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(2));
    const recoveredSnapshot = mockSaveCleanReaderData.mock.calls[1]?.[0];
    expect(Object.keys(recoveredSnapshot?.favorites || {})).toHaveLength(1);
    expect(recoveredSnapshot?.settings.theme).toBe('dark');
    expect(mockSaveReaderSettings).not.toHaveBeenCalled();
  });

  it('[REG-DATA-003] suspends later mutations when a failed save cannot restore its previous snapshot', async () => {
    mockSaveCleanReaderData.mockRejectedValueOnce(
      new AggregateError(
        [new Error('settings write failed'), new Error('snapshot rollback failed')],
        '本机资料保存失败，且无法恢复先前快照。'
      )
    );
    const notify = jest.fn();
    const hook = await renderHook(() => useReaderDataController({ notify }));
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));

    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    });
    await waitFor(() => expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('本机资料保存失败，且无法恢复先前快照。'));

    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    });

    await act(async () => {
      await hook.result.current.waitForReaderDataSave().catch(() => undefined);
    });

    expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith('本机资料读取失败，请先导入备份再修改本机资料。');
  });

  it('[REG-DATA-003] cancels already queued saves after an earlier save cannot restore its snapshot', async () => {
    const firstSave = Promise.withResolvers<ReaderData>();
    mockSaveCleanReaderData.mockImplementationOnce(() => firstSave.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useReaderDataController({ notify }));
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));

    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    });
    await waitFor(() => expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1));

    const secondTopic: Topic = { ...topic, id: 'reader-data-race-queued', title: 'Queued reader data race' };
    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, secondTopic));
      firstSave.reject(
        new AggregateError(
          [new Error('settings write failed'), new Error('snapshot rollback failed')],
          '本机资料保存失败，且无法恢复先前快照。'
        )
      );
    });

    await act(async () => {
      await hook.result.current.waitForReaderDataSave().catch(() => undefined);
    });

    expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('本机资料保存失败，且无法恢复先前快照。');
    expect(Object.keys(hook.result.current.readerData.favorites)).toHaveLength(0);
  });

  it('[REG-DATA-004] force-writes an identical backup while recovering from an unknown disk state', async () => {
    let physicalWrites = 0;
    mockSaveCleanReaderData
      .mockRejectedValueOnce(
        new AggregateError(
          [new Error('settings write failed'), new Error('snapshot rollback failed')],
          '本机资料保存失败，且无法恢复先前快照。'
        )
      )
      .mockImplementationOnce(async (data, previousJson, cleanJson) => {
        if (previousJson !== cleanJson) {
          physicalWrites += 1;
        }
        return data;
      });
    const hook = await renderHook(() => useReaderDataController({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.readerDataLoaded).toBe(true));

    await act(async () => {
      hook.result.current.commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    });
    await act(async () => {
      await hook.result.current.waitForReaderDataSave().catch(() => undefined);
    });

    await act(async () => {
      await hook.result.current.replaceReaderData('backup-imported', createEmptyReaderData());
    });

    expect(mockSaveCleanReaderData).toHaveBeenCalledTimes(2);
    expect(physicalWrites).toBe(1);
  });
});
