import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');

describe('More account status UI', () => {
  it('combines about and update into one app info section', () => {
    expect(moreScreen).toContain('关于阅坛');
    expect(moreScreen).not.toContain('<InfoRow icon={Activity} label="关于"');
    expect(moreScreen).not.toContain('<MenuButton icon={Download} label="检查更新"');
    expect(moreScreen).toContain("<AppButton tiny label={appUpdateBusy ? '检查中' : '检查更新'}");
  });

  it('makes the update badge source clear inside the about section', () => {
    expect(moreScreen).toContain('有新版本');
    expect(moreScreen).toContain('当前版本 ${CURRENT_APP_VERSION} · 最新版本 ${appUpdateInfo.version}');
    expect(moreScreen).toContain('appUpdateMessage === `发现新版 ${appUpdateInfo.version}`');
    expect(moreScreen).toContain("variant=\"primary\"");
  });

  it('keeps account refresh inside the account panel instead of a separate status panel', () => {
    expect(moreScreen).not.toContain('title="状态检查"');
    expect(moreScreen).toContain("label={statusBusy ? '刷新中' : '刷新账号状态'}");
  });
});
