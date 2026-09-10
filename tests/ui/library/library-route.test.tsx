import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { LibraryRoute } from '@/features/library/LibraryRoute';
import { LibraryRouteRuntimeProvider } from '@/features/library/LibraryRouteRuntime';
import type { LibraryScreen } from '@/features/library/LibraryScreen';
import { queryReaderPage } from '@/platform/storage/readerDataStore';
import type { ReaderPage } from '@/platform/storage/readerDatabase';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';

let mockScreen: ComponentProps<typeof LibraryScreen>;
let mockFocused = true;
jest.mock('@/features/library/LibraryScreen', () => ({
  LibraryScreen: (props: typeof mockScreen) => {
    mockScreen = props;
    return null;
  }
}));
jest.mock('@/platform/storage/readerDataStore', () => ({ queryReaderPage: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ dispatch: jest.fn() }),
  useScrollToTop: jest.fn(),
  StackActions: { push: jest.fn() }
}));
const query = jest.mocked(queryReaderPage);
const page = (id: string, next?: ReaderPage['next']): ReaderPage => ({
  records: [
    {
      topic: {
        source: 'nodeseek',
        id,
        title: id,
        author: 'fixture',
        createdAt: '2026-09-10T00:00:00Z',
        url: `https://www.nodeseek.com/post-${id}-1`
      },
      savedAt: '2026-09-10T00:00:00Z'
    }
  ],
  total: 2,
  visibleTotal: 2,
  next
});
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const data = createEmptyReaderState();
  const value = {
    categories: [],
    enabledSources: ['nodeseek'] as const,
    notify: jest.fn(),
    topicStateIndex: createTopicListItemStateIndex(data),
    reader: { commit: jest.fn(), data, dataRef: { current: data }, loaded: true }
  };
  const view = await render(
    <QueryClientProvider client={client}>
      <LibraryRouteRuntimeProvider value={value}>
        <LibraryRoute />
      </LibraryRouteRuntimeProvider>
    </QueryClientProvider>
  );
  return { ...view, client };
}
beforeEach(() => {
  query.mockReset();
  mockFocused = true;
});
describe('Library route database query lifecycle', () => {
  it('loads only the selected collection and appends the returned cursor page', async () => {
    const cursor = { time: 123, ordinal: 50 };
    query.mockResolvedValueOnce(page('1', cursor)).mockResolvedValueOnce(page('2')).mockResolvedValue(page('3'));
    const view = await mount();
    await waitFor(() => expect(mockScreen.favoriteRecords).toHaveLength(1));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatchObject({ collection: 'favorites', after: undefined });
    await act(async () => mockScreen.onLoadMore());
    await waitFor(() => expect(mockScreen.favoriteRecords).toHaveLength(2));
    expect(query.mock.calls[1][0].after).toEqual(cursor);
    await act(async () => mockScreen.onTabChange('history'));
    await waitFor(() => expect(mockScreen.historyRecords).toHaveLength(1));
    expect(query.mock.calls.map(([request]) => request.collection)).toEqual(['favorites', 'favorites', 'history']);
    await view.unmount();
    view.client.clear();
  });
  it('rejects late results from an old filter and only refreshes the affected active collection', async () => {
    let resolveOld!: (value: ReaderPage) => void;
    query
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue(page('current'));
    const view = await mount();
    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await act(async () => mockScreen.onCategoryFilter('nodeseek:daily'));
    await waitFor(() => expect(mockScreen.favoriteRecords[0]?.topic.id).toBe('current'));
    await act(async () => resolveOld(page('stale')));
    expect(mockScreen.favoriteRecords[0].topic.id).toBe('current');
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['reader-library', 'history'] });
    });
    expect(query).toHaveBeenCalledTimes(2);
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['reader-library', 'favorites'] });
    });
    expect(query).toHaveBeenCalledTimes(3);
    await view.unmount();
    view.client.clear();
  });
  it('does not issue database queries while the route is inactive', async () => {
    mockFocused = false;
    const view = await mount();
    expect(query).not.toHaveBeenCalled();
    await view.unmount();
    view.client.clear();
  });
});
