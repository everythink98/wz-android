import { describe, expect, it } from 'vitest';
import { createEmptyReaderData, recordHistory, toggleFavorite } from './readerData';
import { getTopicListItemState, topicListItemStatesEqual } from './topicListItemState';
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
  it('keeps list rows driven by compact primitive state', () => {
    let data = createEmptyReaderData();
    data = {
      ...data,
      settings: {
        ...data.settings,
        trackedKeywords: ['动画'],
        listDensity: 'loose'
      }
    };
    const detail = { ...topic, contentHtml: '<p></p>', replies: [] };
    data = recordHistory(data, detail);
    data = toggleFavorite(data, topic);

    expect(getTopicListItemState(data, topic)).toEqual({
      favorite: true,
      listDensity: 'loose',
      read: true,
      tracked: true
    });
  });

  it('compares primitive row state without depending on the whole reader data object', () => {
    const state = getTopicListItemState(createEmptyReaderData(), topic);

    expect(topicListItemStatesEqual(state, { ...state })).toBe(true);
    expect(topicListItemStatesEqual(state, { ...state, favorite: true })).toBe(false);
  });
});
