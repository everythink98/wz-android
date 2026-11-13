import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { parseForumTopicDestination, parseInternalTopicOpenLink } from '@/domain/forum/links';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { pushTopicRoute } from './appNavigation';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

type InitialUrlReadState = { phase: 'waiting' } | { phase: 'destination-seen' } | { phase: 'retired' };
type PendingDestination =
  { phase: 'empty' } | { phase: 'queued'; destination: RootStackParamList['Topic']; trace: DiagnosticTrace };

export function useAppDeepLinkNavigation(
  linking: Pick<typeof Linking, 'addEventListener' | 'getInitialURL'> = Linking,
  pushTopic: typeof pushTopicRoute = pushTopicRoute
) {
  const pendingDestinationRef = useRef<PendingDestination>({ phase: 'empty' });
  useEffect(() => {
    let initialRead: InitialUrlReadState = { phase: 'waiting' };
    const openUrl = (url: string | null, trace: DiagnosticTrace) => {
      const destination = url ? parseInternalTopicOpenLink(url) || parseForumTopicDestination(url) : null;
      if (!destination) {
        finishDiagnosticTrace(trace, url ? 'blocked' : 'noop', { reason: url ? 'unsupported' : 'not_ready' });
        return;
      }
      if (initialRead.phase !== 'retired') initialRead = { phase: 'destination-seen' };
      const previous = pendingDestinationRef.current;
      pendingDestinationRef.current = { phase: 'empty' };
      if (previous.phase === 'queued') finishDiagnosticTrace(previous.trace, 'stale', { reason: 'superseded' });
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
        pendingDestinationRef.current = { phase: 'queued', destination, trace };
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
        if (initialRead.phase === 'retired') {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        if (initialRead.phase === 'destination-seen') {
          finishDiagnosticTrace(trace, 'stale', { reason: 'superseded' });
          return;
        }
        openUrl(url, trace);
      })
      .catch(() => finishDiagnosticTrace(trace, 'failure', { reason: 'unknown' }));
    return () => {
      initialRead = { phase: 'retired' };
      subscription.remove();
      finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
      if (pendingDestinationRef.current.phase === 'queued')
        finishDiagnosticTrace(pendingDestinationRef.current.trace, 'canceled', { reason: 'canceled' });
      pendingDestinationRef.current = { phase: 'empty' };
    };
  }, [linking, pushTopic]);

  return useCallback(() => {
    const pending = pendingDestinationRef.current;
    if (pending.phase === 'empty') return;
    pendingDestinationRef.current = { phase: 'empty' };
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
