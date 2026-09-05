import { describe, expect, it } from 'vitest';
import type { Topic, UserReplyActivity } from '@/domain/forum/models';
import { createUserListItems, userListItemKey } from './userScreenItems';

const topic: Topic = {
  source: 'nodeseek',
  id: '101',
  title: '主题',
  author: 'author',
  url: 'https://www.nodeseek.com/post-101-1',
  createdAt: '',
  replyCount: 0
};

const reply: UserReplyActivity = {
  source: 'nodeseek',
  id: 'comment-201',
  topicId: '101',
  topicTitle: '主题',
  topicUrl: 'https://www.nodeseek.com/post-101-1',
  url: 'https://www.nodeseek.com/post-101-1#comment-201'
};

describe('user screen list items', () => {
  it('places activity tabs before content while profile data stays in the list header', () => {
    expect(createUserListItems('topics', [topic], [reply])).toEqual([
      { type: 'tabs', key: 'user-activity-tabs' },
      { type: 'topic', key: 'nodeseek:101', topic }
    ]);
    expect(createUserListItems('replies', [topic], [reply])).toEqual([
      { type: 'tabs', key: 'user-activity-tabs' },
      { type: 'reply', key: 'nodeseek:reply:comment-201', reply }
    ]);
  });

  it('keeps virtualized list keys unique when a source returns duplicate ids', () => {
    const items = createUserListItems('replies', [], [reply, { ...reply }]);

    expect(items.map(userListItemKey)).toEqual([
      'user-activity-tabs',
      'nodeseek:reply:comment-201',
      'nodeseek:reply:comment-201:2'
    ]);
  });
});
