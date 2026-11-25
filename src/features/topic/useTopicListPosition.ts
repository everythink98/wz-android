import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PixelRatio } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ReplyLocationTarget, TopicDetail, TopicLocationTarget } from '@/domain/forum/models';
import { resolveTopicLocation } from '@/domain/forum/topicLocation';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import type { TopicListItem } from './model/topicListModel';
import type { useTopicReadingEntry } from './useTopicReadingEntry';

type RecordScroll = (
  reason: NonNullable<DiagnosticFields['scrollReason']>,
  target: Pick<DiagnosticFields, 'targetIndex' | 'offset'>
) => void;

export function useTopicLocationCommand({
  topic,
  topicKey,
  location,
  locationRequestId,
  clearFilters,
  locate
}: {
  topic: TopicDetail | null;
  topicKey: string;
  location?: TopicLocationTarget;
  locationRequestId?: number;
  clearFilters: () => void;
  locate: (target: ReplyLocationTarget) => unknown;
}) {
  const nextRequest = useRef(0);
  const [request, setRequest] = useState<{ id: number; target: ReplyLocationTarget | null } | null>(null);
  const routeReply = location?.kind === 'reply' ? location.target : undefined;
  useEffect(
    () => setRequest(null),
    [
      topicKey,
      location?.kind,
      locationRequestId,
      routeReply?.commentId,
      routeReply?.floor,
      routeReply?.pageHint,
      routeReply?.expectedAuthorUsername
    ]
  );
  const activeLocation = resolveTopicLocation(
    topic,
    request ? (request.target ? { kind: 'reply', target: request.target } : undefined) : location
  );
  const activeTargetReply = activeLocation?.kind === 'reply' ? activeLocation.target : undefined;
  const targetIdentity =
    activeLocation?.kind === 'opening'
      ? 'opening'
      : typeof activeTargetReply?.commentId === 'number'
        ? `comment:${activeTargetReply.commentId}:${activeTargetReply.expectedAuthorUsername ?? ''}`
        : typeof activeTargetReply?.floor === 'number'
          ? `floor:${activeTargetReply.floor}:${activeTargetReply.expectedAuthorUsername ?? ''}`
          : '';
  const commandKey = request?.target
    ? `request:${request.id}`
    : targetIdentity
      ? typeof locationRequestId === 'number'
        ? `route-request:${locationRequestId}`
        : `route:${targetIdentity}`
      : '';
  const requestReplyLocation = useCallback(
    (target: ReplyLocationTarget) => {
      const id = ++nextRequest.current;
      setRequest({ id, target });
      clearFilters();
      void Promise.resolve(locate(target)).then((outcome) => {
        if (outcome === 'failed' || outcome === 'stale') {
          setRequest((current) => (current?.id === id ? { id, target: null } : current));
        }
      });
    },
    [clearFilters, locate]
  );
  return { activeLocation, activeTargetReply, commandKey, requestReplyLocation };
}

type PositionRequest = {
  topicKey: string;
  commandKey: string;
  rowKey?: string;
  offset: number;
  highlight: boolean;
};

type PositionState =
  | { phase: 'idle' }
  | { phase: 'handled'; commandKey: string }
  | { phase: 'awaiting-viewport' | 'interrupted' | 'positioned'; request: PositionRequest };

