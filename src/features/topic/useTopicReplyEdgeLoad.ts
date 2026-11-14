import { useCallback, useRef, type RefObject } from 'react';
import { PixelRatio, type NativeScrollEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { TopicListItem } from './model/topicListModel';
import type { useTopicController } from './useTopicController';

type EdgeRead = Pick<
  ReturnType<typeof useTopicController>,
  | 'replyPreviousCursor'
  | 'replyNextPage'
  | 'replyNextOffset'
  | 'loadMoreReplies'
  | 'loadPreviousReplies'
  | 'loadingMoreReplies'
  | 'loadingPreviousReplies'
  | 'replyHasPrevious'
  | 'replyHasMore'
  | 'replyStartError'
  | 'replyEndError'
>;
type ScrollSample = NativeScrollEvent & { contentOffsetCorrection?: { y: number } };
type Gesture = 'idle' | 'drag' | 'awaiting-momentum' | 'momentum';
const START_THRESHOLD = 3;
const END_THRESHOLD = 0.55;

export function useTopicReplyEdgeLoad({
  active,
  read,
  startIndex,
  list
}: {
  active: boolean;
  read: EdgeRead;
  startIndex: number;
  list: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const scroll = useRef({ gesture: 'idle' as Gesture, offset: 0, correction: 0, start: '', end: '' });
  const loadOwner = useRef<object | null>(null);
  const stop = useCallback(() => {
    scroll.current.gesture = 'idle';
  }, []);
  const begin = useCallback((event: ScrollSample) => {
    scroll.current = {
      gesture: 'drag',
      offset: event.contentOffset.y,
      correction: event.contentOffsetCorrection?.y || 0,
      start: '',
      end: ''
    };
  }, []);
  const momentumBegin = useCallback(() => {
    if (scroll.current.gesture === 'awaiting-momentum') scroll.current.gesture = 'momentum';
  }, []);
  const momentumEnd = useCallback(() => {
    if (scroll.current.gesture === 'momentum') scroll.current.gesture = 'idle';
  }, []);
  const dragEnd = useCallback((event: NativeScrollEvent) => {
    scroll.current.gesture = event.velocity?.y ? 'awaiting-momentum' : 'idle';
  }, []);
  const advance = useCallback(
    (event: ScrollSample) => {
      const current = scroll.current;
      const correction = event.contentOffsetCorrection?.y || 0;
      const movement = Math.round(
        (event.contentOffset.y - current.offset - (correction - current.correction)) * PixelRatio.get()
      );
      current.offset = event.contentOffset.y;
      current.correction = correction;
      if (
        !active ||
        (current.gesture !== 'drag' && current.gesture !== 'momentum') ||
        movement === 0 ||
        loadOwner.current ||
        read.loadingMoreReplies ||
        read.loadingPreviousReplies
      )
        return;
      const { contentOffset, contentSize, layoutMeasurement } = event;
      if (layoutMeasurement.height <= 0) return;
      let load: EdgeRead['loadPreviousReplies'] | undefined;
      if (movement < 0 && read.replyHasPrevious && !read.replyStartError && startIndex >= 0) {
        const layout = list.current?.getLayout(startIndex);
        if (!layout) return;
        const boundary = (list.current?.getFirstItemOffset() || 0) + layout.y;
        const cursor = `${read.replyPreviousCursor?.page}:${read.replyPreviousCursor?.offset}`;
        if (
          contentOffset.y + layoutMeasurement.height < boundary ||
          contentOffset.y - boundary > START_THRESHOLD * layoutMeasurement.height ||
          current.start === cursor
        )
          return;
        current.start = cursor;
        load = read.loadPreviousReplies;
      } else if (movement > 0 && read.replyHasMore && !read.replyEndError) {
        const cursor = `${read.replyNextPage}:${read.replyNextOffset}`;
        if (
          contentOffset.y + layoutMeasurement.height < contentSize.height - END_THRESHOLD * layoutMeasurement.height ||
          current.end === cursor
        )
          return;
        current.end = cursor;
        load = read.loadMoreReplies;
      }
      if (!load) return;
      const owner = {};
      loadOwner.current = owner;
      void load().finally(() => {
        if (loadOwner.current === owner) loadOwner.current = null;
      });
    },
    [
      active,
      list,
      read.loadMoreReplies,
      read.loadPreviousReplies,
      read.loadingMoreReplies,
      read.loadingPreviousReplies,
      read.replyEndError,
      read.replyHasMore,
      read.replyHasPrevious,
      read.replyNextOffset,
      read.replyNextPage,
      read.replyPreviousCursor,
      read.replyStartError,
      startIndex
    ]
  );
  const phase = useCallback(
    () => (scroll.current.gesture === 'awaiting-momentum' ? 'idle' : scroll.current.gesture),
    []
  );
  return { stop, begin, momentumBegin, momentumEnd, dragEnd, advance, phase };
}
