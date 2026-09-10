import { describe, expect, it, vi } from 'vitest';
import { applyReaderChange, createEmptyReaderState, projectReaderCommand } from '@/domain/reader/readerRecordState';
import type { Topic } from '@/domain/forum/models';
vi.mock('@/platform/storage/readerDataStore', () => ({ loadReaderState: vi.fn() }));
import { loadInitialReaderData } from './useReaderRuntime';
const topic: Topic = {
  source: 'nodeseek',
  id: '1',
  title: 'Topic',
  author: 'alice',
  url: 'https://www.nodeseek.com/post-1-1',
  createdAt: '2026-01-01T00:00:00Z'
};

describe('reader runtime state projection', () => {
  it('keeps key references when committed visits only update an existing record', () => {
    const current = projectReaderCommand(createEmptyReaderState(), { type: 'visit', topic, at: topic.createdAt });
    const next = applyReaderChange(current, {
      membership: [{ collection: 'history', key: 'nodeseek:1', present: true }],
      counts: { history: 1 },
      changed: ['history']
    });
    expect(next.history).toBe(current.history);
    expect(next.favorites).toBe(current.favorites);
    expect(next.revisions.history).toBe(1);
  });
  it('absolute favorite intent is idempotent during optimistic rebase', () => {
    const command = { type: 'favorite' as const, topic, enabled: true, at: topic.createdAt };
    const once = projectReaderCommand(createEmptyReaderState(), command);
    expect(projectReaderCommand(once, command)).toBe(once);
    expect(once.counts.favorites).toBe(1);
  });
  it('changes only the affected membership and deduplicates batch removal', () => {
    const current = projectReaderCommand(createEmptyReaderState(), {
      type: 'favorite',
      topic,
      enabled: true,
      at: topic.createdAt
    });
    const next = projectReaderCommand(current, {
      type: 'delete',
      collection: 'favorites',
      keys: ['nodeseek:1', 'nodeseek:1'],
      at: topic.createdAt
    });
    expect(next.counts.favorites).toBe(0);
    expect(next.history).toBe(current.history);
  });
  it('enters existing recovery mode when local restore fails', async () => {
    const notify = vi.fn(),
      onLoaded = vi.fn(),
      onLoadFailed = vi.fn();
    await loadInitialReaderData({
      isActive: () => true,
      load: async () => {
        throw new Error('storage failed');
      },
      notify,
      onLoaded,
      onLoadFailed
    });
    expect(onLoadFailed).toHaveBeenCalledOnce();
    expect(onLoaded).toHaveBeenCalledWith(createEmptyReaderState());
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('恢复模式'));
  });
  it('discards late load success and failure after unmount', async () => {
    const notify = vi.fn(),
      onLoaded = vi.fn(),
      onLoadFailed = vi.fn();
    await loadInitialReaderData({
      isActive: () => false,
      load: async () => createEmptyReaderState(),
      notify,
      onLoaded,
      onLoadFailed
    });
    await loadInitialReaderData({
      isActive: () => false,
      load: async () => {
        throw new Error('late');
      },
      notify,
      onLoaded,
      onLoadFailed
    });
    expect(onLoaded).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(onLoadFailed).not.toHaveBeenCalled();
  });
});
