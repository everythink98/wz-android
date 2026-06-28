import { describe, expect, it, vi } from 'vitest';

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccess: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  parseLinuxDoDocumentCookie: vi.fn(() => ({})),
  summarizeLinuxDoCookies: vi.fn(() => ({ names: [] }))
}));

import { clearLinuxDoAccessForGeneration } from '../linuxdoCookieBridge';
import { clearExpiredLinuxDoLogin } from './topicActionHelpers';

describe('topic action auth guards', () => {
  it('marks linux.do expired only when an expired request clears stored access', async () => {
    vi.mocked(clearLinuxDoAccessForGeneration).mockResolvedValueOnce(null);
    const resetLinuxDoLevelState = vi.fn();
    const updateLinuxDoSession = vi.fn();

    await clearExpiredLinuxDoLogin({
      error: new Error('linux.do 登录已失效，请重新登录。'),
      generation: 3,
      cookieHeader: 'cf_clearance=old; _t=old',
      resetLinuxDoLevelState,
      updateLinuxDoSession
    });

    expect(clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(3, 'cf_clearance=old; _t=old');
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: 'linux.do 登录已失效，请重新登录。'
    });
    expect(resetLinuxDoLevelState).toHaveBeenCalledTimes(1);
  });
});
