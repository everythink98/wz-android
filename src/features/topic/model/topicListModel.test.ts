import { describe, expect, it } from 'vitest';
import type { Reply } from '@/domain/forum/models';
import { topicListItemType, topicListMediaPlanStats, type TopicListItem } from './topicListModel';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>reply</p>',
  createdAt: '2026-08-09T00:00:00.000Z',
  floor: 2
};

describe('topic list model', () => {
  it('[REG-TOPIC-090] gives terminal headers a stable FlashList item type', () => {
    const row = {
      defaultTabId: 'node-0-tab-0',
      ancestorFrames: [],
      keySuffix: 'node-0:0',
      networkMediaCount: 0,
      part: 'only' as const,
      segmentIndex: 0,
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

  it('[REG-TOPIC-088] includes a single-cell reply payload kind in its FlashList view type', () => {
    expect(
      topicListItemType({
        bodyContent: {
          ancestorFrames: [],
          keySuffix: 'node-0:0',
          networkMediaCount: 0,
          part: 'only',
          runs: [{ text: 'code' }],
          segmentIndex: 0,
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

  it('[REG-PERF-010] aggregates only planned parent rows and opaque media counts', () => {
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
          semanticId: 'node-0'
        },
        first: true,
        last: true
      },
      { type: 'topicPostlude', key: 'postlude' }
    ];

    expect(topicListMediaPlanStats(items)).toEqual({ networkMediaCount: 6, plannedRowCount: 3 });
    expect(JSON.stringify(topicListMediaPlanStats(items))).not.toContain('secret.example');
  });
});
