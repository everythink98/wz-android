import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { DEFAULT_SEARCH_FILTERS } from '@/domain/forum/searchFilters';
import { useDiscourseFilterPickers, useSearchCandidateQueries } from '@/features/search/DiscourseFilterPickers';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { QueryTestWrapper } from '../QueryTestWrapper';

// Request/state stress only: no native list geometry, keyboard latency or device FPS claim.
describe('search candidate pressure through production hooks', () => {
  afterEach(async () => {
    await cleanup();
    jest.useRealTimers();
  });

  it('coalesces 250 separately rendered typing events into one request per open picker', async () => {
    jest.useFakeTimers();
    const searchDiscourseTags = jest.fn<Parameters<typeof useDiscourseFilterPickers>[0]['searchDiscourseTags']>(
      async ({ query }) => [{ name: query }]
    );
    const searchDiscourseUsers = jest.fn<Parameters<typeof useDiscourseFilterPickers>[0]['searchDiscourseUsers']>(
      async ({ term }) => [{ id: term, username: term }]
    );
    const hook = await renderHook(
      () =>
        useDiscourseFilterPickers({
          categories: [],
          discourseDraft: DEFAULT_SEARCH_FILTERS.linuxdo,
          filterSheetVisible: true,
          requestsEnabled: true,
          readPlanScopes: { tags: 'stress', users: 'stress' },
          sessionEpochs: initialForumSessionEpochs,
          searchDiscourseTags,
          searchDiscourseUsers
        }),
      { wrapper: QueryTestWrapper }
    );
    await act(async () => {
      hook.result.current.tags.open();
      hook.result.current.users.open();
    });
    for (let index = 0; index < 250; index++) {
      await act(async () => {
        hook.result.current.tags.setQuery(`tag-${index}`);
        hook.result.current.users.setQuery(`user-${index}`);
      });
      await act(async () => jest.advanceTimersByTime(10));
    }
    expect(searchDiscourseTags).not.toHaveBeenCalled();
    expect(searchDiscourseUsers).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(300));
    await act(async () => jest.advanceTimersByTime(0));
    expect(searchDiscourseTags).toHaveBeenCalledTimes(1);
    expect(searchDiscourseUsers).toHaveBeenCalledTimes(1);
    expect(hook.result.current.tags.options).toEqual([{ name: 'tag-249' }]);
    expect(hook.result.current.users.options).toEqual([{ id: 'user-249', username: 'user-249' }]);

    await act(async () => {
      hook.result.current.tags.setQuery('closed-before-debounce');
      hook.result.current.users.setQuery('closed-before-debounce');
    });
    await act(async () => {
      hook.result.current.tags.close();
      hook.result.current.users.close();
    });
    await act(async () => jest.advanceTimersByTime(300));
    expect(searchDiscourseTags).toHaveBeenCalledTimes(1);
    expect(searchDiscourseUsers).toHaveBeenCalledTimes(1);
  });

  it('cancels superseded requests over 100 query changes and releases the last pair on unmount', async () => {
    type CandidateOptions = Parameters<typeof useSearchCandidateQueries>[0];
    const requests: { signal: AbortSignal; settled: Promise<unknown> }[] = [];
    let active = 0;
    let peak = 0;
    function pending<T>(signal: AbortSignal | undefined, result: T): Promise<T> {
      if (!signal) throw new Error('Candidate requests must own an abort signal');
      active++;
      peak = Math.max(peak, active);
      const settled = new Promise<T>((resolve) => {
        const complete = () => {
          active--;
          resolve(result);
        };
        if (signal.aborted) complete();
        else signal.addEventListener('abort', complete, { once: true });
      });
      requests.push({ signal, settled });
      return settled;
    }
    const searchDiscourseTags = jest.fn<CandidateOptions['searchDiscourseTags']>(({ query, signal }) =>
      pending(signal, [{ name: query }])
    );
    const searchDiscourseUsers = jest.fn<CandidateOptions['searchDiscourseUsers']>(({ term, signal }) =>
      pending(signal, [{ id: term, username: term }])
    );
    const hook = await renderHook(
      ({ index }: { index: number }) =>
        useSearchCandidateQueries({
          enabled: true,
          sessionEpochs: initialForumSessionEpochs,
          readPlanScopes: { tags: 'stress', users: 'stress' },
          tagRequest: { source: 'linuxdo', query: `tag-${index}`, selectedTags: [] },
          userRequest: { source: 'linuxdo', term: `user-${index}` },
          searchDiscourseTags,
          searchDiscourseUsers
        }),
      { initialProps: { index: 0 }, wrapper: QueryTestWrapper }
    );
    for (let index = 1; index < 100; index++) {
      await hook.rerender({ index });
      expect(active).toBe(2);
      expect(hook.result.current.tags.options).toEqual([]);
      expect(hook.result.current.users.options).toEqual([]);
    }
    expect(searchDiscourseTags).toHaveBeenCalledTimes(100);
    expect(searchDiscourseUsers).toHaveBeenCalledTimes(100);
    expect(requests.slice(0, -2).every(({ signal }) => signal.aborted)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    await hook.unmount();
    await Promise.all(requests.map(({ settled }) => settled));
    expect(active).toBe(0);
    expect(requests.every(({ signal }) => signal.aborted)).toBe(true);
  });
});
