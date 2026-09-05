import { dataVisualScenarios } from './manifest';

describe('data visual scenarios', () => {
  it('keeps background semantics non-visual and the system picker device-only', () => {
    expect(Array.from(new Set(dataVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort()).toEqual([
      'DATA-01',
      'DATA-02',
      'DATA-03'
    ]);
    expect(dataVisualScenarios.find(({ id }) => id === 'data.reader.persistence')?.kind).toBe('non-visual');
    expect(dataVisualScenarios.find(({ id }) => id === 'data.reader.migration')?.kind).toBe('non-visual');
    expect(dataVisualScenarios.find(({ id }) => id === 'data.backup.system-picker')?.kind).toBe('device-only');
  });
});
