import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionController = readFileSync('src/app/useSessionController.ts', 'utf8');
const morePanels = readFileSync('src/screens/more/MorePanels.tsx', 'utf8');

describe('account session labels', () => {
  it('uses readable session labels for yaohuo and linux.do account rows', () => {
    expect(sessionController).toContain('const yaohuoLoginState = siteSessionViewModels.yaohuo.summaryLabel;');
    expect(sessionController).not.toContain('未登录，已检测');
    expect(morePanels).toContain('value={linuxDoSession.summaryLabel}');
  });

  it('moves temporary anonymous controls into a separate development tools panel', () => {
    const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
    const appRoot = readFileSync('src/app/AppRoot.tsx', 'utf8');

    expect(appRoot).toContain('devAnonymousAvailable: __DEV__');
    expect(moreScreen).toContain('title="测试工具"');
    expect(moreScreen).toContain("meta={devAnonymousMeta}");
    expect(moreScreen).toContain('{devAnonymousAvailable ? (');
    expect(moreScreen).toContain('只影响本次运行，不删除 Cookie。重启后恢复。');
    expect(moreScreen).toContain("label=\"NodeSeek\"");
    expect(moreScreen).toContain("label=\"妖火\"");
    expect(moreScreen).toContain("label=\"linux.do\"");

    const accountPanelIndex = moreScreen.indexOf('title="账号与验证"');
    const toolsPanelIndex = moreScreen.indexOf('title="测试工具"');
    expect(accountPanelIndex).toBeGreaterThan(-1);
    expect(toolsPanelIndex).toBeGreaterThan(accountPanelIndex);
    expect(moreScreen.slice(accountPanelIndex, toolsPanelIndex)).not.toContain('临时匿名');
  });

  it('keeps account summaries human-readable instead of listing cookie names', () => {
    const siteSessionState = readFileSync('src/siteSessionState.ts', 'utf8');

    expect(siteSessionState).not.toContain('state.cookieSummary.join');
    expect(siteSessionState).toContain("return statusLabel;");
  });

  it('renders login-state limitations as auth notices instead of ordinary errors', () => {
    const searchScreen = readFileSync('src/screens/SearchScreen.tsx', 'utf8');
    const topicScreen = readFileSync('src/screens/topic/TopicScreenBody.tsx', 'utf8');
    const userScreen = readFileSync('src/screens/UserScreen.tsx', 'utf8');

    expect(searchScreen).toContain("item.type === 'groupAuthNotice'");
    expect(searchScreen).toContain('styles.authNoticeBox');
    expect(searchScreen).toContain('styles.authNoticeBoxWarning');
    expect(topicScreen).toContain('authNoticeForMessage(topicError)');
    expect(topicScreen).toContain('styles.authNoticeBox');
    expect(userScreen).toContain('authNoticeForMessage(error)');
    expect(userScreen).toContain('styles.authNoticeBox');
  });

  it('keeps ordinary detail and user read failures in the error style', () => {
    const topicScreen = readFileSync('src/screens/topic/TopicScreenBody.tsx', 'utf8');
    const userScreen = readFileSync('src/screens/UserScreen.tsx', 'utf8');

    expect(topicScreen).toContain('topicAuthNotice');
    expect(topicScreen).toContain('styles.errorBox');
    expect(userScreen).toContain('userAuthNotice');
    expect(userScreen).toContain('styles.errorBox');
  });

  it('shows the yaohuo login reason inside the login panel', () => {
    const appRoot = readFileSync('src/app/AppRoot.tsx', 'utf8');
    const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
    const morePanels = readFileSync('src/screens/more/MorePanels.tsx', 'utf8');

    expect(appRoot).toContain('setYaohuoLoginPrompt(message);');
    expect(moreScreen).toContain('yaohuoLoginPrompt={yaohuoLoginPrompt}');
    expect(morePanels).toContain('subtitle={yaohuoLoginPrompt || yaohuoLoginState}');
  });
});
