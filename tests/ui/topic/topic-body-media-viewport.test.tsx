import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useEffect } from 'react';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import { useTopicBodyMediaViewport } from '@/features/topic/media/useTopicBodyMediaViewport';

describe('Topic body media viewport', () => {
  it('does not compare unchanged dynamic-region members on repeated observations', async () => {
    const items: TopicListItem[] = Array.from({ length: 128 }, (_, index) => ({
      key: `answer:${index}`,
      type: 'topicAcceptedAnswer'
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
    items[64] = { key: 'answer:64', type: 'topicAcceptedAnswer' };
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
});
