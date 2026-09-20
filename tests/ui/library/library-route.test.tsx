import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '../render';
import React from 'react';
import type { ComponentProps } from 'react';
import { LibraryRoute } from '@/features/library/LibraryRoute';
import { LibraryRouteRuntimeProvider } from '@/features/library/LibraryRouteRuntime';
import type { LibraryScreen } from '@/features/library/LibraryScreen';
import { queryReaderPage } from '@/platform/storage/readerDataStore';
import type { ReaderPage } from '@/platform/storage/readerDatabase';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { Source } from '@/domain/forum/sourceCatalog';

let mockScreen: ComponentProps<typeof LibraryScreen>;
let mockFocused = true;
const mockListFrames: { testID?: string; data: unknown[]; onEndReached?: () => void }[] = [];
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual<typeof import('react-native-gesture-handler')>('react-native-gesture-handler'),
  ScrollView: (require('react-native') as typeof import('react-native')).ScrollView
}));
jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function List(
      props: { testID?: string; data: unknown[]; onEndReached?: () => void; ListHeaderComponent?: React.ReactNode },
      ref
    ) {
      mockListFrames.push(props);
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      return ReactModule.createElement(View, { testID: props.testID }, props.ListHeaderComponent);
    })
  };
});
jest.mock('@/features/library/LibraryScreen', () => ({
  LibraryScreen: (props: typeof mockScreen) => {
    mockScreen = props;
    const Actual = jest.requireActual<typeof import('@/features/library/LibraryScreen')>(
      '@/features/library/LibraryScreen'
    ).LibraryScreen;
    return <Actual {...props} />;
  }
}));
jest.mock('@/platform/storage/readerDataStore', () => ({ queryReaderPage: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'),
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
async function mount(enabledSources: readonly Source[] = ['nodeseek']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const data = createEmptyReaderState();
  const value = {
    categories: [
      { source: 'nodeseek' as const, id: 'daily', name: '日常' },
      { source: 'v2ex' as const, id: 'daily', name: '分享创造' }
    ],
    enabledSources,
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
  mockListFrames.length = 0;
});
describe('Library route database query lifecycle', () => {
  it('queries only the active collection with filters selected through its controls', async () => {
    query.mockResolvedValue({ records: [], total: 0, visibleTotal: 0 });
    const view = await mount(['nodeseek', 'v2ex']);
    try {
      await waitFor(() => expect(view.getByTestId('library-favorites-ready')).toBeTruthy());
      await fireEvent.press(view.getByTestId('library-source-v2ex'));
      await fireEvent.press(view.getByTestId('library-category-menu-button'));
      await fireEvent.press(view.getByRole('menuitem', { name: '分享创造' }));
      await waitFor(() =>
        expect(query).toHaveBeenLastCalledWith({
          collection: 'favorites',
          sources: ['nodeseek', 'v2ex'],
          source: 'v2ex',
          category: 'v2ex:daily',
          after: undefined
        })
      );

      await fireEvent.press(view.getByTestId('library-tab-users'));
      await waitFor(() => expect(view.getByTestId('library-users-ready')).toBeTruthy());
      expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
      expect(view.queryByTestId('library-category-menu-button')).toBeNull();
      await fireEvent.press(view.getByTestId('library-source-nodeseek'));
      await waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(
          expect.objectContaining({ collection: 'followedUsers', source: 'nodeseek', category: 'all' })
        )
      );

      await fireEvent.press(view.getByTestId('library-tab-history'));
      await waitFor(() => expect(view.getByTestId('library-history-ready')).toBeTruthy());
      expect(view.getByTestId('library-source-all').props.accessibilityState.selected).toBe(true);
      expect(view.getByLabelText('分类：全部')).toBeTruthy();
      await fireEvent.press(view.getByTestId('library-source-v2ex'));
      await fireEvent.press(view.getByTestId('library-category-menu-button'));
      await fireEvent.press(view.getByRole('menuitem', { name: '分享创造' }));
      await waitFor(() =>
        expect(query).toHaveBeenLastCalledWith(
          expect.objectContaining({ collection: 'history', source: 'v2ex', category: 'v2ex:daily' })
        )
      );
      expect(query.mock.calls.map(([request]) => [request.collection, request.source, request.category])).toEqual([
        ['favorites', 'all', 'all'],
        ['favorites', 'v2ex', 'all'],
        ['favorites', 'v2ex', 'v2ex:daily'],
        ['followedUsers', 'all', 'all'],
        ['followedUsers', 'nodeseek', 'all'],
        ['history', 'all', 'all'],
        ['history', 'v2ex', 'all'],
        ['history', 'v2ex', 'v2ex:daily']
      ]);
    } finally {
      await view.unmount();
      view.client.clear();
    }
  });
  it('keeps each collection subscribed and rejects a hidden collection pagination callback', async () => {
    const cursor = { time: 123, ordinal: 50 };
    query.mockImplementation(async ({ collection }) => page(collection, cursor));
    const view = await mount();
    await waitFor(() => expect(mockScreen.favoriteRecords).toHaveLength(1));
    const favorites = mockScreen.favoriteRecords;
    const favoriteFrame = mockListFrames.filter((frame) => frame.testID === 'library-favorites-ready').at(-1);
    expect(favoriteFrame?.data.length).toBeGreaterThan(0);
    const hiddenLoad = favoriteFrame?.onEndReached;
    expect(hiddenLoad).toBeDefined();
    await act(async () => mockScreen.onTabChange('history'));
    await waitFor(() => expect(mockScreen.historyRecords).toHaveLength(1));
    expect(mockScreen.favoriteRecords).toEqual(favorites);
    expect(mockListFrames.filter((frame) => frame.testID === 'library-favorites-ready').at(-1)?.data).toEqual(
      favoriteFrame?.data
    );
    const calls = query.mock.calls.length;
    await act(async () => hiddenLoad?.());
    expect(query).toHaveBeenCalledTimes(calls);
    await view.unmount();
    view.client.clear();
  });
  it('loads only the selected collection and appends the returned cursor page', async () => {
    const cursor = { time: 123, ordinal: 50 };
    query.mockResolvedValueOnce(page('1', cursor)).mockResolvedValueOnce(page('2')).mockResolvedValue(page('3'));
    const view = await mount();
    await waitFor(() => expect(mockScreen.favoriteRecords).toHaveLength(1));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatchObject({ collection: 'favorites', after: undefined });
    await act(async () => mockScreen.onLoadMore('favorites'));
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
