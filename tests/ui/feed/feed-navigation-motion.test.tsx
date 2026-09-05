import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '../render';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { defaultFeedFilters } from '@/domain/forum/feedOptions';

jest.mock('react-native-pager-view', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ReactModule.forwardRef(function NativePager(props: object, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ setPage: jest.fn(), setPageWithoutAnimation: jest.fn() }));
      return ReactModule.createElement(NativeView, { ...props, testID: 'native-feed-pager' });
    })
  };
});

// Execute the native animation graph in JS while keeping the real TabView/TabBar wiring.
beforeEach(() => {
  jest.useFakeTimers();
  const helper = require('react-native/src/private/animated/NativeAnimatedHelper').default;
  jest.spyOn(helper, 'shouldUseNativeDriver').mockReturnValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('Feed navigation motion', () => {
  it('moves the indicator and aligned label emphasis with native progress before committing the source', async () => {
    const onFeedSourceChange = jest.fn();
    const view = await render(
      <FeedScreen
        busy
        categories={[{ source: 'v2ex', id: 'qna', name: '问与答' }]}
        categoryFilter=""
        feedHasMore={false}
        feedItems={[]}
        feedPage={1}
        feedSource="all"
        feedFilters={defaultFeedFilters}
        enabledFeedSources={['v2ex']}
        loadMoreFailureSignal={0}
        loadingMore={false}
        topicStateIndex={createTopicListItemStateIndex(createEmptyReaderData())}
        readingFilter="all"
        refreshing={false}
        onCategoryChange={jest.fn()}
        onFeedFilterChange={jest.fn()}
        onFeedSourceChange={onFeedSourceChange}
        onManageContentSources={jest.fn()}
        onLoadMore={jest.fn()}
        onOpenTopic={jest.fn()}
        onReadingFilterChange={jest.fn()}
        onRefresh={jest.fn()}
      />
    );

    const all = view.getByRole('tab', { name: '全部，已选择' });
    const v2ex = view.getByRole('tab', { name: 'V2EX' });
    await fireEvent(all, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 50, height: 40 } } });
    await fireEvent(v2ex, 'layout', { nativeEvent: { layout: { x: 72, y: 0, width: 80, height: 40 } } });
    await act(() => jest.advanceTimersByTime(250));
    const indicatorTransform = () => {
      const indicators = view.root?.queryAll((instance) => {
        const style = StyleSheet.flatten(instance.props.style);
        return style?.position === 'absolute' && style?.height === 2 && style?.transform;
      });
      expect(indicators).toHaveLength(1);
      return StyleSheet.flatten(indicators![0].props.style).transform;
    };
    const indicatorX = () => indicatorTransform()[0].translateX;
    const indicatorWidth = () => indicatorTransform()[1].scaleX;
    const pager = view.getByTestId('native-feed-pager');
    const scroll = (offset: number) => fireEvent(pager, 'pageScroll', { nativeEvent: { position: 0, offset } });
    const [inactiveLabel, activeLabel] = view.getAllByText('V2EX');
    const { color: inactiveColor, ...inactiveTypography } = StyleSheet.flatten(inactiveLabel.props.style);
    const { color: activeColor, ...activeTypography } = StyleSheet.flatten(activeLabel.props.style);
    expect(activeTypography).toEqual(inactiveTypography);
    expect(activeColor).not.toEqual(inactiveColor);
    const activeOpacity = () => StyleSheet.flatten(view.getAllByText('V2EX')[1].parent!.props.style).opacity;

    const start = indicatorX();
    const startWidth = indicatorWidth();
    expect(activeOpacity()).toBe(0);
    await scroll(0.25);
    const quarter = indicatorX();
    expect(indicatorWidth()).toBeGreaterThan(startWidth);
    expect(activeOpacity()).toBeCloseTo(0.25);
    await scroll(0.75);
    const threeQuarters = indicatorX();
    expect(quarter).toBeGreaterThan(start);
    expect(threeQuarters).toBeGreaterThan(quarter);
    expect(activeOpacity()).toBeCloseTo(0.75);
    await scroll(0.25);
    expect(indicatorX()).toBeCloseTo(quarter);
    expect(activeOpacity()).toBeCloseTo(0.25);
    await scroll(0);
    expect(indicatorX()).toBeCloseTo(start);
    expect(indicatorWidth()).toBeCloseTo(startWidth);
    expect(activeOpacity()).toBe(0);
    await fireEvent(pager, 'pageScrollStateChanged', { nativeEvent: { pageScrollState: 'idle' } });
    await fireEvent(pager, 'pageSelected', { nativeEvent: { position: 0 } });
    expect(onFeedSourceChange).not.toHaveBeenCalled();

    const incoming = within(view.getByTestId('feed-secondary-v2ex', { includeHiddenElements: true }));
    expect(incoming.getByText('问与答', { includeHiddenElements: true })).toBeTruthy();
    expect(incoming.queryByText('未读', { includeHiddenElements: true })).toBeNull();
    await fireEvent(pager, 'pageSelected', { nativeEvent: { position: 1 } });
    expect(onFeedSourceChange).toHaveBeenCalledTimes(1);
    expect(onFeedSourceChange).toHaveBeenCalledWith('v2ex');
  });
});
