import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';
import {
  acceptForumReadResponse,
  registerForumReadResponseEvidence,
  runForumSourceReadAggregateAttempt,
  runForumSourceReadAttempt,
  withForumSourceReadEligibility
} from './forumSourceReadAttempt';

describe('forum source read-attempt eligibility', () => {
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
    const transport: Fetcher = async (_input, init) => {
      const response = new Response('{}');
      registerForumReadResponseEvidence(init, response, {
        commit: recoverReadChannel,
        kind: 'fallback',
        ordinal: 1,
        source: 'nodeseek'
      });
      return response;
    };
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

  it('[REG-SOURCE-009] discards a completed child proof when the outer aggregate is aborted', async () => {
    let aggregateIsEligible = true;
    const fixture = await startAggregateRead({ aggregateIsEligible: () => aggregateIsEligible });

    aggregateIsEligible = false;
    fixture.finishSibling.resolve();

    await expect(fixture.read).resolves.toEqual({ child: 'parsed child' });
    expect(fixture.recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] discards a completed child proof when the outer Gateway is superseded', async () => {
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

  it('[REG-SOURCE-009] commits a proven child only after the outer aggregate succeeds', async () => {
    const fixture = await startAggregateRead({ aggregateIsEligible: () => true });

    expect(fixture.recoverReadChannel).not.toHaveBeenCalled();
    fixture.finishSibling.resolve();

    await expect(fixture.read).resolves.toEqual({ child: 'parsed child' });
    expect(fixture.recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-009] inherits the owning gateway eligibility through an aggregate child fetcher', async () => {
    let gatewayIsCurrent = true;
    const parsed = Promise.withResolvers<void>();
    const finishAuxiliaryWork = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const transport: Fetcher = async (_input, init) => {
      const response = new Response('{}');
      registerForumReadResponseEvidence(init, response, {
        commit: recoverReadChannel,
        kind: 'fallback',
        ordinal: 1,
        source: 'nodeseek'
      });
      return response;
    };
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
});
