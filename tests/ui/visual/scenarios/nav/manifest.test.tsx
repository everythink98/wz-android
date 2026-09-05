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
});
