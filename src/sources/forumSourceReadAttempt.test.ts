import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginDiagnosticTrace, setDiagnosticWriter, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { forumReadEvidenceFetcher } from '../../tests/helpers/forumReadEvidence';
import {
  acceptForumReadResponse,
  registerForumReadResponseEvidence,
  rejectForumReadResponse,
  runForumSourceReadAggregateAttempt,
  runForumSourceReadAttempt,
  withForumSourceReadEligibility
} from './forumSourceReadAttempt';

describe('forum source read-attempt eligibility', () => {
  const events: DiagnosticEvent[] = [];
  beforeEach(() => {
    events.length = 0;
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
  });
  afterEach(() => setDiagnosticWriter(null));

  const decisions = () =>
    events.filter((event) => event.operation === 'recovery-decision').map((event) => event.recoveryDecision);
  async function startAggregateRead({
    aggregateIsEligible,
    gatewayIsEligible = () => true
  }: {
    aggregateIsEligible: () => boolean;
    gatewayIsEligible?: () => boolean;
  }) {
    const childFinished = Promise.withResolvers<void>();
    const finishSibling = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const trace = beginDiagnosticTrace('feed', 'load');
    const transport = withDiagnosticFetcher(trace, forumReadEvidenceFetcher(recoverReadChannel));
    const gatewayFetcher = withForumSourceReadEligibility(transport, gatewayIsEligible);
    const read = runForumSourceReadAggregateAttempt(
      gatewayFetcher,
      async (aggregateFetcher) => {
        const child = await runForumSourceReadAttempt(
          'nodeseek',
          aggregateFetcher,
          async (fetcher) => {
            const response = await fetcher('https://www.nodeseek.com/');
            acceptForumReadResponse(response);
            return 'parsed child';
          },
          () => true
        );
        childFinished.resolve();
        await finishSibling.promise;
        return { child };
      },
      aggregateIsEligible
    );
    await childFinished.promise;
    return { finishSibling, read, recoverReadChannel };
  }

  it('discards a completed child proof when the outer aggregate is aborted', async () => {
    let aggregateIsEligible = true;
    const fixture = await startAggregateRead({ aggregateIsEligible: () => aggregateIsEligible });

    aggregateIsEligible = false;
    fixture.finishSibling.resolve();

    await expect(fixture.read).resolves.toEqual({ child: 'parsed child' });
    expect(fixture.recoverReadChannel).not.toHaveBeenCalled();
    expect(decisions()).toEqual(['accepted', 'aggregate-pending', 'ineligible']);
    const transport = events.find((event) => event.phase === 'transport');
    expect(
      events
        .filter((event) => event.operation === 'recovery-decision')
        .every((event) => event.requestId === transport?.requestId && event.parentTraceId === transport?.traceId)
    ).toBe(true);
  });

  it('discards a completed child proof when the outer Gateway is superseded', async () => {
    let gatewayIsEligible = true;
    const fixture = await startAggregateRead({
      aggregateIsEligible: () => true,
      gatewayIsEligible: () => gatewayIsEligible
    });

    gatewayIsEligible = false;
    fixture.finishSibling.resolve();

    await expect(fixture.read).resolves.toEqual({ child: 'parsed child' });
    expect(fixture.recoverReadChannel).not.toHaveBeenCalled();
  });

  it('commits a proven child only after the outer aggregate succeeds', async () => {
    const fixture = await startAggregateRead({ aggregateIsEligible: () => true });

    expect(fixture.recoverReadChannel).not.toHaveBeenCalled();
    fixture.finishSibling.resolve();

    await expect(fixture.read).resolves.toEqual({ child: 'parsed child' });
    expect(fixture.recoverReadChannel).toHaveBeenCalledTimes(1);
    expect(decisions()).toEqual(['accepted', 'aggregate-pending', 'evidence-commit']);
  });

  it.each(['success', 'failure'] as const)('discards a child that finishes after aggregate %s', async (outcome) => {
    const firstCommitStarted = Promise.withResolvers<void>();
    const finishFirstCommit = Promise.withResolvers<void>();
    const lateResponseReady = Promise.withResolvers<void>();
    const finishLateParse = Promise.withResolvers<void>();
    const lateResult = Promise.withResolvers<string>();
    const lateCommit = vi.fn(async () => undefined);
    const parentError = new Error('sibling failed');
    const read = runForumSourceReadAggregateAttempt(
      forumReadEvidenceFetcher(async () => {
        firstCommitStarted.resolve();
        await finishFirstCommit.promise;
      }),
      async (firstFetcher, scopeFetcher) => {
        await runForumSourceReadAttempt(
          'nodeseek',
          firstFetcher,
          async (fetcher) => {
            acceptForumReadResponse(await fetcher('https://www.nodeseek.com/'));
          },
          () => true
        );
        lateResult.resolve(
          runForumSourceReadAttempt(
            'nodeseek',
            scopeFetcher(forumReadEvidenceFetcher(lateCommit)),
            async (fetcher) => {
              const response = await fetcher('https://www.nodeseek.com/');
              lateResponseReady.resolve();
              await finishLateParse.promise;
              acceptForumReadResponse(response);
              return 'late result';
            },
            () => true
          )
        );
        await lateResponseReady.promise;
        if (outcome === 'failure') throw parentError;
        return 'parent result';
      },
      () => true
    );

    if (outcome === 'failure') await expect(read).rejects.toBe(parentError);
    else await firstCommitStarted.promise;
    finishLateParse.resolve();
    await expect(lateResult.promise).resolves.toBe('late result');
    finishFirstCommit.resolve();
    if (outcome === 'success') await expect(read).resolves.toBe('parent result');

    expect(lateCommit).not.toHaveBeenCalled();
    expect(decisions()).toEqual([
      'accepted',
      'aggregate-pending',
      outcome === 'success' ? 'evidence-commit' : 'aggregate-failed',
      'accepted'
    ]);
  });

  it('commits only accepted fallbacks in ordinal order and continues after a recovery failure', async () => {
    const commits: number[] = [];
    const ordinals = [1, 8, 3, 2];
    const read = runForumSourceReadAttempt(
      'nodeseek',
      async (input, init) => {
        const ordinal = Number(new URL(input).pathname.slice(1));
        const response = new Response();
        registerForumReadResponseEvidence(init, response, {
          source: 'nodeseek',
          kind: ordinal === 1 ? 'direct' : 'fallback',
          ordinal,
          commit: async () => {
            commits.push(ordinal);
            if (ordinal === 3) throw new Error('storage failed');
          }
        });
        return response;
      },
      async (fetcher) => {
        for (const ordinal of ordinals) {
          const response = await fetcher(`https://www.nodeseek.com/${ordinal}`);
          if (ordinal === 2) rejectForumReadResponse(response);
          else acceptForumReadResponse(response);
        }
        return 'parsed result';
      },
      () => true
    );

    await expect(read).resolves.toBe('parsed result');
    expect(commits).toEqual([3, 8]);
    expect(decisions()).toEqual(['accepted', 'accepted', 'rejected', 'evidence-commit', 'failed', 'evidence-commit']);
  });

  it('refuses a fallback response that arrives after its source returned', async () => {
    const releaseResponse = Promise.withResolvers<void>();
    const commit = vi.fn(async () => undefined);
    const { response } = await runForumSourceReadAttempt(
      'nodeseek',
      async (_input, init) => {
        await releaseResponse.promise;
        const late = new Response();
        expect(
          registerForumReadResponseEvidence(init, late, { source: 'nodeseek', kind: 'fallback', ordinal: 1, commit })
        ).toBe(false);
        return late;
      },
      async (fetcher) => ({ response: fetcher('https://www.nodeseek.com/') }),
      () => true
    );
    releaseResponse.resolve();
    acceptForumReadResponse(await response);
    expect(commit).not.toHaveBeenCalled();
    expect(decisions()).toEqual(['ineligible']);
  });

  it('inherits the owning gateway eligibility through an aggregate child fetcher', async () => {
    let gatewayIsCurrent = true;
    const parsed = Promise.withResolvers<void>();
    const finishAuxiliaryWork = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const transport = forumReadEvidenceFetcher(recoverReadChannel);
    const aggregateFetcher = withForumSourceReadEligibility(transport, () => gatewayIsCurrent);
    const read = runForumSourceReadAttempt(
      'nodeseek',
      aggregateFetcher,
      async (fetcher) => {
        const response = await fetcher('https://www.nodeseek.com/');
        acceptForumReadResponse(response);
        parsed.resolve();
        await finishAuxiliaryWork.promise;
        return 'parsed result';
      },
      () => true
    );
    await parsed.promise;

    gatewayIsCurrent = false;
    finishAuxiliaryWork.resolve();

    await expect(read).resolves.toBe('parsed result');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'pending', 'failed'] as const)(
    'records why %s fallback evidence does not recover silently',
    async (scenario) => {
      const commit = vi.fn(async () => {
        if (scenario === 'failed') throw new Error('storage failed');
      });
      const trace = beginDiagnosticTrace('topic', 'open');
      const transport = withDiagnosticFetcher(trace, forumReadEvidenceFetcher(commit));
      await runForumSourceReadAttempt(
        'nodeseek',
        transport,
        async (fetcher) => {
          const response = await fetcher('https://www.nodeseek.com/private?token=secret');
          if (scenario === 'rejected') rejectForumReadResponse(response);
          if (scenario === 'failed') acceptForumReadResponse(response);
          return 'usable parsed result';
        },
        () => true
      );
      expect(decisions()).toEqual(scenario === 'failed' ? ['accepted', 'evidence-commit', 'failed'] : [scenario]);
      expect(commit).toHaveBeenCalledTimes(scenario === 'failed' ? 1 : 0);
      if (scenario === 'failed') expect(events.at(-1)).toMatchObject({ outcome: 'failure', reason: 'storage_error' });
      expect(JSON.stringify(events)).not.toMatch(/private|secret|token|www\.nodeseek/);
    }
  );
});
