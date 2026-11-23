import type { Source } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { createTrace, diagnosticRequestContext, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';

type ForumRecoverySource = Extract<Source, 'linuxdo' | 'nodeseek'>;

type ForumReadResponseEvidence = {
  commit: () => Promise<unknown>;
  kind: 'direct' | 'fallback';
  ordinal: number;
  source: ForumRecoverySource;
  state: 'pending' | 'accepted' | 'rejected';
  diagnosticFields: DiagnosticFields;
};

type AcceptedForumReadEvidence = ForumReadResponseEvidence & { state: 'accepted' };

type CollectingSourceEvidence = {
  phase: 'collecting';
  source: Source;
  aggregate?: ForumSourceReadAggregateAttempt;
  eligibility: Set<() => boolean>;
  evidence: ForumReadResponseEvidence[];
};

type ForumSourceReadAttempt = {
  state: CollectingSourceEvidence | { phase: 'settled' };
};

type ForumSourceReadAttemptSettlement = {
  eligibility: readonly (() => boolean)[];
  evidence: readonly AcceptedForumReadEvidence[];
};

type ForumSourceReadAggregateAttempt = {
  state: { phase: 'collecting'; settlements: ForumSourceReadAttemptSettlement[] } | { phase: 'settled' };
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

export function forumRecoveryDiagnosticFields(init?: RequestInit): DiagnosticFields {
  const context = diagnosticRequestContext(init);
  return context ? { parentTraceId: context.trace.traceId, requestId: context.requestId } : {};
}

export function recordForumRecoveryDecision(
  source: ForumRecoverySource,
  recoveryDecision: NonNullable<DiagnosticFields['recoveryDecision']>,
  fields: DiagnosticFields = {}
) {
  const failed = recoveryDecision === 'failed';
  finishDiagnosticTrace(createTrace('network', 'recovery-decision'), failed ? 'failure' : 'success', {
    ...fields,
    source,
    recoveryDecision
  });
}

function recordEvidenceDecision(
  evidence: ForumReadResponseEvidence,
  decision: NonNullable<DiagnosticFields['recoveryDecision']>,
  fields: DiagnosticFields = {}
) {
  recordForumRecoveryDecision(evidence.source, decision, {
    ...evidence.diagnosticFields,
    evidenceKind: evidence.kind,
    ordinal: evidence.ordinal,
    ...fields
  });
}

export function registerForumReadResponseEvidence(
  init: RequestInit | undefined,
  response: Response,
  evidence: Omit<ForumReadResponseEvidence, 'state' | 'diagnosticFields'>
) {
  const collection = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_ATTEMPT]?.state;
  if (collection?.phase !== 'collecting' || collection.source !== evidence.source) {
    if (evidence.kind === 'fallback')
      recordForumRecoveryDecision(evidence.source, 'ineligible', {
        ...forumRecoveryDiagnosticFields(init),
        evidenceKind: evidence.kind,
        ordinal: evidence.ordinal
      });
    return false;
  }
  const aggregate = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_AGGREGATE_ATTEMPT];
  if (aggregate) {
    if (collection.aggregate && collection.aggregate !== aggregate) {
      return false;
    }
    collection.aggregate = aggregate;
  }
  const inheritedEligibility = (init as ForumSourceReadRequestInit | undefined)?.[FORUM_SOURCE_READ_ELIGIBILITY];
  if (inheritedEligibility) {
    collection.eligibility.add(inheritedEligibility);
  }
  const registered: ForumReadResponseEvidence = {
    ...evidence,
    state: 'pending',
    diagnosticFields: forumRecoveryDiagnosticFields(init)
  };
  collection.evidence.push(registered);
  responseEvidence.set(response, [...(responseEvidence.get(response) || []), registered]);
  return true;
}

function updateResponseEvidence(response: Response, state: 'accepted' | 'rejected') {
  for (const evidence of responseEvidence.get(response) || []) {
    if (evidence.state === 'pending') {
      evidence.state = state;
      if (evidence.kind === 'fallback') recordEvidenceDecision(evidence, state);
    }
  }
}

export function acceptForumReadResponse(response: Response) {
  updateResponseEvidence(response, 'accepted');
}