export function useTopicFloorPositioning({
  active,
  topicKey,
  loadedDetailKey,
  commandKey,
  targetIsOpeningPost,
  targetInLoadedReplies,
  targetReply,
  canShowReplies,
  filtersActive,
  clearFilters,
  readingEntry,
  items,
  targetIndex,
  targetOffset,
  viewport,
  list,
  recordScroll
}: {
  active: boolean;
  topicKey: string;
  loadedDetailKey: string;
  commandKey: string;
  targetIsOpeningPost: boolean;
  targetInLoadedReplies: boolean;
  targetReply?: ReplyLocationTarget;
  canShowReplies: boolean;
  filtersActive: boolean;
  clearFilters: () => void;
  readingEntry?: Pick<ReturnType<typeof useTopicReadingEntry>, 'anchor' | 'positioned'>;
  items: readonly TopicListItem[];
  targetIndex: number;
  targetOffset: number;
  viewport: RefObject<{ topicKey: string; offset: number; height: number }>;
  list: RefObject<FlashListRef<TopicListItem> | null>;
  recordScroll: RecordScroll;
}) {
  const position = useRef<PositionState>({ phase: 'idle' });
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedKey, setHighlightedKey] = useState('');
  useEffect(() => {
    position.current = { phase: 'idle' };
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedKey('');
  }, [topicKey, commandKey]);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );
  const confirm = useCallback(() => {
    const pending = position.current;
    const native = viewport.current;
    if (
      !active ||
      loadedDetailKey !== topicKey ||
      (pending.phase !== 'awaiting-viewport' && pending.phase !== 'interrupted') ||
      pending.request.topicKey !== topicKey ||
      pending.request.commandKey !== commandKey ||
      native.topicKey !== topicKey ||
      native.height <= 0
    )
      return;
    const request = pending.request;
    const topBoundary = PixelRatio.roundToNearestPixel(-1);
    let pixel = -native.offset;
    if (request.rowKey) {
      const index = items.findIndex((item) => item.key === request.rowKey);
      if (index < 0) return;
      const host = list.current;
      const layout = host?.getLayout(index);
      if (!layout?.isHeightMeasured || layout.height <= 0) return;
      const offset = Math.min(request.offset, Math.max(0, layout.height - 1));
      pixel = (host?.getFirstItemOffset() || 0) + layout.y + offset - native.offset;
      if (request.offset > layout.height && PixelRatio.roundToNearestPixel(pixel) < topBoundary) {
        // A saved offset can be past the end of the row after it is measured at a new height.
        position.current = { ...pending, request: { ...request, offset } };
        void host?.scrollToIndex({ animated: false, index, viewPosition: 0, viewOffset: offset });
        return;
      }
    }
    const rounded = PixelRatio.roundToNearestPixel(pixel);
    if (rounded < topBoundary || rounded >= PixelRatio.roundToNearestPixel(native.height)) return;
    position.current = { phase: 'positioned', request };
    if (request.highlight) {
      setHighlightedKey(request.commandKey);
      highlightTimer.current = setTimeout(() => setHighlightedKey(''), 1800);
    }
    readingEntry?.positioned();
  }, [active, commandKey, items, list, loadedDetailKey, readingEntry, topicKey, viewport]);
  const cancel = useCallback(() => {
    position.current = { phase: 'handled', commandKey };
  }, [commandKey]);
  const ownsScroll = useCallback(() => {
    const current = position.current;
    return (
      current.phase === 'awaiting-viewport' ||
      current.phase === 'interrupted' ||
      (current.phase === 'positioned' && current.request.highlight)
    );
  }, []);
  const endScroll = useCallback(() => {
    if (position.current.phase === 'positioned') {
      position.current = { phase: 'handled', commandKey: position.current.request.commandKey };
    }
  }, []);
  useEffect(() => {
    const current = position.current;
    if (!active) {
      if (current.phase === 'awaiting-viewport') position.current = { ...current, phase: 'interrupted' };
      return;
    }
    if (loadedDetailKey !== topicKey || !commandKey || !canShowReplies) return;
    const handled =
      current.phase === 'handled' ? current.commandKey : current.phase === 'idle' ? '' : current.request.commandKey;
    if (handled === commandKey) {
      confirm();
      if (position.current.phase !== 'interrupted') return;
    }
    if (filtersActive) {
      if (targetIsOpeningPost || targetInLoadedReplies) clearFilters();
      return;
    }
    if (targetIndex < 0 && !targetIsOpeningPost) return;
    const highlight = !targetIsOpeningPost && !targetReply?.readingResume;
    const rowKey = items[targetIndex]?.key;
    position.current = {
      phase: 'awaiting-viewport',
      request: { topicKey, commandKey, rowKey, offset: targetOffset, highlight }
    };
    recordScroll(
      highlight ? 'reply-location' : targetReply?.readingResume || readingEntry?.anchor ? 'reading-resume' : 'opening',
      {
        ...(rowKey ? { targetIndex } : {}),
        offset: targetOffset
      }
    );
    void list.current?.scrollToIndex({
      animated: highlight,
      index: rowKey ? targetIndex : 0,
      ...(targetIsOpeningPost ? {} : { viewPosition: 0 }),
      viewOffset: rowKey ? targetOffset : 0 - (list.current?.getFirstItemOffset() || 0)
    });
    confirm();
  }, [
    active,
    canShowReplies,
    clearFilters,
    commandKey,
    confirm,
    filtersActive,
    items,
    list,
    loadedDetailKey,
    readingEntry,
    recordScroll,
    targetIndex,
    targetOffset,
    targetIsOpeningPost,
    targetInLoadedReplies,
    targetReply?.readingResume,
    topicKey
  ]);
  return { confirm, cancel, ownsScroll, endScroll, highlightedKey };
}
