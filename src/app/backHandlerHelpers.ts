import type { Screen } from '../appTypes';

export function selectTopicReturnStrategy({
  canGoBack,
  hasReturningTopicRoute,
  hasSnapshot
}: {
  canGoBack: boolean;
  hasReturningTopicRoute: boolean;
  hasSnapshot: boolean;
}) {
  if (canGoBack && hasReturningTopicRoute) return 'route-pop' as const;
  if (hasSnapshot) return 'snapshot-fallback' as const;
  return canGoBack ? ('native-pop' as const) : ('return-screen' as const);
}

type TopicReturnStrategy = ReturnType<typeof selectTopicReturnStrategy>;

export function executeTopicReturnStrategy({
  canGoBack,
  goBack,
  restoreReturningRoute,
  restoreSnapshot,
  returnToScreen,
  strategy
}: {
  canGoBack: boolean;
  goBack: () => void;
  restoreReturningRoute: () => boolean;
  restoreSnapshot: () => void;
  returnToScreen: () => void;
  strategy: TopicReturnStrategy;
}) {
  if (strategy === 'route-pop') {
    goBack();
    if (!restoreReturningRoute()) restoreSnapshot();
    return 'route-pop';
  }
  if (strategy === 'native-pop') {
    goBack();
    return 'native-back';
  }
  if (strategy === 'snapshot-fallback') {
    restoreSnapshot();
    if (canGoBack) goBack();
    return 'snapshot-restored';
  }
  returnToScreen();
  return 'return-screen';
}

export function executeUserReturnStrategy({
  canGoBack,
  goBack,
  restoreFallback,
  returnToScreen,
  scheduleFallbackRestore,
  scheduleMetadataRestore,
  strategy
}: {
  canGoBack: boolean;
  goBack: () => void;
  restoreFallback: () => void;
  returnToScreen: () => void;
  scheduleFallbackRestore: () => void;
  scheduleMetadataRestore: () => void;
  strategy: TopicReturnStrategy;
}) {
  if (strategy === 'route-pop') {
    scheduleMetadataRestore();
    goBack();
    return 'route-pop';
  }
  if (strategy === 'snapshot-fallback') {
    if (canGoBack) {
      scheduleFallbackRestore();
      goBack();
    } else {
      returnToScreen();
      restoreFallback();
    }
    return 'snapshot-fallback';
  }
  if (strategy === 'native-pop') {
    goBack();
    return 'native-back';
  }
  returnToScreen();
  return 'return-screen';
}

export function shouldCloseReplyComposerOnBack(screen: Screen, replyComposerOpen: boolean) {
  return screen === 'topic' && replyComposerOpen;
}
