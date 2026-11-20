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
  | 'interaction-config'
  | 'topic-creation-context'
  | 'topic-edit-context'
  | 'user-profile'
  | 'user-resolution'
  | 'search-tags'
  | 'search-users'
  | 'semantic-search'
  | 'account-data'
  | 'level';

type ReadDecision =
  | {
      state: 'ready';
      lane: 'local' | 'public' | 'authenticated';
      transport: 'none' | 'native-no-cookie' | 'native-clearance-only' | 'managed-session';
      cacheScope: string;
    }
  | {
      state: 'blocked';
      reason:
        'source-disabled' | 'identity-pending' | 'identity-unavailable' | 'login-required' | 'capability-unavailable';
      cacheScope: string;
    };

export type ForumReadPlan = ReadDecision & { source: Source; operation: ForumReadOperation };

export type AggregateForumReadPlan = {
  source: 'all';
  operation: ForumReadOperation;
  sites: readonly ForumReadPlan[];
  cacheScope: string;
};

export function forumReadSites(plan: ForumReadPlan | AggregateForumReadPlan): readonly ForumReadPlan[] {
  return plan.source === 'all' ? plan.sites : [plan];
}

export function aggregateForumReadPlan(
  operation: ForumReadOperation,
  sites: readonly ForumReadPlan[]
): AggregateForumReadPlan {
  const scopes = new Map(sites.map((site) => [site.source, site.cacheScope]));
  return {
    source: 'all',
    operation,
    sites,
    cacheScope: sourceValues
      .flatMap((source) => (scopes.has(source) ? [`${source}:${scopes.get(source)}`] : []))
      .join(',')
  };
}

const publicOperations: Record<Source, ReadonlySet<ForumReadOperation>> = {
  v2ex: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'user-profile']),
  linuxdo: new Set([
    'categories',
    'feed',
    'search',
    'topic',
    'replies',
    'reply',
    'emoji',
    'interaction-config',
    'user-profile'
  ]),
  nodeseek: new Set(['categories', 'feed', 'search', 'topic', 'replies', 'reply', 'user-profile']),
  yaohuo: new Set()
};

const localOperations: Partial<Record<Source, ReadonlySet<ForumReadOperation>>> = {
  yaohuo: new Set(['categories'])
};

export function forumReadOperationIsPublic(source: Source, operation: ForumReadOperation) {
  return publicOperations[source].has(operation);
}

function blocked(reason: Extract<ReadDecision, { state: 'blocked' }>['reason']): ReadDecision {
  return { state: 'blocked', reason, cacheScope: `blocked:${reason}` };
}

function publicTransport(
  source: Source,
  operation: ForumReadOperation
): Extract<ForumReadPlan, { state: 'ready' }>['transport'] {
  if (source === 'linuxdo' || source === 'nodeseek') {
    return operation === 'search' ? 'none' : 'native-clearance-only';
  }
  return 'native-no-cookie';
}

export function resolveForumReadPlan(
  source: Source,
  operation: ForumReadOperation,
  enabled: boolean,
  session?: SessionRuntimeSnapshot
): ForumReadPlan {
  return { source, operation, ...readDecision(source, operation, enabled, session) };
}

function readDecision(
  source: Source,
  operation: ForumReadOperation,
  enabled: boolean,
  session?: SessionRuntimeSnapshot
): ReadDecision {
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
          transport: publicTransport(source, operation),
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
      transport: publicTransport(source, operation),
      cacheScope: 'public:omit'
    };
  }
  if (session.authSurfaceOpen) return blocked('identity-pending');
  if (session.identityTrust === 'unknown') return blocked('identity-unavailable');
  return blocked('login-required');
}
