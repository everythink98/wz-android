import { dataVisualScenarios } from './manifest';
import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { render } from '../../../render';

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

  it('mounts every rendered Data scenario', async () => {
    for (const scenario of dataVisualScenarios) {
      if (scenario.kind !== 'rendered') continue;
      const view = await render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);
      await view.unmount();
    }
  });
});
