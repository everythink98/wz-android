import { describe, expect, it, vi } from 'vitest';
import { forumReadEvidenceFetcher } from '../../tests/helpers/forumReadEvidence';
import {
  acceptForumReadResponse,
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
    const transport = forumReadEvidenceFetcher(recoverReadChannel);
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
});
