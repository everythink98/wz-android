import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useEffect } from 'react';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import { buildAcceptedAnswerContentItems } from '@/features/topic/model/topicOpeningPresentation';
import { useTopicBodyMediaViewport } from '@/features/topic/media/useTopicBodyMediaViewport';

describe('Topic body media viewport', () => {
  it('does not compare unchanged dynamic-region members on repeated observations', async () => {
    const items: TopicListItem[] = Array.from({ length: 128 }, (_, index) => ({
      key: `answer:${index}`,
      type: 'topicAcceptedAnswer',
      content: [],
      preview: true
    }));
    const hook = await renderHook(() => useTopicBodyMediaViewport({ items, sessionIdentity: 'stable-region' }));
    const viewableItems = [{ item: items[64], index: 64, isViewable: true }];
    await act(() => hook.result.current.observeViewableItems({ viewableItems }));
    const every = jest.spyOn(Array.prototype, 'every');
    try {
      await act(() => hook.result.current.observeViewableItems({ viewableItems }));
      expect(
        every.mock.contexts.filter((value) => Array.isArray(value) && value.length === 128 && value[0] === 'answer:0')
      ).toHaveLength(0);
    } finally {
      every.mockRestore();
    }
  });

  it('does not rescan stable items for repeated viewport observations', async () => {
    let renderCount = 0;
    const items: TopicListItem[] = Array.from({ length: 128 }, (_, index) => ({
      key: `row:${index}`,
      type: 'topicPostlude'
    }));
    items[64] = { key: 'answer:64', type: 'topicAcceptedAnswer', content: [], preview: true };
    const mapSpy = jest.spyOn(items, 'map');
    const forEachSpy = jest.spyOn(items, 'forEach');
    const hook = await renderHook(() => {
      useEffect(() => {
        renderCount += 1;
      });
      return useTopicBodyMediaViewport({ items, sessionIdentity: 'topic:1' });
    });
    const target = items[64];
    if (!target) throw new Error('viewport target missing');
    const viewableItems = [{ index: 64, isViewable: true, item: target }];

    await act(() => hook.result.current.observeViewableItems({ viewableItems }));
    const scansAfterFirstObservation = {
      forEach: forEachSpy.mock.calls.length,
      map: mapSpy.mock.calls.length
    };
    const rendersAfterFirstObservation = renderCount;

    expect(scansAfterFirstObservation.forEach + scansAfterFirstObservation.map).toBeGreaterThan(0);
    expect(hook.result.current.visibleRowKeys).toEqual([target.key]);
    expect(hook.result.current.viewportRowKeys).toContain(target.key);

    await act(() => hook.result.current.observeViewableItems({ viewableItems }));

    expect({
      forEach: forEachSpy.mock.calls.length,
      map: mapSpy.mock.calls.length
    }).toEqual(scansAfterFirstObservation);
    expect(renderCount).toBe(rendersAfterFirstObservation);
  });

  it('preserves upward media prefetch through prepend and follows a later downward move', async () => {
    let renderCount = 0;
    const items: TopicListItem[] = Array.from({ length: 1_000 }, (_, index) => ({
      key: `row:${index}`,
      type: 'topicPostlude'
    }));
    const hook = await renderHook(
      ({ currentItems, identity }: { currentItems: TopicListItem[]; identity: string }) => {
        useEffect(() => {
          renderCount += 1;
        });
        return useTopicBodyMediaViewport({ items: currentItems, sessionIdentity: identity });
      },
      { initialProps: { currentItems: items, identity: 'topic:prepend' } }
    );
    const observe = async (item: TopicListItem, index: number) =>
      act(() => hook.result.current.observeViewableItems({ viewableItems: [{ item, index, isViewable: true }] }));
    await observe(items[600], 600);
    await observe(items[599], 599);
    const upwardWindow = hook.result.current.viewportRowKeys;
    expect(upwardWindow).toEqual(['row:599', 'row:598', 'row:597', 'row:600']);

    const earlierItems: TopicListItem[] = Array.from({ length: 30 }, (_, index) => ({
      key: `earlier:${index}`,
      type: 'topicPostlude'
    }));
    await hook.rerender({ currentItems: [...earlierItems, ...items], identity: 'topic:prepend' });
    const rendersAfterPrepend = renderCount;
    await observe(items[599], 629);
    expect(hook.result.current.visibleRowKeys).toEqual(['row:599']);
    expect(hook.result.current.viewportRowKeys).toBe(upwardWindow);
    expect(hook.result.current.viewportRowKeys).toEqual(['row:599', 'row:598', 'row:597', 'row:600']);
    expect(renderCount).toBe(rendersAfterPrepend);

    await observe(items[600], 630);
    expect(hook.result.current.visibleRowKeys).toEqual(['row:600']);
    expect(hook.result.current.viewportRowKeys).toEqual(['row:600', 'row:601', 'row:602', 'row:599']);
    const downwardWindow = hook.result.current.viewportRowKeys;
    const rendersAfterDownwardMove = renderCount;
    await observe(items[600], 630);
    expect(hook.result.current.viewportRowKeys).toBe(downwardWindow);
    expect(renderCount).toBe(rendersAfterDownwardMove);

    const withoutPrevious = [...earlierItems, ...items].filter((item) => item.key !== 'row:600');
    await hook.rerender({ currentItems: withoutPrevious, identity: 'topic:prepend' });
    await observe(items[599], 629);
    expect(hook.result.current.viewportRowKeys).toEqual(['row:599', 'row:598', 'row:597', 'row:601']);
    await hook.rerender({ currentItems: withoutPrevious, identity: 'topic:new-session' });
    await observe(items[599], 629);
    expect(hook.result.current.viewportRowKeys).toEqual(['row:599', 'row:601', 'row:602', 'row:598']);
  });

  it('keeps the accepted-answer viewport key through preview and full-content changes', async () => {
    const { fullItems, previewItems } = buildAcceptedAnswerContentItems({
      floor: 2,
      reply: prepareReplyContent(
        {
          author: 'alice',
          contentHtml: Array.from(
            { length: 5 },
            (_, index) => `<p><img src="https://img.example/${index}.jpg"></p>`
          ).join(''),
          createdAt: '2026-08-09T00:00:00.000Z',
          floor: 2
        },
        'linuxdo',
        'accepted-answer'
      ),
      source: 'linuxdo'
    });
    expect(fullItems.length).toBeGreaterThan(previewItems.length);
    const accepted: TopicListItem = {
      key: 'accepted-answer:topic:1:2',
      type: 'topicAcceptedAnswer',
      content: previewItems,
      preview: true
    };
    const items: TopicListItem[] = [{ key: 'before', type: 'topicPostlude' }, accepted];
    const hook = await renderHook(
      ({ currentItems }: { currentItems: TopicListItem[] }) =>
        useTopicBodyMediaViewport({ items: currentItems, sessionIdentity: 'topic:1' }),
      { initialProps: { currentItems: items } }
    );
    await act(() =>
      hook.result.current.observeViewableItems({ viewableItems: [{ item: accepted, index: 1, isViewable: true }] })
    );

    const full: TopicListItem = { ...accepted, content: fullItems, preview: false };
    await hook.rerender({ currentItems: [items[0], full] });
    expect(hook.result.current.visibleRowKeys).toEqual([accepted.key]);
    expect(hook.result.current.viewportRowKeys).toContain(accepted.key);

    await hook.rerender({ currentItems: items });
    expect(hook.result.current.visibleRowKeys).toEqual([accepted.key]);
    expect(hook.result.current.viewportRowKeys).toContain(accepted.key);
  });
});
