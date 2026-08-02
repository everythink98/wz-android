import { useCallback, useEffect } from 'react';
import { isCancelledError, useQuery } from '@tanstack/react-query';
import type { XiaoyinsiAuthPhase } from '@/domain/session/accountCenter';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export function useXiaoyinsiLevelController({
  authorizationPhase,
  isIdentityPending,
  notify,
  readGateway,
  sessionEpochs
}: {
  authorizationPhase: XiaoyinsiAuthPhase;
  isIdentityPending?: () => boolean;
  notify: (message: string) => void;
  readGateway: Pick<ReadGateway, 'getLevelProfile'>;
  sessionEpochs: ForumSessionEpochs;
}) {
  const levelQuery = useQuery({
    enabled: false,
    queryKey: forumQueryKeys.levelProfile({ sessionEpochs, source: 'xiaoyinsi' }),
    queryFn: async ({ signal }) => {
      const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
      markDiagnosticStage(trace, 'guard', { source: 'xiaoyinsi', state: 'ready' });
      try {
        const profile = await readGateway.getLevelProfile({ source: 'xiaoyinsi', signal }, { trace });
        markDiagnosticStage(trace, 'apply', { source: 'xiaoyinsi', state: 'loaded' });
        finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi' });
        return profile;
      } catch (error) {
        const canceled = signal.aborted || isCancelledError(error) || isCanceledRequest(error);
        const reason = canceled ? 'canceled' : normalizeDiagnosticReason(error);
        finishDiagnosticTrace(
          trace,
          canceled
            ? 'canceled'
            : reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied'
              ? 'blocked'
              : 'failure',
          { source: 'xiaoyinsi', reason }
        );
        throw error;
      }
    }
  });

  const resetLevel = useCallback(() => {
    void appQueryClient.cancelQueries({ queryKey: forumQueryKeys.level('xiaoyinsi') });
    appQueryClient.removeQueries({ queryKey: forumQueryKeys.level('xiaoyinsi') });
  }, []);

  const refreshLevel = useCallback(async () => {
    if (isIdentityPending?.()) {
      return false;
    }
    const result = await levelQuery.refetch({ cancelRefetch: false });
    if (result.error) return false;
    if (result.data) {
      notify('小隐寺等级已更新。');
      return true;
    }
    return false;
  }, [isIdentityPending, levelQuery.refetch, notify]);

  useEffect(() => resetLevel, [resetLevel]);
  useEffect(() => {
    if (authorizationPhase !== 'authorized') {
      resetLevel();
    }
  }, [authorizationPhase, resetLevel]);

  return {
    levelBusy: levelQuery.isFetching,
    levelError: levelQuery.error ? errorMessage(levelQuery.error) : '',
    levelProfile: levelQuery.data ?? null,
    refreshLevel
  };
}
