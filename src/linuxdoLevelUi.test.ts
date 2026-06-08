import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readProjectFile } from './sourceTestUtils';

const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const moreUiSource = [moreScreenSource, morePanelsSource].join('\n');
const appSource = readAppRuntimeSource();
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');

describe('linux.do level UI guards', () => {
  it('adds linux.do level inside account verification with progress and activity tabs', () => {
    expect(moreScreenSource).toContain('title="账号与验证"');
    expect(moreScreenSource).toContain('label="linux.do 等级"');
    expect(moreScreenSource).not.toContain('title="linux.do 等级"');
    expect(morePanelsSource).toContain("label: '等级进度'");
    expect(morePanelsSource).toContain("label: '活跃数据'");
    expect(moreUiSource).toContain('LinuxDoLevelPanel');
    expect(accountControllerSource).toContain('getLinuxDoLevelProfile');
  });

  it('does not add a linux.do check-in button', () => {
    expect(moreScreenSource).not.toContain('linux.do 签到');
    expect(moreScreenSource).not.toContain('L站签到');
  });

  it('clears cached level data when linux.do account state changes', () => {
    expect(appSource).toContain('const resetLinuxDoLevelState = useCallback');
    expect(appSource).toContain('linuxDoLevelRequestIdRef.current += 1');
    expect(appSource).toContain('setLinuxDoLevelProfile(null)');
    expect(accountControllerSource).toContain('resetLinuxDoLevelState();');
  });
});
