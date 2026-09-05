import { moreVisualScenarios } from './manifest';

describe('more visual scenarios', () => {
  it('classifies every More capability and keeps system UI out of rendered scenes', () => {
    expect(Array.from(new Set(moreVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort()).toEqual([
      'MORE-01',
      'MORE-02',
      'MORE-03',
      'MORE-04',
      'MORE-05'
    ]);
    expect(moreVisualScenarios.every(({ id }) => id.startsWith('more.'))).toBe(true);
    expect(moreVisualScenarios.find(({ id }) => id === 'more.update.system-installer')?.kind).toBe('device-only');
    expect(moreVisualScenarios.find(({ id }) => id === 'more.sources.talkback-drag')?.kind).toBe('device-only');
  });
});
