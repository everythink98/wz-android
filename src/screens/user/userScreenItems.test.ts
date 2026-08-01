import { describe, expect, it } from 'vitest';
import type { Topic, UserProfile, UserReplyActivity } from '@/domain/forum/models';
import {
  createUserListItems,
  userListInstanceKey,
  userListItemKey,
  userListItemType
} from '@/screens/user/userScreenItems';

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

const user: UserProfile = {
  source: 'nodeseek',
  id: '42',
  username: 'tester',
  url: 'https://www.nodeseek.com/space/42',
  topics: [topic],
  replies: [reply]
};

describe('user screen list items', () => {
  it('keeps profile content out of the virtualized list data', () => {
    expect(createUserListItems('topics', [topic], [reply])).toEqual([{ type: 'topic', key: 'nodeseek:101', topic }]);
    expect(createUserListItems('replies', [topic], [reply])).toEqual([
      { type: 'reply', key: 'nodeseek:reply:comment-201', reply }
    ]);
  });

  it('uses distinct list identity for user and tab changes', () => {
    expect(userListInstanceKey(user, 'topics')).toBe('nodeseek:42:topics');
    expect(userListInstanceKey(user, 'topics')).not.toBe(userListInstanceKey(user, 'replies'));
    expect(userListInstanceKey({ ...user, id: '43' }, 'topics')).not.toBe(userListInstanceKey(user, 'topics'));
  });

  it('exposes stable FlashList keys and item types', () => {
    const [topicItem] = createUserListItems('topics', [topic], []);

    expect(userListItemKey(topicItem)).toBe('nodeseek:101');
    expect(userListItemType(topicItem)).toBe('topic');
  });

  it('keeps virtualized list keys unique when a source returns duplicate ids', () => {
    const items = createUserListItems('replies', [], [reply, { ...reply }]);

    expect(items.map(userListItemKey)).toEqual(['nodeseek:reply:comment-201', 'nodeseek:reply:comment-201:2']);
  });
});
