import { resolveForumReadPlan, type ForumReadOperation } from '@/domain/forum/readPlan';
import type { Source } from '@/domain/forum/models';
import { isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';

export function createSessionReadPlan({
  getIdentityBarriers,
  getIdentityTrust,
  getSessionEpochs,
  getSourceEnabled
}: {
  getIdentityBarriers: () => SessionSource[];
  getIdentityTrust?: (source: SessionSource) => SessionRuntimeSnapshot['identityTrust'];
  getSessionEpochs: () => ForumSessionEpochs;
  getSourceEnabled: (source: Source) => boolean;
}) {
  return (source: Source, operation: ForumReadOperation) => {
    const authSurfaceOpen = isSessionSource(source) && getIdentityBarriers().includes(source);
    const identityTrust = isSessionSource(source) ? getIdentityTrust?.(source) || 'confirmed' : undefined;
    return resolveForumReadPlan(
      source,
      operation,
      getSourceEnabled(source),
      isSessionSource(source)
        ? {
            source,
            authenticated: identityTrust === 'confirmed',
            authSurfaceOpen,
            identityKey: `${source}:test`,
            identityTrust: identityTrust!,
            sessionEpoch: getSessionEpochs()[source],
            sourceEnabled: getSourceEnabled(source)
          }
        : undefined
    );
  };
}
