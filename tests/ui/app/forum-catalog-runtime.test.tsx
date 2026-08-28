import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReadGateway } from '@/sources/readGateway';
import { useForumCatalogRuntime } from '@/app/useForumCatalogRuntime';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';

const allSourcesKey = 'v2ex,linuxdo,nodeseek,yaohuo';

describe('forum catalog runtime', () => {
  it('owns shared categories on Search and cancels them after leaving both readers', async () => {
    const signals: AbortSignal[] = [];
    const readGateway = {
      getReadPlan: jest.fn(() => ({
        state: 'ready',
        lane: 'public',
        transport: 'native-no-cookie',
        cacheScope: 'public:omit',
        authenticated: false
      })),
      getCategories: jest.fn(async ({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      })
    } as unknown as ReadGateway;
    let active = true;
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active,
          enabledFeedSources: sourceValues,
          enabledSourcesKey: allSourcesKey,
          notify: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(1));
    expect(signals[0]?.aborted).toBe(false);

    active = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(signals[0]?.aborted).toBe(true));
  });

  it('replaces aggregate categories with the same enabled-source snapshot', async () => {
    const requests: { context?: { includedSources?: readonly string[] }; signal: AbortSignal }[] = [];
    const readGateway = {
      getReadPlan: jest.fn(() => ({
        state: 'ready',
        lane: 'public',
        transport: 'native-no-cookie',
        cacheScope: 'public:omit',
        authenticated: false
      })),
      getCategories: jest.fn(
        ({ signal }: { signal: AbortSignal }, context?: { includedSources?: readonly string[] }) => {
          requests.push({ context, signal });
          return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
          });
        }
      )
    } as unknown as ReadGateway;
    let enabledFeedSources: readonly Source[] = ['v2ex', 'nodeseek'];
    let enabledSourcesKey = 'v2ex,nodeseek';
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active: true,
          enabledFeedSources,
          enabledSourcesKey,
          notify: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].context?.includedSources).toEqual(['v2ex', 'nodeseek']);

    enabledFeedSources = ['v2ex'];
    enabledSourcesKey = 'v2ex';
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].context?.includedSources).toEqual(['v2ex']);
  });

  it('does not read aggregate categories for an empty source set', async () => {
    const readGateway = {
      getReadPlan: jest.fn(() => ({
        state: 'ready',
        lane: 'public',
        transport: 'native-no-cookie',
        cacheScope: 'public:omit',
        authenticated: false
      })),
      getCategories: jest.fn(async () => ({ items: [], errors: {} }))
    } as unknown as ReadGateway;
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active: true,
          enabledFeedSources: [],
          enabledSourcesKey: '',
          notify: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => Promise.resolve());

    expect(readGateway.getCategories).not.toHaveBeenCalled();
    expect(hook.result.current.categories).toEqual([]);
  });

  it('keeps aggregate categories on the same query when only source order changes', async () => {
    const readGateway = {
      getReadPlan: jest.fn(() => ({
        state: 'ready',
        lane: 'public',
        transport: 'native-no-cookie',
        cacheScope: 'public:omit',
        authenticated: false
      })),
      getCategories: jest.fn(async () => ({ items: [], errors: {} }))
    } as unknown as ReadGateway;
    let enabledFeedSources: readonly Source[] = ['v2ex', 'nodeseek'];
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active: true,
          enabledFeedSources,
          enabledSourcesKey: 'v2ex,nodeseek',
          notify: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(1));

    enabledFeedSources = ['nodeseek', 'v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(readGateway.getCategories).toHaveBeenCalledTimes(1);
  });
});
