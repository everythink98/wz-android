import { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';

type DeferredNavigationTask = ReturnType<typeof InteractionManager.runAfterInteractions>;

const NAVIGATION_DEFERRED_TASK_FALLBACK_MS = 420;

export function useDeferredNavigationTask() {
  const transitionTaskRef = useRef<(() => void) | null>(null);
  const transitionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionTaskRef = useRef<DeferredNavigationTask | null>(null);
  const interactionTaskIdRef = useRef(0);

  const cancelDeferredNavigationTask = useCallback(() => {
    interactionTaskIdRef.current += 1;
    transitionTaskRef.current = null;
    if (transitionFallbackTimerRef.current) {
      clearTimeout(transitionFallbackTimerRef.current);
      transitionFallbackTimerRef.current = null;
    }
    interactionTaskRef.current?.cancel();
    interactionTaskRef.current = null;
  }, []);

  const flushDeferredNavigationTask = useCallback(() => {
    const task = transitionTaskRef.current;
    if (!task) {
      return;
    }
    transitionTaskRef.current = null;
    if (transitionFallbackTimerRef.current) {
      clearTimeout(transitionFallbackTimerRef.current);
      transitionFallbackTimerRef.current = null;
    }
    interactionTaskRef.current?.cancel();
    const taskId = ++interactionTaskIdRef.current;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (interactionTaskIdRef.current !== taskId) {
        return;
      }
      interactionTaskRef.current = null;
      task();
    });
    interactionTaskRef.current = handle;
  }, []);

  const runAfterNavigationInteractions = useCallback(
    (task: () => void) => {
      cancelDeferredNavigationTask();
      transitionTaskRef.current = task;
      transitionFallbackTimerRef.current = setTimeout(
        flushDeferredNavigationTask,
        NAVIGATION_DEFERRED_TASK_FALLBACK_MS
      );
    },
    [cancelDeferredNavigationTask, flushDeferredNavigationTask]
  );

  return {
    cancelDeferredNavigationTask,
    flushDeferredNavigationTask,
    runAfterNavigationInteractions
  };
}
