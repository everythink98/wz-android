import { useCallback, useLayoutEffect, useRef } from 'react';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

const WEB_VIEW_LOAD_TIMEOUT_MS = 12_000;
type Deadline = { webViewKey: number; timer: ReturnType<typeof setTimeout> };

export function useWebViewLoadDeadline({
  enabled,
  loading,
  webViewKey,
  onTimeout
}: {
  enabled: boolean;
  loading: boolean;
  webViewKey: number;
  onTimeout: (webViewKey: number) => void;
}) {
  const deadlineRef = useRef<Deadline | null>(null);
  const activeKey = useCommittedRef(enabled ? webViewKey : null);
  const onTimeoutRef = useCommittedRef(onTimeout);
  const cancel = useCallback((key: number) => {
    const deadline = deadlineRef.current;
    if (deadline?.webViewKey !== key) return;
    deadlineRef.current = null;
    clearTimeout(deadline.timer);
  }, []);
  const update = useCallback(
    (key: number, pending: boolean) => {
      if (!pending) {
        cancel(key);
        return;
      }
      if (activeKey.current !== key || deadlineRef.current?.webViewKey === key) return;
      const deadline = {
        webViewKey: key,
        timer: setTimeout(() => {
          if (deadlineRef.current !== deadline || activeKey.current !== key) return;
          deadlineRef.current = null;
          onTimeoutRef.current(key);
        }, WEB_VIEW_LOAD_TIMEOUT_MS)
      };
      deadlineRef.current = deadline;
    },
    [activeKey, cancel, onTimeoutRef]
  );

  useLayoutEffect(() => () => cancel(webViewKey), [cancel, webViewKey]);
  useLayoutEffect(() => {
    update(webViewKey, enabled && loading);
  }, [enabled, loading, update, webViewKey]);
  return update;
}
