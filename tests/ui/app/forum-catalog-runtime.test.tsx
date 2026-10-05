import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReadGateway } from '@/sources/readGateway';
import { useForumCatalogRuntime } from '@/app/useForumCatalogRuntime';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';

describe('forum catalog runtime', () => {
  it('keeps post metadata ready while deferring unrelated catalogs until the first Feed is visible', async () => {
    const getCategories = jest.fn(async ({ source }: { source: Source }) => ({
      items: [{ source, id: 'general', name: `${source} category` }],
      errors: {}
    }));
    const readGateway = {
      getReadPlan: (source: Source) => ({
        state: 'ready',
        lane: source === 'yaohuo' ? 'local' : 'public',
        transport: source === 'yaohuo' ? 'none' : 'native-no-cookie',
        cacheScope: 'public:omit'
      }),
      getCategories
    } as unknown as ReadGateway;
    let deferSecondary = true;
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active: true,
          deferSecondary,
          enabledFeedSources: sourceValues,
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.categories).toHaveLength(2));
    expect(getCategories.mock.calls.map(([request]) => request.source).sort()).toEqual(['linuxdo', 'yaohuo']);
    expect(hook.result.current.settled).toBe(false);
    deferSecondary = false;
    await act(async () => hook.rerender({}));
    await waitFor(() => expect(hook.result.current.categories).toHaveLength(4));
    expect(getCategories).toHaveBeenCalledTimes(4);
    expect(hook.result.current.settled).toBe(true);
  });

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
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(signals).toHaveLength(4));
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    active = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
  });

  it('cancels only disabled sources while retaining the other catalog requests', async () => {
    const requests: { source: Source; signal: AbortSignal }[] = [];
    const readGateway = {
      getReadPlan: jest.fn(() => ({
        state: 'ready',
        lane: 'public',
        transport: 'native-no-cookie',
        cacheScope: 'public:omit',
        authenticated: false
      })),
      getCategories: jest.fn(({ source, signal }: { source: Source; signal: AbortSignal }) => {
        requests.push({ source, signal });
        return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      })
    } as unknown as ReadGateway;
    let enabledFeedSources: readonly Source[] = ['v2ex', 'nodeseek'];
    const hook = await renderHook(
      () =>
        useForumCatalogRuntime({
          active: true,
          enabledFeedSources,
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(({ source }) => source).sort()).toEqual(['nodeseek', 'v2ex']);

    enabledFeedSources = ['v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(requests.find(({ source }) => source === 'nodeseek')?.signal.aborted).toBe(true));
    expect(requests.find(({ source }) => source === 'v2ex')?.signal.aborted).toBe(false);
    expect(requests).toHaveLength(2);
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
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => Promise.resolve());

    expect(readGateway.getCategories).not.toHaveBeenCalled();
    expect(hook.result.current.categories).toEqual([]);
  });

  it('reuses catalogs when only source order changes', async () => {
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
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(2));

    enabledFeedSources = ['nodeseek', 'v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(readGateway.getCategories).toHaveBeenCalledTimes(2);
  });
});
