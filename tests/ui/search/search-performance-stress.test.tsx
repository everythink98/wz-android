import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
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

  it.each(['tags', 'author'] as const)(
    'coalesces 250 keystrokes on the %s page and discards edits on close',
    async (picker) => {
      jest.useFakeTimers();
      type PickerProps = { page: typeof picker | null; query: string };
      const searchDiscourseTags = jest.fn<Parameters<typeof useDiscourseFilterPickers>[0]['searchDiscourseTags']>(
        async ({ query }) => [{ name: query }]
      );
      const searchDiscourseUsers = jest.fn<Parameters<typeof useDiscourseFilterPickers>[0]['searchDiscourseUsers']>(
        async ({ term }) => [{ id: term, username: term }]
      );
      const hook = await renderHook(
        ({ page, query }: PickerProps) =>
          useDiscourseFilterPickers({
            discourseDraft: DEFAULT_SEARCH_FILTERS.linuxdo,
            picker: page,
            query,
            enabled: true,
            readPlanScopes: { tags: 'stress', users: 'stress' },
            sessionEpochs: initialForumSessionEpochs,
            searchDiscourseTags,
            searchDiscourseUsers
          }),
        { initialProps: { page: picker, query: '' } as PickerProps, wrapper: QueryTestWrapper }
      );
      for (let index = 0; index < 250; index++) {
        await hook.rerender({ page: picker, query: `term-${index}` });
        await act(async () => jest.advanceTimersByTime(10));
      }
      expect(searchDiscourseTags).not.toHaveBeenCalled();
      expect(searchDiscourseUsers).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(300));
      await act(async () => jest.advanceTimersByTime(0));
      if (picker === 'tags') {
        expect(hook.result.current.tags.options).toEqual([{ name: 'term-249' }]);
      } else {
        expect(hook.result.current.users.options).toEqual([{ id: 'term-249', username: 'term-249' }]);
      }
      await hook.rerender({ page: picker, query: 'closed-before-debounce' });
      await hook.rerender({ page: null, query: '' });
      await act(async () => jest.advanceTimersByTime(300));
      expect(searchDiscourseTags).toHaveBeenCalledTimes(picker === 'tags' ? 1 : 0);
      expect(searchDiscourseUsers).toHaveBeenCalledTimes(picker === 'author' ? 1 : 0);
    }
  );

  it('keeps a shared in-flight tag search when only one picker closes', async () => {
    const response = Promise.withResolvers<{ name: string }[]>();
    const searchDiscourseTags = jest.fn<Parameters<typeof useSearchCandidateQueries>[0]['searchDiscourseTags']>(
      () => response.promise
    );
    const tagRequest = { source: 'linuxdo' as const, query: '' };
    const reads = {
      enabled: true,
      sessionEpochs: initialForumSessionEpochs,
      readPlanScopes: { tags: 'shared', users: 'shared' },
      searchDiscourseTags,
      searchDiscourseUsers: async () => [],
      userRequest: null
    };
    const hook = await renderHook(
      ({ firstOpen }: { firstOpen: boolean }) => {
        useSearchCandidateQueries({ ...reads, tagRequest: firstOpen ? tagRequest : null });
        return useSearchCandidateQueries({ ...reads, tagRequest });
      },
      { initialProps: { firstOpen: true }, wrapper: QueryTestWrapper }
    );
    try {
      expect(searchDiscourseTags).toHaveBeenCalledTimes(1);
      const { signal } = searchDiscourseTags.mock.calls[0][0];
      await hook.rerender({ firstOpen: false });
      expect(signal?.aborted).toBe(false);
      await act(async () => response.resolve([{ name: '保留' }]));
      await waitFor(() => expect(hook.result.current.tags.options).toEqual([{ name: '保留' }]));
      expect(searchDiscourseTags).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve([]);
    }
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
          tagRequest: { source: 'linuxdo', query: `tag-${index}` },
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
