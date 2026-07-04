import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPersonalCenterItems } from './personalCenterItems';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../siteSessionState';

describe('personal center items', () => {
  it('shows only logged-in forum accounts that can have a personal homepage', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: '48872',
          username: '我是ikun',
          url: 'https://www.nodeseek.com/space/48872',
          topics: []
        }
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['_t'],
        isVerifying: false
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'anonymous',
        cookieSummary: [],
        isVerifying: false
      }
    }));

    const items = createPersonalCenterItems(sessions);

    expect(items.map((item) => item.source)).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
    expect(items[0]).toMatchObject({
      label: 'NodeSeek',
      value: '我是ikun',
      canOpen: true
    });
    expect(items[1]).toMatchObject({
      label: 'linux.do',
      value: '身份未识别',
      canOpen: false
    });
    expect(items[2]).toMatchObject({
      label: '妖火',
      value: '未登录',
      canOpen: false
    });
  });

  it('keeps manual account refresh inside personal center without More-screen auto refresh', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/screens/MoreScreen.tsx'), 'utf8');
    const personalCenterIndex = source.indexOf('title="个人中心"');
    const refreshIndex = source.indexOf('刷新账号状态');
    const accountIndex = source.indexOf('title="账号与验证"');

    expect(personalCenterIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(personalCenterIndex);
    expect(refreshIndex).toBeLessThan(accountIndex);
    expect(source).not.toContain('needsPersonalCenterIdentityRefresh');
  });
});
