import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');

describe('More account status UI', () => {
  it('keeps account refresh inside the account panel instead of a separate status panel', () => {
    expect(moreScreen).not.toContain('title="状态检查"');
    expect(moreScreen).toContain("label={statusBusy ? '刷新中' : '刷新账号状态'}");
  });
});
