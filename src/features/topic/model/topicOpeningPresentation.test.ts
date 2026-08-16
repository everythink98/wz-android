import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/domain/forum/html';
import type { Reply, Source, TopicDetail } from '@/domain/forum/models';
import { prepareForumContentHtml } from '@/domain/forum/topicContentSplit';
import { forumContentRegionSegments, singleForumContentSegment } from '../../../../tests/helpers/forumContentSegments';
import {
  buildAcceptedAnswerContentItems as buildAcceptedAnswerContentItemsFromPlan,
  buildAcceptedAnswerPresentation,
  buildTopicOpeningContent as buildTopicOpeningContentFromPlan,
  buildTopicQuotedPostContentItems as buildTopicQuotedPostContentItemsFromPlan
} from './topicOpeningPresentation';

function preparedReply<T extends Reply>(reply: T, source: Source): T {
  const signatureHtml = String(reply.signatureHtml || '');
  reply.preparedContent = prepareForumContentHtml(reply.contentHtml, {
    polls: reply.polls,
    role: 'reply',
    source
  });
  reply.preparedSignature = signatureHtml.trim()
    ? prepareForumContentHtml(signatureHtml, { role: 'signature', source })
    : undefined;
  return reply;
}

function buildTopicOpeningContent(topic: Parameters<typeof buildTopicOpeningContentFromPlan>[0]) {
  return buildTopicOpeningContentFromPlan(
    topic
      ? {
          ...topic,
          preparedContent: prepareForumContentHtml(topic.contentHtml, {
            polls: topic.polls,
            role: 'opening',
            source: topic.source,
            topicId: topic.id
          })
        }
      : null
  );
}

function buildTopicQuotedPostContentItems(options: Parameters<typeof buildTopicQuotedPostContentItemsFromPlan>[0]) {
  return buildTopicQuotedPostContentItemsFromPlan({
    ...options,
    reply: preparedReply(options.reply, options.source)
  });
}

function buildAcceptedAnswerContentItems(options: Parameters<typeof buildAcceptedAnswerContentItemsFromPlan>[0]) {
  return buildAcceptedAnswerContentItemsFromPlan({
    ...options,
    reply: preparedReply(options.reply, options.source)
  });
}

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

