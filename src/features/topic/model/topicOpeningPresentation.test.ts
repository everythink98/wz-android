import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/domain/forum/html';
import type { TopicDetail } from '@/domain/forum/models';
import {
  buildAcceptedAnswerContentItems,
  buildAcceptedAnswerPresentation,
  buildTopicOpeningContent,
  buildTopicQuotedPostContentItems
} from './topicOpeningPresentation';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '42',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/topic/42',
  createdAt: '2026-08-01T00:00:00.000Z',
  replyCount: 1,
  contentHtml: '<p>body</p>',
  replies: [],
  acceptedAnswerFloor: 2
};

function maxElementDepth(html: string) {
  const body = parseHtml(`<body>${html}</body>`).querySelector('body');
  type TestNode = { childNodes?: TestNode[]; rawTagName?: unknown; tagName?: unknown };
  const pending = (body?.childNodes || []).map((node) => ({ depth: 1, node: node as TestNode }));
  let maxDepth = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const tagName = String(current.node.rawTagName || current.node.tagName || '');
    const nextDepth = tagName ? current.depth + 1 : current.depth;
    if (tagName) maxDepth = Math.max(maxDepth, current.depth);
    (current.node.childNodes || []).forEach((node) => pending.push({ depth: nextDepth, node }));
  }
  return maxDepth;
}

describe('topic opening presentation', () => {
  it('[REG-PERF-010] lifts nested opening-post quotes into ordered typed parent rows', () => {
    const result = buildTopicOpeningContent({
      ...topic,
      contentHtml:
        '<section><p>before</p><div><aside class="quote" data-post="8" data-topic="77" data-username="bob"><div class="title">bob:</div><blockquote>preview</blockquote></aside></div><p>after</p></section>'
    });

    expect(result.contentItems.map((item) => item.type)).toEqual(['content', 'quoteSummary', 'content']);
    expect(result.contentItems[0]).toMatchObject({ type: 'content', html: '<section><p>before</p></section>' });
    expect(result.contentItems[1]).toMatchObject({
      type: 'quoteSummary',
      instanceKey: 'topic:42:linuxdo:77:8',
      quote: {
        author: { label: 'bob', username: 'bob' },
        preview: 'preview',
        reference: { source: 'linuxdo', topicId: '77', postNumber: 8 }
      }
    });
    expect(result.contentItems[2]).toMatchObject({ type: 'content', html: '<section><p>after</p></section>' });
    expect(result.contentItems.some((item) => item.type === 'content' && item.html.includes('<aside'))).toBe(false);
  });

  it('[REG-PERF-010] projects compiler fail-closed rows for over-deep opening quote candidates', () => {
    const contentHtml = `${'<aside>'.repeat(1_000)}body${'</aside>'.repeat(1_000)}`;

    const result = buildTopicOpeningContent({ ...topic, contentHtml });
    const contentRows = result.contentItems.filter((item) => item.type === 'content');

    expect(result.contentItems.every((item) => item.type === 'content')).toBe(true);
    expect(contentRows.length).toBeGreaterThan(0);
    expect(contentRows.every((item) => item.html.length <= 16_384)).toBe(true);
    expect(contentRows.every((item) => maxElementDepth(item.html) <= 64)).toBe(true);
  });

  it('[REG-PERF-010] plans a giant expanded topic quote as bounded parent-list content rows', () => {
    const quotedReply = {
      author: 'bob',
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/quote-${index}.jpg">`
      ).join('')}</p>`,
      createdAt: '2026-08-01T00:01:00.000Z',
      floor: 8
    };

    const items = buildTopicQuotedPostContentItems({
      instanceKey: 'topic:42:linuxdo:77:8',
      reply: quotedReply,
      source: 'linuxdo'
    });

    expect(items).toHaveLength(500);
    expect(items.every((item) => item.type === 'content')).toBe(true);
  });

  it('[REG-PERF-010] exposes one bounded accepted-answer preview row before the full plan', () => {
    const accepted = {
      author: 'bob',
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/accepted-${index}.jpg">`
      ).join('')}</p>`,
      createdAt: '2026-08-01T00:01:00.000Z',
      floor: 2
    };

    const content = buildAcceptedAnswerContentItems({ floor: 2, reply: accepted, source: 'linuxdo' });
    const repeated = buildAcceptedAnswerContentItems({ floor: 2, reply: accepted, source: 'linuxdo' });

    expect(content.fullItems).toHaveLength(500);
    expect(content.previewItems).toEqual(content.fullItems.slice(0, 1));
    expect(repeated.fullItems).toBe(content.fullItems);
  });

  it('[REG-PERF-010] projects a giant nested image paragraph as bounded parent-list rows', () => {
    const contentHtml = `<p>${Array.from(
      { length: 2000 },
      (_, index) => `<img src="https://img.example.com/${index}.jpg">`
    ).join('')}</p>`;
    const result = buildTopicOpeningContent({ ...topic, contentHtml });

    expect(result.contentItems).toHaveLength(500);
    expect(result.contentItems.every((item) => item.type === 'content')).toBe(true);
    expect(result.contentItems.map((item) => (item.type === 'content' ? item.networkMediaCount : 0))).toEqual(
      Array.from({ length: 500 }, () => 4)
    );
    expect(
      result.contentItems.flatMap((item) => (item.type === 'content' ? [...item.html.matchAll(/<img\b/g)] : [])).length
    ).toBe(2000);
  });

  it('projects opening content and a paged accepted answer without UI state', () => {
    const accepted = {
      author: 'bob',
      contentHtml: '<p>answer</p>',
      createdAt: '2026-08-01T00:01:00.000Z',
      floor: 2
    };
    const content = buildTopicOpeningContent(topic);
    const acceptedAnswer = buildAcceptedAnswerPresentation({
      loadedQuotedReplies: { 'linuxdo:42:2': accepted },
      showsAccessNotice: content.showsAccessNotice,
      sourceReplies: [],
      topic
    });

    expect(content.contentItems).toEqual([expect.objectContaining({ type: 'content', html: '<p>body</p>' })]);
    expect(acceptedAnswer).toMatchObject({ floor: 2, reply: accepted });
  });

  it('replaces restricted content with one access notice and suppresses answer loading', () => {
    const restrictedTopic = {
      ...topic,
      accessRequirement: { type: 'permission' as const, label: '需权限', detail: '暂无权限查看此内容' },
      contentHtml: '<p>暂无权限查看此内容</p>'
    };
    const content = buildTopicOpeningContent(restrictedTopic);
    const acceptedAnswer = buildAcceptedAnswerPresentation({
      loadedQuotedReplies: {},
      showsAccessNotice: content.showsAccessNotice,
      sourceReplies: [],
      topic: restrictedTopic
    });

    expect(content.contentItems).toEqual([
      { type: 'accessNotice', key: 'topic-access-notice', label: '需权限', detail: '暂无权限查看此内容' }
    ]);
    expect(acceptedAnswer).toBeNull();
  });
});
