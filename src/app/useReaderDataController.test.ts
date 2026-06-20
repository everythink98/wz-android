import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyReaderData, toggleFavorite, topicKey } from '../readerData';
import type { Topic } from '../types';
import { prepareReaderDataCommit } from './useReaderDataController';

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

  it('sanitizes changed reader data before persistence', () => {
    const current = createEmptyReaderData();
    const next = prepareReaderDataCommit(current, (value) => toggleFavorite(value, topic));

    expect(next?.favorites[topicKey(topic)]?.topic).toEqual(topic);
  });

  it('does not mark reader data as loaded from a failed load path', () => {
    const source = readFileSync(__filename.replace(/\.test\.ts$/, '.ts'), 'utf8');
    const loadEffect = source.slice(source.indexOf('void loadReaderData()'), source.indexOf('return {'));
    const failedLoadPath = loadEffect.slice(loadEffect.indexOf('.catch((error)'));

    expect(failedLoadPath).not.toContain('readerDataLoadedRef.current = true');
    expect(failedLoadPath).not.toContain('setReaderDataLoaded(true)');
    expect(source).not.toContain('.finally(() => {\n        readerDataLoadedRef.current = true;');
  });
});
