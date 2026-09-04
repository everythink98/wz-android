import { describe, expect, it, vi } from 'vitest';
import type { Reply } from '@/domain/forum/models';
import { topicListItemType, projectTopicListItems, type TopicListItem } from './topicListModel';

const selectionToken = '{"owners":[],"prefix":[],"version":1}';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>reply</p>',
  createdAt: '2026-08-09T00:00:00.000Z',
  floor: 2
};

describe('topic list model', () => {
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
