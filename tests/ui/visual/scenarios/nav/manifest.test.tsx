import type { ForwardedRef, ReactNode } from 'react';

jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  const optional = (value: unknown): ReactNode =>
    typeof value === 'function' ? React.createElement(value as React.ComponentType) : (value as ReactNode);
  return {
    FlashList: React.forwardRef(function MockFlashList(
      {
        ListEmptyComponent,
        ListFooterComponent,
        ListHeaderComponent,
        data = [],
        keyExtractor,
        onLoad,
        renderItem,
        ...props
      }: Record<string, any>,
      ref: ForwardedRef<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: jest.fn(), scrollToOffset: jest.fn() }));
      React.useEffect(() => onLoad?.(), [onLoad]);
      return React.createElement(
        View,
        props,
        optional(ListHeaderComponent),
        data.map((item: unknown, index: number) =>
          React.createElement(
            View,
            { key: keyExtractor?.(item, index) || String(index) },
            renderItem?.({ index, item, target: 'Cell' })
          )
        ),
        data.length ? null : optional(ListEmptyComponent),
        optional(ListFooterComponent)
      );
    }),
    useMappingHelper: () => ({ getMappingKey: (value: string, index?: number) => `${value}:${index ?? 0}` }),
    useRecyclingState: (initialValue: unknown) => React.useState(initialValue)
  };
});

jest.mock('react-native-tab-view', () => {
  const React = require('react') as typeof import('react');
  return {
    TabView: ({ navigationState, renderScene }: Record<string, any>) =>
      React.createElement(React.Fragment, null, renderScene({ route: navigationState.routes[navigationState.index] }))
  };
});

import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { render } from '../../../render';
import type { VisualScenarioDefinition } from '../../types';
import { feedVisualScenarios } from '../feed/manifest';
import { notificationVisualScenarios } from '../notifications/manifest';
import { searchVisualScenarios } from '../search/manifest';
import { userVisualScenarios } from '../user/manifest';
import { navVisualScenarios } from './manifest';

const scenarios: readonly VisualScenarioDefinition[] = [
  ...navVisualScenarios,
  ...feedVisualScenarios,
  ...searchVisualScenarios,
  ...userVisualScenarios,
  ...notificationVisualScenarios
];

describe('content surface visual scenarios', () => {
  it('classifies every assigned capability with unique ids', () => {
    const expected = [
      'FEED-01',
      'FEED-02',
      'FEED-03',
      'FEED-04',
      'NAV-01',
      'NAV-02',
      'NAV-03',
      'NOTIFY-01',
      'NOTIFY-02',
      'NOTIFY-03',
      'SEARCH-01',
      'SEARCH-02',
      'SEARCH-03',
      'SEARCH-04',
      'USER-01',
      'USER-02'
    ];
    const actual = Array.from(new Set(scenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort();
    const ids = scenarios.map(({ id }) => id);

    expect(actual).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mounts every rendered production surface without external runtime providers', async () => {
    for (const scenario of scenarios) {
      if (scenario.kind !== 'rendered') continue;
      const view = await render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);
      await view.unmount();
    }
  });
});
