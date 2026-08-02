import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReadGateway } from '@/sources/readGateway';
import { useForumCatalogRuntime } from '@/app/useForumCatalogRuntime';
import { QueryTestWrapper } from '../QueryTestWrapper';

describe('forum catalog runtime', () => {
  it('[REG-LINUXDO-006] owns shared categories on Search and cancels them after leaving both readers', async () => {
    const signals: AbortSignal[] = [];
    const readGateway = {
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
          identityReconciliationPending: false,
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
});
