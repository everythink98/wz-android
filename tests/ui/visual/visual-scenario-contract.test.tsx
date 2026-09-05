import type { ForwardedRef } from 'react';
import { render } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: React.forwardRef(function MockFlashList(
      { data = [], keyExtractor, renderItem, ListHeaderComponent, ListFooterComponent, ...props }: Record<string, any>,
      ref: ForwardedRef<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: jest.fn(), scrollToOffset: jest.fn() }));
      return React.createElement(
        View,
        props,
        typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent,
        data.map((item: unknown, index: number) =>
          React.createElement(
            View,
            { key: keyExtractor?.(item, index) || String(index) },
            renderItem?.({ index, item, target: 'Cell' })
          )
        ),
        typeof ListFooterComponent === 'function' ? React.createElement(ListFooterComponent) : ListFooterComponent
      );
    }),
    useMappingHelper: () => ({ getMappingKey: (value: string) => value }),
    useRecyclingState: (initialValue: unknown) => React.useState(initialValue)
  };
});

jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

jest.mock('@/features/topic/components/ReplyComposerSheet', () => ({ ReplyComposerSheet: () => null }));

import { visualScenarioCatalog, VisualScenarioView } from './catalog';

describe('visual scenario catalog', () => {
  it('classifies all 42 App capabilities', () => {
    expect(new Set(visualScenarioCatalog.flatMap((scenario) => scenario.capabilityIds)).size).toBe(42);
  });

  it('uses unique stable scenario and capability ids', () => {
    const ids = visualScenarioCatalog.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of visualScenarioCatalog) {
      expect(scenario.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      expect(scenario.capabilityIds.length).toBeGreaterThan(0);
      expect(scenario.capabilityIds.every((id) => /^[A-Z]+-\d{2}$/.test(id))).toBe(true);
    }
  });

  it('renders every rendered scenario in both themes', async () => {
    for (const scenario of visualScenarioCatalog.filter(({ kind }) => kind === 'rendered')) {
      for (const theme of ['light', 'dark'] as const) {
        const view = await render(
          <GestureHandlerRootView>
            <VisualScenarioView appearance={{ theme }} id={scenario.id} />
          </GestureHandlerRootView>
        );
        await view.unmount();
      }
    }
  });
});
