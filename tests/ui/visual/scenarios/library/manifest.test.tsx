import { libraryVisualScenarios } from './manifest';

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
});
