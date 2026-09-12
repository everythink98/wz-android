import { describe, expect, it } from 'vitest';
import {
  discourseReadingFromJson,
  findReadingResumeReply,
  mergeDiscourseReading,
  readingResumeAnchor,
  selectDiscourseVisited
} from './discourseReading';
import { createTopicListItemStateIndex, getTopicListItemStateFromIndex } from './topicListItemState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { Topic } from './models';

describe('Discourse reading facts', () => {
  it('selects the nearest surviving successor or predecessor independently of reply order', () => {
    const replies = [80, 40, 20].map((floor) => ({ floor, author: '', createdAt: '', contentHtml: 'body' }));
    expect(findReadingResumeReply(replies, 60)?.floor).toBe(80);
    expect(findReadingResumeReply(replies, 100)?.floor).toBe(80);
    expect(
      findReadingResumeReply(
        replies.map((reply) => ({ ...reply, hidden: true })),
        100
      )
    ).toBeUndefined();
  });
  it('keeps visited separate from new replies and preserves server evidence after local history is cleared', () => {
    const entry = mergeDiscourseReading(
      undefined,
      { topicId: '1', lastReadPostNumber: 40, highestPostNumber: 100, unreadPosts: 0 },
      { sequence: 1, localVersion: 0 },
      false
    );
    const reading = selectDiscourseVisited({ 1: entry });
    const reader = createEmptyReaderData();
    const index = createTopicListItemStateIndex({ ...reader, history: {}, reading });
    const topic: Topic = { id: '1', source: 'linuxdo', title: 'old', author: '', createdAt: '', url: '' };
    expect(getTopicListItemStateFromIndex(index, topic)).toMatchObject({ read: true, hasNewReplies: true });
    expect(getTopicListItemStateFromIndex(index, { ...topic, source: 'nodeseek' }).read).toBe(false);
    expect(getTopicListItemStateFromIndex(index, { ...topic, isPrivateMessage: true })).toMatchObject({ read: false });
    expect(getTopicListItemStateFromIndex(index, { ...topic, isPrivateMessage: true }).hasNewReplies).toBeUndefined();
    expect(readingResumeAnchor(entry)).toEqual({ floor: 41 });
  });

  it('treats missing fields as unknown and prevents an older response from replacing newer local navigation', () => {
    const initial = mergeDiscourseReading(
      undefined,
      { topicId: '1', lastReadPostNumber: 100, highestPostNumber: 200 },
      { sequence: 1, localVersion: 0 },
      false
    );
    const local = { ...initial, anchor: { floor: 40, rowKey: 'row', offset: 3 }, localVersion: 2 };
    const stale = mergeDiscourseReading(
      local,
      { topicId: '1', lastReadPostNumber: 180 },
      { sequence: 2, localVersion: 1 },
      false
    );
    expect(stale.anchor).toEqual(local.anchor);
    const missing = mergeDiscourseReading(stale, { topicId: '1' }, { sequence: 3, localVersion: 2 }, false);
    expect(missing.visited).toBe(true);
    expect(missing.server.lastReadPostNumber).toBe(180);
    expect(
      readingResumeAnchor(
        mergeDiscourseReading(
          missing,
          { topicId: '1', lastReadPostNumber: 180 },
          { sequence: 4, localVersion: 2 },
          false
        )
      )
    ).toEqual({ floor: 181 });
  });

  it('validates floor metadata without turning malformed or omitted values into unread', () => {
    expect(
      discourseReadingFromJson({ id: 1, highest_post_number: -1, last_read_post_number: '9', unread_posts: -1 })
    ).toEqual({ topicId: '1', readPostNumbers: [] });
    expect(
      discourseReadingFromJson({
        id: 1,
        highest_post_number: 20,
        last_read_post_number: null,
        post_stream: {
          posts: [
            { post_number: 2, read: true },
            { post_number: 4, read: false },
            { post_number: -1, read: true }
          ]
        }
      })
    ).toMatchObject({ lastReadPostNumber: null, highestPostNumber: 20, readPostNumbers: [2] });
  });
});