const terminalReportHtml =
  '<forum-terminal-report>' +
  '<forum-terminal-tab title="Overview"><div class="forum-terminal-code">overview result</div></forum-terminal-tab>' +
  '<forum-terminal-tab title="Benchmark"><div class="forum-terminal-code">benchmark result</div></forum-terminal-tab>' +
  '</forum-terminal-report>';

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
  it('[REG-PERF-010] rejects non-empty opening content without a gateway content plan', () => {
    expect(() => buildTopicOpeningContentFromPlan(topic)).toThrow('论坛内容缺少匹配的预编译计划');
  });

  it('[REG-TOPIC-090] preserves terminal rows in opening, complete quote, and accepted preview/full consumers', () => {
    const opening = buildTopicOpeningContent({ ...topic, contentHtml: terminalReportHtml });
    const reply = { author: 'bob', contentHtml: terminalReportHtml, createdAt: '2026-08-01T00:01:00.000Z', floor: 2 };
    const quote = buildTopicQuotedPostContentItems({ instanceKey: 'quote-1', reply, source: 'linuxdo' });
    const accepted = buildAcceptedAnswerContentItems({ floor: 2, reply, source: 'linuxdo' });
    const rowTypes = (items: typeof quote) =>
      items.flatMap((item) =>
        item.type === 'content' ? forumContentRegionSegments(item.region).map((segment) => segment.type) : [item.type]
      );

    expect(rowTypes(opening.contentItems)).toEqual(['terminalReportHeader', 'codeBlock', 'codeBlock']);
    expect(rowTypes(quote)).toEqual(['terminalReportHeader', 'codeBlock', 'codeBlock']);
    expect(rowTypes(accepted.fullItems)).toEqual(['terminalReportHeader', 'codeBlock', 'codeBlock']);
    expect(rowTypes(accepted.previewItems)).toEqual(['terminalReportHeader', 'codeBlock']);
    expect(accepted.previewItems[1]).toMatchObject({
      type: 'content',
      region: expect.objectContaining({
        kind: 'island',
        segment: expect.objectContaining({ text: 'overview result', type: 'codeBlock' })
      })
    });
  });

  it('[REG-TOPIC-078] keeps an element referrer policy on a native opening video', () => {
    const result = buildTopicOpeningContent({
      ...topic,
      contentHtml:
        '<forum-video src="https://media.example/video.mp4" poster="https://media.example/poster.webp" referrerpolicy="no-referrer"></forum-video>'
    });

    expect(result.contentItems).toEqual([
      expect.objectContaining({
        type: 'content',
        region: expect.objectContaining({
          kind: 'island',
          segment: expect.objectContaining({
            poster: 'https://media.example/poster.webp',
            referrerPolicy: 'no-referrer',
            src: 'https://media.example/video.mp4',
            type: 'video'
          })
        })
      })
    ]);
  });

  it('[REG-PERF-010] lifts nested opening-post quotes into ordered typed parent rows', () => {
    const result = buildTopicOpeningContent({
      ...topic,
      contentHtml:
        '<section><p>before</p><div><aside class="quote" data-post="8" data-topic="77" data-username="bob"><div class="title">bob:</div><blockquote>preview</blockquote></aside></div><p>after</p></section>'
    });

    expect(result.contentItems.map((item) => item.type)).toEqual(['content', 'quoteSummary', 'content']);
    expect(result.contentItems[0]).toMatchObject({
      type: 'content',
      region: expect.objectContaining({ kind: 'selectable', segments: [expect.objectContaining({ type: 'richText' })] })
    });
    expect(result.contentItems[1]).toMatchObject({
      type: 'quoteSummary',
      instanceKey: 'topic:42:linuxdo:77:8',
      quote: {
        author: { label: 'bob', username: 'bob' },
        preview: 'preview',
        reference: { source: 'linuxdo', topicId: '77', postNumber: 8 }
      }
    });
    expect(result.contentItems[2]).toMatchObject({
      type: 'content',
      region: expect.objectContaining({ kind: 'selectable', segments: [expect.objectContaining({ type: 'richText' })] })
    });
    const first = result.contentItems[0];
    const last = result.contentItems[2];
    if (first.type !== 'content' || last.type !== 'content') throw new Error('Expected split content rows');
    const firstSegment = singleForumContentSegment(first.region);
    const lastSegment = singleForumContentSegment(last.region);
    expect('html' in firstSegment ? parseHtml(firstSegment.html).text : '').toBe('before');
    expect('html' in lastSegment ? parseHtml(lastSegment.html).text : '').toBe('after');
    expect(firstSegment.semanticId).not.toBe(lastSegment.semanticId);
    expect(
      result.contentItems.some(
        (item) =>
          item.type === 'content' &&
          forumContentRegionSegments(item.region).some(
            (segment) => 'html' in segment && segment.html.includes('<aside')
          )
      )
    ).toBe(false);
  });

  it('[REG-PERF-010] projects compiler fail-closed rows for over-deep opening quote candidates', () => {
    const contentHtml = `${'<aside>'.repeat(1_000)}body${'</aside>'.repeat(1_000)}`;

    const result = buildTopicOpeningContent({ ...topic, contentHtml });
    const contentRows = result.contentItems.filter((item) => item.type === 'content');

    expect(result.contentItems.every((item) => item.type === 'content')).toBe(true);
    expect(contentRows.length).toBeGreaterThan(0);
    expect(
      contentRows.every((item) =>
        forumContentRegionSegments(item.region).every((segment) => 'html' in segment && segment.html.length <= 16_384)
      )
    ).toBe(true);
    expect(
      contentRows.every((item) =>
        forumContentRegionSegments(item.region).every(
          (segment) => 'html' in segment && maxElementDepth(segment.html) <= 64
        )
      )
    ).toBe(true);
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
    expect(result.contentItems.map((item) => (item.type === 'content' ? item.region.networkMediaCount : 0))).toEqual(
      Array.from({ length: 500 }, () => 4)
    );
    expect(
      result.contentItems.flatMap((item) =>
        item.type === 'content'
          ? forumContentRegionSegments(item.region).flatMap((segment) =>
              'html' in segment ? segment.html.match(/<img\b/g) || [] : []
            )
          : []
      ).length
    ).toBe(2000);
  });

  it('projects opening content with a paged accepted answer', () => {
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

    expect(content.contentItems).toEqual([
      expect.objectContaining({
        type: 'content',
        region: expect.objectContaining({
          kind: 'selectable',
          segments: [expect.objectContaining({ html: '<p>body</p>' })]
        })
      })
    ]);
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
