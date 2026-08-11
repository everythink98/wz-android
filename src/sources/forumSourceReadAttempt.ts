import type { Source } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';

type ForumRecoverySource = Extract<Source, 'linuxdo' | 'nodeseek'>;

type ForumReadResponseEvidence = {
  commit: () => Promise<unknown>;
  kind: 'direct' | 'fallback';
  ordinal: number;
  source: ForumRecoverySource;
  state: 'pending' | 'accepted' | 'rejected';
};

type ForumSourceReadAttempt = {
  aggregate?: ForumSourceReadAggregateAttempt;
  eligibility: Set<() => boolean>;
  evidence: ForumReadResponseEvidence[];
  open: boolean;
  source: Source;
};

type ForumSourceReadAttemptSettlement = {
  attempt: ForumSourceReadAttempt;
  evidence: ForumReadResponseEvidence[];
};

type ForumSourceReadAggregateAttempt = {
  isEligible: () => boolean;
  open: boolean;
  settlements: ForumSourceReadAttemptSettlement[];
};

const FORUM_SOURCE_READ_ATTEMPT = Symbol('wz.forumSourceReadAttempt');
const FORUM_SOURCE_READ_AGGREGATE_ATTEMPT = Symbol('wz.forumSourceReadAggregateAttempt');
const FORUM_SOURCE_READ_ELIGIBILITY = Symbol('wz.forumSourceReadEligibility');

type ForumSourceReadRequestInit = RequestInit & {
  [FORUM_SOURCE_READ_AGGREGATE_ATTEMPT]?: ForumSourceReadAggregateAttempt;
  [FORUM_SOURCE_READ_ELIGIBILITY]?: () => boolean;
  [FORUM_SOURCE_READ_ATTEMPT]?: ForumSourceReadAttempt;
};

const responseEvidence = new WeakMap<Response, ForumReadResponseEvidence[]>();

export function registerForumReadResponseEvidence(
  init: RequestInit | undefined,
  response: Response,
  evidence: Omit<ForumReadResponseEvidence, 'state'>
) {
  const attempt = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_ATTEMPT];
  if (!attempt?.open || attempt.source !== evidence.source) {
    return false;
  }
  const aggregate = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_AGGREGATE_ATTEMPT];
  if (aggregate) {
    if (attempt.aggregate && attempt.aggregate !== aggregate) {
      return false;
    }
    attempt.aggregate = aggregate;
  }
  const inheritedEligibility = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_ELIGIBILITY];
  if (inheritedEligibility) {
    attempt.eligibility.add(inheritedEligibility);
  }
  const registered: ForumReadResponseEvidence = { ...evidence, state: 'pending' };
  attempt.evidence.push(registered);
  responseEvidence.set(response, [...(responseEvidence.get(response) || []), registered]);
  return true;
}

function updateResponseEvidence(response: Response, state: 'accepted' | 'rejected') {
  for (const evidence of responseEvidence.get(response) || []) {
    if (evidence.state === 'pending') {
      evidence.state = state;
    }
  }
}

export function acceptForumReadResponse(response: Response) {
  updateResponseEvidence(response, 'accepted');
}

export function rejectForumReadResponse(response: Response) {
  updateResponseEvidence(response, 'rejected');
}

export async function proveForumReadResponse<T>(response: Response, parse: () => T | Promise<T>): Promise<T> {
  try {
    const result = await parse();
    acceptForumReadResponse(response);
    return result;
  } catch (error) {
    rejectForumReadResponse(response);
    throw error;
  }
}

function safelyCheckEligibility(isEligible: () => boolean) {
  try {
    return isEligible();
  } catch {
    return false;
  }
}

function isAttemptEligible(attempt: ForumSourceReadAttempt) {
  return [...attempt.eligibility].every(safelyCheckEligibility);
}

async function commitForumReadEvidence(
  attempt: ForumSourceReadAttempt,
  evidenceToCommit: ForumReadResponseEvidence[],
  aggregateIsEligible: (() => boolean) | undefined
) {
  for (const evidence of evidenceToCommit) {
    if ((aggregateIsEligible && !safelyCheckEligibility(aggregateIsEligible)) || !isAttemptEligible(attempt)) {
      break;
    }
    try {
      await evidence.commit();
    } catch {
      // A parsed WebView result remains usable even when runtime recovery fails.
    }
  }
}

export function withForumSourceReadEligibility(fetcher: Fetcher, isEligible: () => boolean): Fetcher {
  return (input, init) => {
    const inheritedEligibility = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_ELIGIBILITY];
    const combinedEligibility = inheritedEligibility ? () => inheritedEligibility() && isEligible() : isEligible;
    return fetcher(input, {
      ...init,
      [FORUM_SOURCE_READ_ELIGIBILITY]: combinedEligibility
    } as ForumSourceReadRequestInit);
  };
}

export async function runForumSourceReadAggregateAttempt<T>(
  fetcher: Fetcher,
  read: (scopedFetcher: Fetcher, scopeFetcher: (sourceFetcher: Fetcher) => Fetcher) => Promise<T>,
  isEligible: () => boolean
): Promise<T> {
  const aggregate: ForumSourceReadAggregateAttempt = {
    isEligible,
    open: true,
    settlements: []
  };
  const scopeFetcher =
    (sourceFetcher: Fetcher): Fetcher =>
    (input, init) =>
      sourceFetcher(input, {
        ...init,
        [FORUM_SOURCE_READ_AGGREGATE_ATTEMPT]: aggregate
      } as ForumSourceReadRequestInit);
  const scopedFetcher = scopeFetcher(fetcher);
  let result: T;
  try {
    result = await read(scopedFetcher, scopeFetcher);
  } catch (error) {
    aggregate.open = false;
    throw error;
  }
  aggregate.open = false;
  for (const settlement of aggregate.settlements) {
    if (!safelyCheckEligibility(aggregate.isEligible)) {
      break;
    }
    await commitForumReadEvidence(settlement.attempt, settlement.evidence, aggregate.isEligible);
  }
  return result;
}

export async function runForumSourceReadAttempt<T>(
  source: Source,
  fetcher: Fetcher,
  read: (scopedFetcher: Fetcher) => Promise<T>,
  isEligible: () => boolean
): Promise<T> {
  const attempt: ForumSourceReadAttempt = {
    eligibility: new Set([isEligible]),
    evidence: [],
    open: true,
    source
  };
  const scopedFetcher: Fetcher = (input, init) =>
    fetcher(input, {
      ...init,
      [FORUM_SOURCE_READ_ATTEMPT]: attempt
    } as ForumSourceReadRequestInit);
  let result: T;
  try {
    result = await read(scopedFetcher);
  } catch (error) {
    attempt.open = false;
    throw error;
  }
  attempt.open = false;
  const accepted = attempt.evidence.filter((evidence) => evidence.state === 'accepted');
  const acceptedFallbacks = accepted.filter((evidence) => evidence.kind === 'fallback');
  const evidenceToCommit = acceptedFallbacks.length
    ? acceptedFallbacks
    : accepted.filter((evidence) => evidence.kind === 'direct');
  const sortedEvidence = evidenceToCommit.sort((left, right) => left.ordinal - right.ordinal);
  if (attempt.aggregate) {
    if (attempt.aggregate.open) {
      attempt.aggregate.settlements.push({ attempt, evidence: sortedEvidence });
    }
    return result;
  }
  await commitForumReadEvidence(attempt, sortedEvidence, undefined);
  return result;
}
