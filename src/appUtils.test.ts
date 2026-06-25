import { describe, expect, it } from 'vitest';
import {
  finishAbortableRequest,
  forumAccessRequirementText,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  linuxDoExternalSearchItems,
  parseForumTopicLink,
  parseForumUserLink,
  sourceLabel,
  startAbortableRequest,
  topicListDisplayTime
} from './appUtils';
import { REQUEST_CANCELED_MESSAGE } from './request';

describe('Android app utils', () => {
  it('formats source labels and canceled request errors', () => {
    expect(sourceLabel('all')).toBe('全部');
    expect(sourceLabel('linuxdo')).toBe('linux.do');
    expect(sourceLabel('nodeseek')).toBe('NodeSeek');
    expect(sourceLabel('yaohuo')).toBe('妖火');
    expect(sourceLabel('v2ex')).toBe('V2EX');
    expect(isCanceledRequest(new Error(REQUEST_CANCELED_MESSAGE))).toBe(true);
  });

  it('formats level access requirements with explicit Lv labels for lists', () => {
    expect(forumAccessRequirementText({
      type: 'level',
      label: '需等级',
      detail: 'trust level 2'
    })).toBe('需 Lv2');
    expect(forumAccessRequirementText({
      type: 'level',
      label: '需等级',
      detail: '回复 4 查看 102 查看本帖需要等级达到 6 级后查看'
    })).toBe('需 Lv6');
    expect(forumAccessRequirementText({
      type: 'level',
      label: '需等级',
      detail: 'Minimum level of 5 required'
    })).toBe('需 Lv5');
    expect(forumAccessRequirementText({
      type: 'permission',
      label: '需权限',
      detail: '权限不足'
    })).toBe('需权限');
  });

  it('starts and finishes abortable requests by controller identity', () => {
    const ref: { current: AbortController | null } = { current: null };
    const first = startAbortableRequest(ref);
    const second = startAbortableRequest(ref);

    expect(first.signal.aborted).toBe(true);
    expect(ref.current).toBe(second);
    expect(finishAbortableRequest(ref, first)).toBe(false);
    expect(ref.current).toBe(second);
    expect(finishAbortableRequest(ref, second)).toBe(true);
    expect(ref.current).toBeNull();
  });

  it('distinguishes expired yaohuo login from access verification', () => {
    const expired = Object.assign(new Error('expired'), { loginRequired: true, reason: 'expired' });
    const verification = Object.assign(new Error('verification'), { loginRequired: true, reason: 'verification' });

    expect(isYaohuoLoginRequiredError(expired)).toBe(true);
    expect(isYaohuoLoginExpiredError(expired)).toBe(true);
    expect(isYaohuoLoginRequiredError(verification)).toBe(true);
    expect(isYaohuoLoginExpiredError(verification)).toBe(false);
  });

  it('identifies linux.do Cloudflare verification errors', () => {
    const cloudflare = Object.assign(new Error('linux.do 需要完成 Cloudflare 验证'), {
      source: 'linuxdo',
      reason: 'cloudflare'
    });
    const ordinary = Object.assign(new Error('linux.do 主题不存在'), {
      source: 'linuxdo'
    });

    expect(isLinuxDoCloudflareError(cloudflare)).toBe(true);
    expect(isLinuxDoCloudflareError(ordinary)).toBe(false);
  });

  it('builds linux.do external search shortcuts like the mobile web search page', () => {
    expect(linuxDoExternalSearchItems('  gpt plus  ')).toEqual([
      { label: 'Google', url: 'https://www.google.com/search?q=site%3Alinux.do%20gpt%20plus' },
      { label: 'Bing', url: 'https://www.bing.com/search?q=site%3Alinux.do%20gpt%20plus' },
      { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=site%3Alinux.do%20gpt%20plus' }
    ]);
    expect(linuxDoExternalSearchItems('')).toEqual([]);
  });

  it('recognizes four-site topic links that should stay inside the app', () => {
    expect(parseForumTopicLink('https://www.nodeseek.com/post-123-2#reply', 'https://www.nodeseek.com/post-99-1')).toMatchObject({
      source: 'nodeseek',
      id: '123',
      title: 'NodeSeek 主题',
      url: 'https://www.nodeseek.com/post-123-1'
    });
    expect(parseForumTopicLink('/t/a-topic/456/2#post_8', 'https://linux.do/t/current/1')).toMatchObject({
      source: 'linuxdo',
      id: '456',
      title: 'linux.do 主题',
      url: 'https://linux.do/t/456'
    });
    expect(parseForumTopicLink('/t/456/2#post_8', 'https://linux.do/t/current/1')).toMatchObject({
      source: 'linuxdo',
      id: '456',
      title: 'linux.do 主题',
      url: 'https://linux.do/t/456'
    });
    expect(parseForumTopicLink('https://v2ex.com/t/789#reply1', 'https://www.v2ex.com/t/1')).toMatchObject({
      source: 'v2ex',
      id: '789',
      title: 'V2EX 主题',
      url: 'https://www.v2ex.com/t/789'
    });
    expect(parseForumTopicLink('book_re.aspx?id=321&classid=177&reply=1', 'https://yaohuo.me/bbs-1.html')).toMatchObject({
      source: 'yaohuo',
      id: '321',
      title: '妖火主题',
      categoryId: '177',
      category: '妖火茶馆',
      url: 'https://yaohuo.me/bbs-321.html'
    });
    expect(parseForumTopicLink('https://yaohuo.me/bbs/view.aspx?id=654&classid=213', 'https://yaohuo.me/bbs-1.html')).toMatchObject({
      source: 'yaohuo',
      id: '654',
      title: '妖火主题',
      categoryId: '213',
      category: '悬赏问答',
      url: 'https://yaohuo.me/bbs-654.html'
    });
    expect(parseForumTopicLink('/bbs/book_view.aspx?id=655&classid=201', 'https://yaohuo.me/bbs-1.html')).toMatchObject({
      source: 'yaohuo',
      id: '655',
      title: '妖火主题',
      categoryId: '201',
      category: '资源分享',
      url: 'https://yaohuo.me/bbs-655.html'
    });
  });

  it('does not treat ordinary external links or non-topic forum links as app topics', () => {
    expect(parseForumTopicLink('https://github.com/openai/codex', 'https://linux.do/t/1')).toBeNull();
    expect(parseForumTopicLink('https://linux.do/u/alice', 'https://linux.do/t/1')).toBeNull();
    expect(parseForumTopicLink('https://linux.do/t/not-a-topic', 'https://linux.do/t/1')).toBeNull();
    expect(parseForumTopicLink('https://www.v2ex.com/go/create', 'https://www.v2ex.com/t/1')).toBeNull();
    expect(parseForumTopicLink('mailto:test@example.com', 'https://www.nodeseek.com/post-1-1')).toBeNull();
  });

  it('recognizes NodeSeek user links that should stay inside the app', () => {
    expect(parseForumUserLink('/space/12345', 'https://www.nodeseek.com/post-793572-1')).toMatchObject({
      source: 'nodeseek',
      id: '12345',
      username: '12345',
      url: 'https://www.nodeseek.com/space/12345'
    });
    expect(parseForumUserLink('https://www.nodeseek.com/space/12345#/discussions')).toMatchObject({
      source: 'nodeseek',
      id: '12345',
      username: '12345',
      url: 'https://www.nodeseek.com/space/12345'
    });
    expect(parseForumUserLink('https://www.nodeseek.com/space/name')).toBeNull();
    expect(parseForumUserLink('https://github.com/openai/codex', 'https://www.nodeseek.com/post-1-1')).toBeNull();
  });

  it('converts NodeSeek member mention links only when the loaded detail has the numeric user id', () => {
    expect(parseForumUserLink('https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85', 'https://www.nodeseek.com/post-793572-1', [
      {
        author: '电动面包',
        authorId: '32398',
        authorAvatar: 'https://www.nodeseek.com/avatar/32398.png',
        authorUrl: 'https://www.nodeseek.com/space/32398'
      }
    ])).toMatchObject({
      source: 'nodeseek',
      id: '32398',
      username: '电动面包',
      displayName: '电动面包',
      avatar: 'https://www.nodeseek.com/avatar/32398.png',
      url: 'https://www.nodeseek.com/space/32398'
    });
    expect(parseForumUserLink('https://www.nodeseek.com/member?t=jasperwill', 'https://www.nodeseek.com/post-793572-1')).toBeNull();
    expect(parseForumUserLink('https://www.nodeseek.com/member?t=missing', 'https://www.nodeseek.com/post-793572-1', [
      { author: 'jasperwill', authorId: '54270', authorUrl: 'https://www.nodeseek.com/space/54270' }
    ])).toBeNull();
  });

  it('uses active time for V2EX list display time', () => {
    expect(topicListDisplayTime({
      source: 'v2ex',
      createdAt: '2026-05-24T08:50:00.000Z',
      lastReplyAt: '2026-05-24T06:00:00.000Z'
    })).toBe('2026-05-24T06:00:00.000Z');
    expect(topicListDisplayTime({
      source: 'linuxdo',
      createdAt: '2026-05-24T08:50:00.000Z',
      lastReplyAt: '2026-05-24T09:00:00.000Z'
    })).toBe('2026-05-24T09:00:00.000Z');
  });
});
