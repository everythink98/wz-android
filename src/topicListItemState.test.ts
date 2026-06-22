import { describe, expect, it } from 'vitest';
import { createEmptyReaderData, recordHistory, toggleFavorite } from './readerData';
import { createTopicListItemStateIndex, getTopicListItemStateFromIndex } from './topicListItemState';
import type { Topic } from './types';

const topic: Topic = {
  source: 'nodeseek',
  id: '723704',
  title: 'React Native 性能优化',
  author: 'alice',
  category: '开发',
  url: 'https://www.nodeseek.com/post-723704-1',
  createdAt: '2026-05-18T11:34:13.000Z',
  lastReplyAt: '2026-05-18T12:34:13.000Z',
  replyCount: 2,
  excerpt: 'FlatList 和动画'
};

describe('Android topic list item state', () => {
  it('precomputes compact topic row state for list screens', () => {
    let data = createEmptyReaderData();
    data = {
      ...data,
      settings: {
        ...data.settings,
        listDensity: 'compact'
      }
    };
    data = recordHistory(data, topic);
    data = toggleFavorite(data, topic);

    const index = createTopicListItemStateIndex(data);

    expect(Object.keys(index).sort()).toEqual(['favorites', 'history', 'listDensity']);
    expect(getTopicListItemStateFromIndex(index, topic)).toEqual({
      favorite: true,
      listDensity: 'compact',
      read: true
    });
  });
});
