import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionController = readFileSync('src/app/useSessionController.ts', 'utf8');
const morePanels = readFileSync('src/screens/more/MorePanels.tsx', 'utf8');

describe('account session labels', () => {
  it('uses canonical session labels for yaohuo and linux.do account rows', () => {
    expect(sessionController).toContain('const yaohuoLoginState = siteSessionViewModels.yaohuo.summaryLabel;');
    expect(sessionController).not.toContain('未登录，已检测');
    expect(morePanels).toContain('value={linuxDoSession.summaryLabel}');
  });
});
