import { describe, expect, it } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import type { RepliesResponse, Reply, TopicDetail } from '@/domain/forum/models';
import { forumQueryKeys } from './serverState';
import { initialForumSessionEpochs } from './sessionEpochs';
import { syncDiscoursePolicyCaches } from './discoursePolicyCache';

const policy: DiscoursePostPolicy = {
  postId: '77',
  version: 'v1',
  acceptLabel: '接受',
  revokeLabel: '撤回',
  accepted: false,
  revoked: false,
  canAccept: true,
  canRevoke: false
};
const accepted = { ...policy, accepted: true, canAccept: false, canRevoke: true };
const reply: Reply = { author: 'admin', contentHtml: '<p>公告</p>', createdAt: '', policy };
const topic: TopicDetail = {
  source: 'linuxdo',
  id: '293017',
  title: '公告',
  author: 'admin',
  url: 'https://linux.do/t/293017',
  createdAt: '',
  contentHtml: '<p>公告</p>',
  replies: [reply],
  policy
};
const scope = { ...initialForumSessionEpochs, linuxdo: 7 };
const key = forumQueryKeys.topic({ source: 'linuxdo', topicId: topic.id, scope, readPlanScope: 'authenticated:7' });

describe('authoritative Discourse policy cache projection', () => {
  it('updates existing topic, individual reply and paginated reply policies without changing page metadata', () => {
    const client = new QueryClient();
    const replyKey = forumQueryKeys.reply({
      source: 'linuxdo',
      topicId: topic.id,
      scope,
      readPlanScope: 'authenticated:7',
      postNumber: 2
    });
    const repliesKey = forumQueryKeys.replies(key, 'oldest', 'authenticated:7');
    const pages: InfiniteData<RepliesResponse> = {
      pageParams: [1],
      pages: [{ items: [reply], hasMore: true, nextPage: 2 }]
    };
    client.setQueryData(key, topic);
    client.setQueryData(replyKey, reply);
    client.setQueryData(repliesKey, pages);
    syncDiscoursePolicyCaches(client, { topicId: topic.id, sessionEpoch: 7, policy: accepted });
    expect(client.getQueryData<TopicDetail>(key)).toMatchObject({ policy: accepted, replies: [{ policy: accepted }] });
    expect(client.getQueryData<Reply>(replyKey)?.policy).toEqual(accepted);
    expect(client.getQueryData<InfiniteData<RepliesResponse>>(repliesKey)).toEqual({
      ...pages,
      pages: [{ ...pages.pages[0], items: [{ ...reply, policy: accepted }] }]
    });
    client.clear();
  });

  it('leaves public, previous-account, other-topic, other-source and other-version caches unchanged', () => {
    const client = new QueryClient();
    const isolated = [
      forumQueryKeys.topic({ source: 'linuxdo', topicId: topic.id, scope, readPlanScope: 'public:omit' }),
      forumQueryKeys.topic({
        source: 'linuxdo',
        topicId: topic.id,
        scope: { ...scope, linuxdo: 6 },
        readPlanScope: 'authenticated:6'
      }),
      forumQueryKeys.topic({ source: 'linuxdo', topicId: 'other', scope, readPlanScope: 'authenticated:7' }),
      forumQueryKeys.topic({ source: 'nodeseek', topicId: topic.id, scope, readPlanScope: 'authenticated:7' })
    ];
    isolated.forEach((queryKey) => client.setQueryData(queryKey, topic));
    const current = {
      ...topic,
      policy: { ...policy, version: 'v2' },
      replies: [{ ...reply, policy: { ...policy, postId: '88' } }]
    };
    client.setQueryData(key, current);
    syncDiscoursePolicyCaches(client, { topicId: topic.id, sessionEpoch: 7, policy: accepted });
    isolated.forEach((queryKey) => expect(client.getQueryData(queryKey)).toBe(topic));
    expect(client.getQueryData(key)).toBe(current);
    expect(client.getQueryCache().getAll()).toHaveLength(5);
    client.clear();
  });
});
