import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData, topicKey } from '@/domain/reader/readerData';
import {
  createTopicListItemStateIndex,
  createTopicListItemStateStore,
  getTopicListItemStateFromIndex
} from './topicListItemState';
import type { Topic } from './models';

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
    data.history[topicKey(topic)] = { topic, savedAt: topic.createdAt, visitCount: 1 };
    data.favorites[topicKey(topic)] = { topic, savedAt: topic.createdAt };

    const index = createTopicListItemStateIndex(data);

    expect(Object.keys(index).sort()).toEqual(['favorites', 'history', 'listDensity']);
    expect(getTopicListItemStateFromIndex(index, topic)).toEqual({
      favorite: true,
      listDensity: 'compact',
      read: true
    });
  });

  it('only notifies card selectors whose visible state changed', () => {
    const data = createEmptyReaderData();
    const store = createTopicListItemStateStore(createTopicListItemStateIndex(data));
    const selected = store.select(topic);
    const other = store.select({ ...topic, id: '2' });
    const onSelected = vi.fn();
    const onOther = vi.fn();
    const unsubscribe = selected.subscribe(onSelected);
    other.subscribe(onOther);
    const otherBefore = other.getSnapshot();

    store.setIndex(
      createTopicListItemStateIndex({
        ...data,
        history: { [topicKey(topic)]: { topic, savedAt: topic.createdAt, visitCount: 1 } }
      })
    );
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
    expect(selected.getSnapshot().read).toBe(true);
    expect(other.getSnapshot()).toBe(otherBefore);

    unsubscribe();
    store.setIndex(createTopicListItemStateIndex(data));
    expect(onSelected).toHaveBeenCalledTimes(1);
    expect(selected.getSnapshot().read).toBe(false);
  });

  it('looks up topic row state without enumerating ReaderData records', () => {
    const data = createEmptyReaderData();
    data.history[topicKey(topic)] = { topic, savedAt: topic.createdAt, visitCount: 1 };
    data.favorites[topicKey(topic)] = { topic, savedAt: topic.createdAt };
    let ownKeysCalls = 0;
    const countOwnKeys = <T extends object>(value: T) =>
      new Proxy(value, {
        ownKeys(target) {
          ownKeysCalls += 1;
          return Reflect.ownKeys(target);
        }
      });

    const index = createTopicListItemStateIndex({
      ...data,
      favorites: countOwnKeys(data.favorites),
      history: countOwnKeys(data.history)
    });

    expect(getTopicListItemStateFromIndex(index, topic)).toMatchObject({ favorite: true, read: true });
    expect(ownKeysCalls).toBe(0);
  });
});
