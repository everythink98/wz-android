import { useMemo } from 'react';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import type { Fetcher } from '@/platform/network/request';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { createReadGateway } from '@/sources/readGateway';
import { currentXiaoyinsiCredentialGeneration, loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';

export function useSessionReadGateway({
  fetcher,
  forumSessionEpochsRef,
  linuxDoUserAgentRef,
  nodeSeekUserAgentRef,
  readSessionRuntimeSnapshot,
  refreshXiaoyinsiAuthorization
}: {
  fetcher: Fetcher;
  forumSessionEpochsRef: { current: ForumSessionEpochs };
  linuxDoUserAgentRef: { current: string };
  nodeSeekUserAgentRef: { current: string };
  readSessionRuntimeSnapshot: (source: SessionSite) => SessionRuntimeSnapshot;
  refreshXiaoyinsiAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<boolean | null>;
}) {
  return useMemo(
    () =>
      createReadGateway({
        currentSessionEpoch: (source) => forumSessionEpochsRef.current[source],
        currentXiaoyinsiCredentialGeneration,
        fetcher,
        isSourceAuthenticated: (source) => readSessionRuntimeSnapshot(source).authenticated,
        isSourceReadBlocked: (source) => {
          const runtime = readSessionRuntimeSnapshot(source);
          return runtime.identityTrust === 'pending' || runtime.authSurfaceOpen;
        },
        linuxDoUserAgent: () => linuxDoUserAgentRef.current,
        loadXiaoyinsiCredentialsForSource: async (_source, options) => {
          const generation = currentXiaoyinsiCredentialGeneration();
          options?.captureGeneration?.(generation);
          const credentials = await loadXiaoyinsiCredentials();
          return generation === currentXiaoyinsiCredentialGeneration() ? credentials : undefined;
        },
        nodeSeekUserAgent: () => nodeSeekUserAgentRef.current,
        refreshXiaoyinsiAuthorization
      }),
    [
      fetcher,
      forumSessionEpochsRef,
      linuxDoUserAgentRef,
      nodeSeekUserAgentRef,
      readSessionRuntimeSnapshot,
      refreshXiaoyinsiAuthorization
    ]
  );
}
