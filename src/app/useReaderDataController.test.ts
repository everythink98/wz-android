import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyReaderData,
  recordHistory,
  toggleFavorite,
  topicKey,
  updateFavoriteTopic
} from '../readerData';
import { setDiagnosticWriter } from '../diagnostics';
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

afterEach(() => {
  setDiagnosticWriter(null);
});

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

  it('[REG-PERF-001] trusts only bounded history-recorded mutations without rebuilding the snapshot', () => {
    const current = toggleFavorite(createEmptyReaderData(), topic);
    const refreshedTopic = { ...topic, title: 'Updated topic' };
    const updated = updateFavoriteTopic(recordHistory(current, refreshedTopic), refreshedTopic);

    const historyCommit = prepareReaderDataCommit(current, () => updated, 'history-recorded');
    const regularCommit = prepareReaderDataCommit(current, () => updated, 'favorite-toggled');

    expect(historyCommit).toBe(updated);
    expect(historyCommit?.favorites[topicKey(topic)]?.topic.title).toBe('Updated topic');
    expect(regularCommit).not.toBe(updated);
    expect(regularCommit?.history[topicKey(topic)]?.visitCount).toBe(1);
  });

  it('keeps record maps untouched when only settings change', () => {
    const current = toggleFavorite(createEmptyReaderData(), topic);
    const next = prepareReaderDataCommit(current, (value) => ({
      ...value,
      settings: {
        ...value.settings,
        theme: 'dark'
      }
    }));

    expect(next?.settings.theme).toBe('dark');
    expect(next?.favorites).toBe(current.favorites);
    expect(next?.history).toBe(current.history);
    expect(next?.followedUsers).toBe(current.followedUsers);
    expect(next?.deletedRecords).toBe(current.deletedRecords);
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
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
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
    const events = diagnosticLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([
      expect.objectContaining({ area: 'reader-data', operation: 'load', phase: 'intent' }),
      expect.objectContaining({
        area: 'reader-data',
        operation: 'load',
        phase: 'apply',
        state: 'recovery-mode'
      }),
      expect.objectContaining({
        area: 'reader-data',
        operation: 'load',
        phase: 'finish',
        outcome: 'failure',
        reason: 'storage_error'
      })
    ]);
    expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
  });
});