// Some parsers validate required responses together, after matching their identities.
export function collectForumReadResponses(fetcher: Fetcher) {
  const required: Response[] = [];
  const collect: Fetcher = async (url, init) => {
    const response = await fetcher(url, init);
    required.push(response);
    return response;
  };
  return { fetcher: collect, accept: () => required.forEach(acceptForumReadResponse) };
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

async function commitForumReadEvidence(
  settlement: ForumSourceReadAttemptSettlement,
  aggregateIsEligible?: () => boolean
) {
  for (const evidence of settlement.evidence) {
    if (
      (aggregateIsEligible && !safelyCheckEligibility(aggregateIsEligible)) ||
      !settlement.eligibility.every(safelyCheckEligibility)
    ) {
      if (evidence.kind === 'fallback') recordEvidenceDecision(evidence, 'ineligible');
      break;
    }
    try {
      if (evidence.kind === 'fallback') recordEvidenceDecision(evidence, 'evidence-commit');
      await evidence.commit();
    } catch (error) {
      recordEvidenceDecision(evidence, 'failed', { reason: normalizeDiagnosticReason(error) });
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
  const settlements: ForumSourceReadAttemptSettlement[] = [];
  const aggregate: ForumSourceReadAggregateAttempt = { state: { phase: 'collecting', settlements } };
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
    aggregate.state = { phase: 'settled' };
    for (const settlement of settlements) {
      for (const evidence of settlement.evidence)
        if (evidence.kind === 'fallback')
          recordEvidenceDecision(evidence, 'aggregate-failed', { reason: normalizeDiagnosticReason(error) });
    }
    throw error;
  }
  aggregate.state = { phase: 'settled' };
  for (const settlement of settlements) {
    if (!safelyCheckEligibility(isEligible)) {
      for (const evidence of settlement.evidence)
        if (evidence.kind === 'fallback') recordEvidenceDecision(evidence, 'ineligible');
      break;
    }
    await commitForumReadEvidence(settlement, isEligible);
  }
  return result;
}

export async function runForumSourceReadAttempt<T>(
  source: Source,
  fetcher: Fetcher,
  read: (scopedFetcher: Fetcher) => Promise<T>,
  isEligible: () => boolean
): Promise<T> {
  const collection: CollectingSourceEvidence = {
    phase: 'collecting',
    eligibility: new Set([isEligible]),
    evidence: [],
    source
  };
  const attempt: ForumSourceReadAttempt = { state: collection };
  const scopedFetcher: Fetcher = (input, init) =>
    fetcher(input, {
      ...init,
      [FORUM_SOURCE_READ_ATTEMPT]: attempt
    } as ForumSourceReadRequestInit);
  let result: T;
  try {
    result = await read(scopedFetcher);
  } catch (error) {
    attempt.state = { phase: 'settled' };
    for (const evidence of collection.evidence)
      if (evidence.kind === 'fallback')
        recordEvidenceDecision(evidence, 'source-failed', { reason: normalizeDiagnosticReason(error) });
    throw error;
  }
  attempt.state = { phase: 'settled' };
  for (const evidence of collection.evidence) {
    if (evidence.kind === 'fallback' && evidence.state === 'pending') recordEvidenceDecision(evidence, 'pending');
  }
  const accepted = collection.evidence.filter(
    (evidence): evidence is AcceptedForumReadEvidence => evidence.state === 'accepted'
  );
  const acceptedFallbacks = accepted.filter((evidence) => evidence.kind === 'fallback');
  const evidenceToCommit = acceptedFallbacks.length
    ? acceptedFallbacks
    : accepted.filter((evidence) => evidence.kind === 'direct');
  const sortedEvidence = evidenceToCommit.sort((left, right) => left.ordinal - right.ordinal);
  const settlement = { eligibility: [...collection.eligibility], evidence: sortedEvidence };
  if (collection.aggregate) {
    const parent = collection.aggregate.state;
    if (parent.phase === 'collecting') {
      parent.settlements.push(settlement);
      for (const evidence of sortedEvidence)
        if (evidence.kind === 'fallback') recordEvidenceDecision(evidence, 'aggregate-pending');
    }
    return result;
  }
  await commitForumReadEvidence(settlement);
  return result;
}
