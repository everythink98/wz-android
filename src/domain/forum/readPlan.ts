import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { isSessionSource, sourceValues, type Source } from './sourceCatalog';

export type ForumReadOperation =
  | 'categories'
  | 'feed'
  | 'search'
  | 'topic'
  | 'replies'
  | 'reply'
  | 'emoji'
  | 'user-profile'
  | 'user-resolution'
  | 'search-tags'
  | 'search-users'
  | 'semantic-search'
  | 'level';

export type ForumReadPlan =
  | {
      state: 'ready';
      lane: 'local' | 'public' | 'authenticated';
      transport: 'none' | 'native-no-cookie' | 'managed-session';
      cacheScope: string;
    }
  | {
      state: 'blocked';
      reason:
        'source-disabled' | 'identity-pending' | 'identity-unavailable' | 'login-required' | 'capability-unavailable';
      cacheScope: string;
    };

const publicOperations: Record<Source, ReadonlySet<ForumReadOperation>> = {
  v2ex: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'user-profile']),
  linuxdo: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'emoji', 'user-profile']),
  nodeseek: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'user-profile']),
  yaohuo: new Set(),
  xiaoyinsi: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'emoji', 'user-profile'])
};

const localOperations: Partial<Record<Source, ReadonlySet<ForumReadOperation>>> = {
  yaohuo: new Set(['categories'])
};

export function forumReadOperationIsPublic(source: Source, operation: ForumReadOperation) {
  return publicOperations[source].has(operation);
}

export function forumReadPlanScopesKey(scopes: readonly (readonly [Source, string])[]) {
  const bySource = new Map(scopes);
  return sourceValues
    .flatMap((source) => (bySource.has(source) ? [`${source}:${bySource.get(source)}`] : []))
    .join(',');
}

function blocked(reason: Extract<ForumReadPlan, { state: 'blocked' }>['reason']): ForumReadPlan {
  return { state: 'blocked', reason, cacheScope: `blocked:${reason}` };
}

export function resolveForumReadPlan(
  source: Source,
  operation: ForumReadOperation,
  enabled: boolean,
  session?: SessionRuntimeSnapshot
): ForumReadPlan {
  if (!enabled || session?.sourceEnabled === false) return blocked('source-disabled');
  if (session && session.source !== source) return blocked('capability-unavailable');
  if (localOperations[source]?.has(operation)) {
    return { state: 'ready', lane: 'local', transport: 'none', cacheScope: 'local' };
  }
  if (!isSessionSource(source)) {
    return publicOperations[source].has(operation)
      ? {
          state: 'ready',
          lane: 'public',
          transport: 'native-no-cookie',
          cacheScope: 'public:omit'
        }
      : blocked('capability-unavailable');
  }
  if (!session) return blocked('identity-pending');
  if (session.authenticated && session.identityTrust === 'confirmed' && !session.authSurfaceOpen) {
    return {
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: `authenticated:${session.sessionEpoch}`
    };
  }
  if (publicOperations[source].has(operation)) {
    return {
      state: 'ready',
      lane: 'public',
      transport: 'native-no-cookie',
      cacheScope: 'public:omit'
    };
  }
  if (session.authSurfaceOpen) return blocked('identity-pending');
  if (session.identityTrust === 'unknown') return blocked('identity-unavailable');
  return blocked('login-required');
}
