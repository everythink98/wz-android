import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData, toggleFavorite, topicKey } from '../readerData';
import type { Topic } from '../types';
import { loadInitialReaderData, prepareReaderDataCommit, rollbackFailedReaderDataSave } from './useReaderDataController';

const topic: Topic = {
  source: 'nodeseek',
  id: '723704',
  title: 'NodeSeek topic',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-723704-1',
  createdAt: '2026-05-18T11:34:13.000Z',
  replyCount: 2
};

describe('reader data controller helpers', () => {
  it('skips persistence when a commit updater returns the current object', () => {
    const current = createEmptyReaderData();

    expect(prepareReaderDataCommit(current, (value) => value)).toBeNull();
  });

  it('keeps sanitized reader data commits and lets storage skip unchanged writes', () => {
    const current = createEmptyReaderData();

    const next = prepareReaderDataCommit(current, (value) => ({
      ...value,
      favorites: undefined as unknown as typeof value.favorites
    }));

    expect(next).toEqual(current);
    expect(next).not.toBe(current);
  });

  it('sanitizes changed reader data before persistence', () => {
    const current = createEmptyReaderData();
    const next = prepareReaderDataCommit(current, (value) => toggleFavorite(value, topic));

    expect(next?.favorites[topicKey(topic)]?.topic).toEqual(topic);
  });

  it('rolls reader data back when the failed save is still the visible state', () => {
    const previous = createEmptyReaderData();
    const failed = toggleFavorite(previous, topic);

    expect(rollbackFailedReaderDataSave(failed, failed, previous)).toBe(previous);
  });

  it('keeps newer reader data when an older save fails later', () => {
    const previous = createEmptyReaderData();
    const failed = toggleFavorite(previous, topic);
    const newer = {
      ...failed,
      settings: {
        ...failed.settings,
        theme: 'dark' as const
      }
    };

    expect(rollbackFailedReaderDataSave(newer, failed, previous)).toBe(newer);
  });

  it('rolls reader data back to the last persisted state after chained optimistic saves fail', () => {
    const persisted = createEmptyReaderData();
    const firstOptimistic = toggleFavorite(persisted, topic);
    const secondTopic: Topic = { ...topic, id: '723705', title: 'Second topic' };
    const failed = toggleFavorite(firstOptimistic, secondTopic);

    expect(rollbackFailedReaderDataSave(failed, failed, firstOptimistic, persisted)).toBe(persisted);
  });

  it('enters recovery mode from a failed load path', async () => {
    const notify = vi.fn();
    const onLoaded = vi.fn();
    const onLoadFailed = vi.fn();

    await loadInitialReaderData({
      isActive: () => true,
      load: async () => {
        throw new Error('bad storage');
      },
      notify,
      onLoaded,
      onLoadFailed
    });

    expect(onLoadFailed).toHaveBeenCalled();
    expect(onLoaded).toHaveBeenCalledWith(createEmptyReaderData());
    expect(notify).toHaveBeenCalledWith('本机资料读取失败，已进入恢复模式；请先导入备份再修改本机资料：bad storage');
  });
});
