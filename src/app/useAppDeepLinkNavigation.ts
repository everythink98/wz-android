import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { parseForumTopicDestination, parseInternalTopicOpenLink } from '@/domain/forum/links';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { pushTopicRoute } from './appNavigation';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

export function useAppDeepLinkNavigation(
  linking: Pick<typeof Linking, 'addEventListener' | 'getInitialURL'> = Linking,
  pushTopic: typeof pushTopicRoute = pushTopicRoute
) {
  const pendingDestinationRef = useRef<{ destination: RootStackParamList['Topic']; trace: DiagnosticTrace } | null>(
    null
  );
  useEffect(() => {
    let active = true;
    let receivedDestination = false;
    const openUrl = (url: string | null, trace: DiagnosticTrace) => {
      const destination = url ? parseInternalTopicOpenLink(url) || parseForumTopicDestination(url) : null;
      if (!destination) {
        finishDiagnosticTrace(trace, url ? 'blocked' : 'noop', { reason: url ? 'unsupported' : 'not_ready' });
        return;
      }
      receivedDestination = true;
      const previous = pendingDestinationRef.current;
      pendingDestinationRef.current = null;
      if (previous) finishDiagnosticTrace(previous.trace, 'stale', { reason: 'superseded' });
      markDiagnosticStage(trace, 'parse', {
        source: destination.topic.source,
        topicRef: diagnosticRef('topic', `${destination.topic.source}:${destination.topic.id}`),
        hasTargetReply: destination.location?.kind === 'reply'
      });
      let applied: boolean;
      try {
        applied = pushTopic(destination);
      } catch (error) {
        finishDiagnosticTrace(trace, 'failure', { reason: 'unknown' });
        throw error;
      }
      if (!applied) {
        pendingDestinationRef.current = { destination, trace };
        markDiagnosticStage(trace, 'guard', { state: 'queued', reason: 'not_ready' });
      } else finishDiagnosticTrace(trace, 'success', { state: 'applied' });
    };
    const subscription = linking.addEventListener('url', ({ url }) =>
      openUrl(url, beginDiagnosticTrace('navigation', 'deep-link', { origin: 'warm' }))
    );
    const trace = beginDiagnosticTrace('navigation', 'deep-link', { origin: 'cold' });
    void linking
      .getInitialURL()
      .then((url) => {
        if (!active) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        if (receivedDestination) {
          finishDiagnosticTrace(trace, 'stale', { reason: 'superseded' });
          return;
        }
        openUrl(url, trace);
      })
      .catch(() => finishDiagnosticTrace(trace, 'failure', { reason: 'unknown' }));
    return () => {
      active = false;
      subscription.remove();
      finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
      if (pendingDestinationRef.current)
        finishDiagnosticTrace(pendingDestinationRef.current.trace, 'canceled', { reason: 'canceled' });
      pendingDestinationRef.current = null;
    };
  }, [linking, pushTopic]);

  return useCallback(() => {
    const pending = pendingDestinationRef.current;
    if (!pending) return;
    pendingDestinationRef.current = null;
    let applied: boolean;
    try {
      applied = pushTopic(pending.destination);
    } catch (error) {
      finishDiagnosticTrace(pending.trace, 'failure', { reason: 'unknown' });
      throw error;
    }
    finishDiagnosticTrace(pending.trace, applied ? 'success' : 'blocked', {
      state: applied ? 'applied' : 'queued',
      ...(applied ? {} : { reason: 'not_ready' })
    });
  }, [pushTopic]);
}
