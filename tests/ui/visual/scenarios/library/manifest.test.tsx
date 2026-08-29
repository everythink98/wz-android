jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  return {
    FlashList: () => null,
    useMappingHelper: () => ({ getMappingKey: (value: string) => value }),
    useRecyclingState: (initialValue: unknown) => React.useState(initialValue)
  };
});

import { libraryVisualScenarios } from './manifest';
import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { render } from '../../../render';

describe('library visual scenarios', () => {
  it('classifies every Library capability with stable ids', () => {
    expect(Array.from(new Set(libraryVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort()).toEqual([
      'LIBRARY-01',
      'LIBRARY-02',
      'LIBRARY-03'
    ]);
    expect(libraryVisualScenarios.every(({ id }) => id.startsWith('library.'))).toBe(true);
    expect(libraryVisualScenarios.every(({ kind }) => kind === 'rendered')).toBe(true);
  });

  it('mounts every rendered Library scenario', async () => {
    for (const scenario of libraryVisualScenarios) {
      if (scenario.kind !== 'rendered') continue;
      const view = await render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);
      await view.unmount();
    }
  });
});
