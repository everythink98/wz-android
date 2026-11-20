import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PixelRatio } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ReplyLocationTarget, TopicDetail, TopicLocationTarget } from '@/domain/forum/models';
import { resolveTopicLocation } from '@/domain/forum/topicLocation';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import type { TopicListItem } from './model/topicListModel';
import { topicListReadingRevision } from './model/topicListModel';
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
  const [request, setRequest] = useState<{ id: number; target: ReplyLocationTarget } | null>(null);
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
  const activeLocation = resolveTopicLocation(topic, request ? { kind: 'reply', target: request.target } : location);
  const activeTargetReply = activeLocation?.kind === 'reply' ? activeLocation.target : undefined;
  const targetIdentity =
    activeLocation?.kind === 'opening'
      ? 'opening'
      : typeof activeTargetReply?.commentId === 'number'
        ? `comment:${activeTargetReply.commentId}:${activeTargetReply.expectedAuthorUsername ?? ''}`
        : typeof activeTargetReply?.floor === 'number'
          ? `floor:${activeTargetReply.floor}:${activeTargetReply.expectedAuthorUsername ?? ''}`
          : '';
  const commandKey = request
    ? `request:${request.id}`
    : targetIdentity
      ? typeof locationRequestId === 'number'
        ? `route-request:${locationRequestId}`
        : `route:${targetIdentity}`
      : '';
  const requestReplyLocation = useCallback(
    (target: ReplyLocationTarget) => {
      setRequest({ id: ++nextRequest.current, target });
      clearFilters();
      void locate(target);
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
  | { phase: 'awaiting-viewport' | 'positioned'; request: PositionRequest };

export function useTopicFloorPositioning({
  active,
  topicKey,
  loadedDetailKey,
  commandKey,
  targetIsOpeningPost,
  targetReply,
  canShowReplies,
  filtersActive,
  clearFilters,
  readingEntry,
  items,
  targetIndex,
  viewport,
  list,
  recordScroll
}: {
  active: boolean;
  topicKey: string;
  loadedDetailKey: string;
  commandKey: string;
  targetIsOpeningPost: boolean;
  targetReply?: ReplyLocationTarget;
  canShowReplies: boolean;
  filtersActive: boolean;
  clearFilters: () => void;
  readingEntry?: Pick<ReturnType<typeof useTopicReadingEntry>, 'anchor' | 'positioned'>;
  items: readonly TopicListItem[];
  targetIndex: number;
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
      pending.phase !== 'awaiting-viewport' ||
      pending.request.topicKey !== topicKey ||
      pending.request.commandKey !== commandKey ||
      native.topicKey !== topicKey ||
      native.height <= 0
    )
      return;
    const request = pending.request;
    let pixel = -native.offset;
    if (request.rowKey) {
      const index = items.findIndex((item) => item.key === request.rowKey);
      if (index < 0) return;
      const layout = list.current?.getLayout(index);
      if (!layout?.isHeightMeasured || layout.height <= 0) return;
      pixel =
        (list.current?.getFirstItemOffset() || 0) +
        layout.y +
        Math.min(request.offset, Math.max(0, layout.height - 1)) -
        native.offset;
    }
    const rounded = PixelRatio.roundToNearestPixel(pixel);
    if (rounded < PixelRatio.roundToNearestPixel(-1) || rounded >= PixelRatio.roundToNearestPixel(native.height))
      return;
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
  useEffect(() => {
    if (!active || loadedDetailKey !== topicKey || !commandKey || !canShowReplies) return;
    const current = position.current;
    const handled =
      current.phase === 'handled' ? current.commandKey : current.phase === 'idle' ? '' : current.request.commandKey;
    if (handled === commandKey) {
      confirm();
      return;
    }
    if (filtersActive) {
      clearFilters();
      return;
    }
    if (targetIsOpeningPost) {
      const anchor = readingEntry?.anchor;
      const index = anchor?.rowKey
        ? items.findIndex((item) => item.key === anchor.rowKey && topicListReadingRevision(item) === anchor.revision)
        : -1;
      position.current = {
        phase: 'awaiting-viewport',
        request: {
          topicKey,
          commandKey,
          rowKey: index >= 0 ? items[index].key : undefined,
          offset: index >= 0 ? anchor?.offset || 0 : 0,
          highlight: false
        }
      };
      recordScroll(anchor ? 'reading-resume' : 'opening', {
        ...(index >= 0 ? { targetIndex: index } : {}),
        offset: index >= 0 ? anchor?.offset || 0 : 0
      });
      if (index >= 0) void list.current?.scrollToIndex({ animated: false, index, viewOffset: anchor?.offset || 0 });
      else
        void list.current?.scrollToIndex({
          animated: false,
          index: 0,
          viewOffset: 0 - (list.current?.getFirstItemOffset() || 0)
        });
      confirm();
      return;
    }
    if (targetIndex < 0) return;
    const anchor = targetReply?.readingResume ? readingEntry?.anchor : undefined;
    const rowIndex = anchor?.rowKey
      ? items.findIndex((item) => item.key === anchor.rowKey && topicListReadingRevision(item) === anchor.revision)
      : -1;
    const index = rowIndex >= 0 ? rowIndex : targetIndex;
    position.current = {
      phase: 'awaiting-viewport',
      request: {
        topicKey,
        commandKey,
        rowKey: items[index].key,
        offset: rowIndex >= 0 ? anchor?.offset || 0 : 0,
        highlight: !targetReply?.readingResume
      }
    };
    recordScroll(targetReply?.readingResume ? 'reading-resume' : 'reply-location', {
      targetIndex: index,
      offset: rowIndex >= 0 ? anchor?.offset || 0 : 0
    });
    void list.current?.scrollToIndex({
      animated: !targetReply?.readingResume,
      index,
      viewPosition: 0,
      viewOffset: rowIndex >= 0 ? anchor?.offset || 0 : 0
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
    targetIsOpeningPost,
    targetReply?.readingResume,
    topicKey
  ]);
  return { confirm, cancel, highlightedKey };
}

export function useTopicAcceptedScroll({
  topicKey,
  acceptedIndex,
  list,
  stop,
  clearFilters,
  recordScroll
}: {
  topicKey: string;
  acceptedIndex: number;
  list: RefObject<FlashListRef<TopicListItem> | null>;
  stop: () => void;
  clearFilters: () => void;
  recordScroll: RecordScroll;
}) {
  const accepted = useRef(false);
  const scrollToAcceptedAnswer = useCallback(() => {
    stop();
    if (acceptedIndex < 0) {
      accepted.current = true;
      clearFilters();
      return;
    }
    recordScroll('accepted-answer', { targetIndex: acceptedIndex });
    void list.current?.scrollToIndex({ animated: true, index: acceptedIndex });
  }, [acceptedIndex, clearFilters, list, recordScroll, stop]);
  useEffect(() => {
    if (!accepted.current || acceptedIndex < 0) return;
    accepted.current = false;
    stop();
    recordScroll('accepted-answer', { targetIndex: acceptedIndex });
    void list.current?.scrollToIndex({ animated: true, index: acceptedIndex });
  }, [acceptedIndex, list, recordScroll, stop]);
  useEffect(() => {
    accepted.current = false;
  }, [topicKey]);
  return scrollToAcceptedAnswer;
}
