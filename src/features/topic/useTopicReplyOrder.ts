import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { View, ViewStyle } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ReplyOrder, SourceErrorInfo } from '@/domain/forum/models';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import type { TopicListItem } from './model/topicListModel';

type MenuState = { phase: 'closed' | 'measuring' | 'open'; placement: ViewStyle };
const DEFAULT_PLACEMENT: ViewStyle = { position: 'absolute', right: 12, top: 12, minWidth: 104 };

export function useTopicReplyOrder({
  active,
  windowHeight,
  windowWidth,
  trigger,
  order,
  changeOrder,
  listReady,
  repliesLoading,
  repliesError,
  items,
  list,
  recordScroll
}: {
  active: boolean;
  windowHeight: number;
  windowWidth: number;
  trigger: RefObject<View | null>;
  order: ReplyOrder;
  changeOrder: (order: ReplyOrder) => void;
  listReady: boolean;
  repliesLoading: boolean;
  repliesError: SourceErrorInfo | null;
  items: readonly TopicListItem[];
  list: RefObject<FlashListRef<TopicListItem> | null>;
  recordScroll: (
    reason: NonNullable<DiagnosticFields['scrollReason']>,
    target: Pick<DiagnosticFields, 'targetIndex' | 'offset'>
  ) => void;
}) {
  const current = useRef<MenuState>({ phase: 'closed', placement: DEFAULT_PLACEMENT });
  const [menu, publish] = useState(current.current);
  const pendingOrderScroll = useRef(false);
  const cancelPendingScroll = useCallback(() => {
    pendingOrderScroll.current = false;
  }, []);
  const close = useCallback(() => {
    const next: MenuState = { phase: 'closed', placement: current.current.placement };
    current.current = next;
    publish(next);
  }, []);
  useEffect(() => {
    close();
    return () => {
      current.current = { phase: 'closed', placement: current.current.placement };
    };
  }, [active, close, windowHeight, windowWidth]);
  const open = useCallback(() => {
    if (!active) return;
    const request: MenuState = { phase: 'measuring', placement: current.current.placement };
    current.current = request;
    publish(request);
    trigger.current?.measureInWindow((x, y, width, height) => {
      if (current.current !== request) return;
      const margin = 8;
      const opensAbove = y + height / 2 > windowHeight / 2;
      const next: MenuState = {
        phase: 'open',
        placement: {
          position: 'absolute',
          right: Math.max(margin, windowWidth - x - width),
          ...(opensAbove ? { bottom: Math.max(margin, windowHeight - y + 4) } : { top: y + height + 4 }),
          minWidth: 104
        }
      };
      current.current = next;
      publish(next);
    });
  }, [active, trigger, windowHeight, windowWidth]);
  const select = useCallback(
    (next: ReplyOrder) => {
      close();
      if (next === order) return;
      pendingOrderScroll.current = true;
      changeOrder(next);
    },
    [changeOrder, close, order]
  );
  useEffect(() => {
    if (!active || !listReady || !pendingOrderScroll.current || repliesLoading || repliesError) return;
    const index = items.findIndex((item) => item.type === 'reply' || item.type === 'replyStart');
    if (index < 0) return;
    pendingOrderScroll.current = false;
    recordScroll('reply-order', { targetIndex: index });
    void list.current?.scrollToIndex({ animated: true, index, viewPosition: 0 });
  }, [active, items, list, listReady, recordScroll, repliesError, repliesLoading]);
  return { open, close, select, cancelPendingScroll, visible: menu.phase === 'open', placement: menu.placement };
}
