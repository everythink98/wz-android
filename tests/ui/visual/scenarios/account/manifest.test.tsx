import { accountVisualScenarios } from './manifest';
import { QueryTestWrapper } from '../../../QueryTestWrapper';
import { render } from '../../../render';

describe('account visual scenarios', () => {
  it('classifies every Account capability without rendering external authentication surfaces', () => {
    expect(Array.from(new Set(accountVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort()).toEqual([
      'ACCOUNT-01',
      'ACCOUNT-02',
      'ACCOUNT-03',
      'ACCOUNT-04',
      'ACCOUNT-05'
    ]);
    expect(accountVisualScenarios.every(({ id }) => id.startsWith('account.'))).toBe(true);
    expect(accountVisualScenarios.find(({ id }) => id === 'account.webview.authentication')?.kind).toBe('device-only');
  });

  it('mounts every rendered Account scenario', async () => {
    for (const scenario of accountVisualScenarios) {
      if (scenario.kind !== 'rendered') continue;
      const view = await render(<QueryTestWrapper>{scenario.render()}</QueryTestWrapper>);
      await view.unmount();
    }
  });
});
