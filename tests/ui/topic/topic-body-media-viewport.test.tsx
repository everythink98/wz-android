import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import { useTopicBodyMediaViewport } from '@/features/topic/media/useTopicBodyMediaViewport';

describe('Topic body media viewport', () => {
  it('does not rescan stable items for repeated viewport observations', async () => {
    const items: TopicListItem[] = Array.from({ length: 128 }, (_, index) => ({
      key: `row:${index}`,
      type: 'topicPostlude'
    }));
    items[64] = { key: 'answer:64', type: 'topicAcceptedAnswer' };
    const mapSpy = jest.spyOn(items, 'map');
    const forEachSpy = jest.spyOn(items, 'forEach');
    const hook = await renderHook(() => useTopicBodyMediaViewport({ items, sessionIdentity: 'topic:1' }));
    const target = items[64];
    if (!target) throw new Error('viewport target missing');
    const viewableItems = [{ index: 64, isViewable: true, item: target }];

    await act(() => hook.result.current.observeViewableItems({ viewableItems }));
    const scansAfterFirstObservation = {
      forEach: forEachSpy.mock.calls.length,
      map: mapSpy.mock.calls.length
    };

    expect(scansAfterFirstObservation.forEach + scansAfterFirstObservation.map).toBeGreaterThan(0);
    expect(hook.result.current.visibleRowKeys).toEqual([target.key]);
    expect(hook.result.current.viewportRowKeys).toContain(target.key);

    await act(() => hook.result.current.observeViewableItems({ viewableItems }));

    expect({
      forEach: forEachSpy.mock.calls.length,
      map: mapSpy.mock.calls.length
    }).toEqual(scansAfterFirstObservation);
  });
});
