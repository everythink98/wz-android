import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginDiagnosticTrace, setDiagnosticWriter, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { forumReadEvidenceFetcher } from '../../tests/helpers/forumReadEvidence';
import {
  acceptForumReadResponse,
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
