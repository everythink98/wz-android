import { describe, expect, it, vi } from 'vitest';
import type { Reply } from '@/domain/forum/models';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';
import { buildAcceptedAnswerContentItems } from './topicOpeningPresentation';
import {
  topicListItemType,
  projectTopicListItems,
  topicListReadingFloor,
  topicListReadingNeedsDisplayedMedia,
  topicListReadingRevision,
  type TopicListItem
} from './topicListModel';

const selectionToken = '{"owners":[],"prefix":[],"version":1}';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>reply</p>',
  createdAt: '2026-08-09T00:00:00.000Z',
  floor: 2
};

function acceptedAnswerItem(
  html: string,
  preview = false,
  polls?: Reply['polls']
): Extract<TopicListItem, { type: 'topicAcceptedAnswer' }> {
  return {
    type: 'topicAcceptedAnswer',
    key: 'accepted-answer',
    content: buildAcceptedAnswerContentItems({
      floor: 2,
      reply: prepareReplyContent({ ...reply, contentHtml: html, polls }, 'linuxdo', 'accepted-answer'),
      source: 'linuxdo'
    }).fullItems,
    preview
  };
}

describe('topic list model', () => {
  it('keeps accepted-answer renderers inside one list item and excludes them from opening selection', () => {
    const item = acceptedAnswerItem(
      '<p>first</p><img src="https://secret.example/1.jpg"><img src="https://secret.example/2.jpg"><img src="https://secret.example/3.jpg"><img src="https://secret.example/4.jpg"><img src="https://secret.example/5.jpg"><p>last</p>'
    );
    expect(item.content.length).toBeGreaterThan(1);
    const projection = projectTopicListItems([item], () => true);

    expect(projection.items).toEqual([item]);
    expect(projection.selectionItems).toEqual([]);
    expect([...projection.selectionRowKeys]).toEqual([]);
    expect(projection.mediaPlanStats).toEqual({ networkMediaCount: 5, plannedRowCount: item.content.length });
    expect(topicListItemType(item)).toBe('topicAcceptedAnswer');
  });

  it('reports accepted-answer reading only for the full card with actual content', () => {
    const full = acceptedAnswerItem('<p>answer</p>');
    expect(topicListReadingFloor(full, 2)).toBe(2);
    expect(topicListReadingFloor({ ...full, preview: true }, 2)).toBeUndefined();
    expect(topicListReadingFloor({ ...full, content: [] }, 2)).toBeUndefined();
    expect(
      topicListReadingFloor(
        {
          ...full,
          content: [{ type: 'accessNotice', key: 'notice', label: 'restricted', detail: 'restricted' }]
        },
        2
      )
    ).toBeUndefined();
    expect(topicListReadingFloor(full)).toBeUndefined();
  });

  it('keeps a poll-only accepted answer eligible for full-card reading', () => {
    const item = acceptedAnswerItem('<forum-discourse-poll name="choice"></forum-discourse-poll>', false, [
      { name: 'choice', options: [{ id: 'a', label: 'A' }] }
    ]);
    expect(item.content.map((content) => content.type)).toEqual(['poll']);
    expect(topicListReadingFloor(item, 2)).toBe(2);
    expect(topicListReadingFloor({ ...item, preview: true }, 2)).toBeUndefined();
    expect(projectTopicListItems([item], () => true).mediaPlanStats.plannedRowCount).toBe(1);
  });

  it('includes every accepted-answer renderer in its reading revision', () => {
    const html =
      '<p>first</p>' +
      Array.from({ length: 5 }, (_, index) => `<p><img src="https://img.example/${index}.jpg"></p>`).join('') +
      '<p>last</p>';
    const first = acceptedAnswerItem(html);
    const changed = acceptedAnswerItem(html.replace('<p>last</p>', '<p>changed</p>'));
    expect(first.content.length).toBeGreaterThan(1);
    expect(first.content[0]).toEqual(changed.content[0]);
    expect(topicListReadingRevision(first)).toEqual(expect.any(String));
    expect(topicListReadingRevision(first)).toBe(topicListReadingRevision(acceptedAnswerItem(html)));
    expect(topicListReadingRevision(first)).not.toBe(topicListReadingRevision(changed));
    expect(topicListReadingRevision({ ...first, content: [] })).toBeUndefined();
  });

  it('waits for displayed media when all accepted-answer body renderers are media only', () => {
    const media = acceptedAnswerItem(
      '<p><img src="https://img.example/1.jpg"></p><p><img src="https://img.example/2.jpg"></p>'
    );
    expect(topicListReadingNeedsDisplayedMedia(media)).toBe(true);
    expect(
      topicListReadingNeedsDisplayedMedia(acceptedAnswerItem('<p>answer</p><img src="https://img.example/1.jpg">'))
    ).toBe(false);
    expect(topicListReadingNeedsDisplayedMedia({ ...media, content: [] })).toBe(false);
  });

  it('gives terminal headers a stable FlashList item type', () => {
    const row = {
      defaultTabId: 'node-0-tab-0',
      ancestorFrames: [],
      keySuffix: 'node-0:0',
      networkMediaCount: 0,
      part: 'only' as const,
      segmentIndex: 0,
      selectionToken,
      semanticId: 'node-0',
      tabs: [{ id: 'node-0-tab-0', title: 'Overview' }],
      type: 'terminalReportHeader' as const
    };

    expect(
      topicListItemType({ type: 'topicContent', key: 'topic-terminal', content: { type: 'content', key: 'row', row } })
    ).toBe('topicContent:terminalReportHeader');
    expect(
      topicListItemType({
        type: 'replyContent',
        key: 'reply-terminal',
        content: row,
        first: true,
        last: false,
        reply,
        replyFloor: 2
      })
    ).toBe('replyContent:terminalReportHeader');
  });

  it('includes a single-cell reply payload kind in its FlashList view type', () => {
    expect(
      topicListItemType({
        bodyContent: {
          ancestorFrames: [],
          keySuffix: 'node-0:0',
          networkMediaCount: 0,
          part: 'only',
          runs: [{ text: 'code' }],
          segmentIndex: 0,
          selectionToken,
          semanticId: 'node-0',
          text: 'code',
          type: 'codeBlock'
        },
        key: 'reply-floor-2',
        reply,
        replyFloor: 2,
        type: 'reply'
      })
    ).toBe('reply:codeBlock');
  });

  it('aggregates only planned parent rows and opaque media counts', () => {
    const items: TopicListItem[] = [
      {
        type: 'topicContent',
        key: 'opening-1',
        content: {
          type: 'content',
          key: 'content-1',
          row: {
            type: 'richText',
            ancestorFrames: [],
            html: '<p><img src="https://secret.example/1.jpg"></p>',
            keySuffix: 'node-0:0',
            networkMediaCount: 4,
            part: 'only',
            segmentIndex: 0,
            selectionToken,
            semanticId: 'node-0'
          }
        }
      },
      { type: 'replyStart', key: 'reply-start', reply, replyFloor: 2 },
      {
        type: 'replyContent',
        key: 'reply-content',
        reply,
        replyFloor: 2,
        content: {
          type: 'richText',
          ancestorFrames: [],
          html: '<img src="https://secret.example/2.jpg">',
          keySuffix: 'node-0:0',
          networkMediaCount: 1,
          part: 'only',
          segmentIndex: 0,
          selectionToken,
          semanticId: 'node-0'
        },
        first: true,
        last: true
      },
      {
        type: 'replySignatureContent',
        key: 'reply-signature',
        reply,
        replyFloor: 2,
        content: {
          type: 'richText',
          ancestorFrames: [],
          html: '<img src="https://secret.example/3.jpg">',
          keySuffix: 'node-0:0',
          networkMediaCount: 1,
          part: 'only',
          segmentIndex: 0,
          selectionToken,
          semanticId: 'node-0'
        },
        first: true,
        last: true
      },
      { type: 'topicPostlude', key: 'postlude' }
    ];

    const visible = vi.fn(() => true);
    const projection = projectTopicListItems(items, visible);
    expect(projection.mediaPlanStats).toEqual({ networkMediaCount: 6, plannedRowCount: 3 });
    expect(JSON.stringify(projection.mediaPlanStats)).not.toContain('secret.example');
    expect(projection.items).toEqual(items);
    expect(projection.selectionItems).toEqual([{ documentId: 'opening', rowKey: 'opening-1', selectionToken }]);
    expect([...projection.selectionRowKeys]).toEqual(['opening-1']);
    expect(visible).toHaveBeenCalledTimes(items.length);
    const hiddenOpening = projectTopicListItems(items, (item) => item.key !== 'opening-1');
    expect(hiddenOpening.mediaPlanStats).toEqual({ networkMediaCount: 2, plannedRowCount: 2 });
    expect(hiddenOpening.selectionItems).toEqual([]);
    expect(hiddenOpening.items.map((item) => item.key)).toEqual([
      'reply-start',
      'reply-content',
      'reply-signature',
      'postlude'
    ]);
  });
});
