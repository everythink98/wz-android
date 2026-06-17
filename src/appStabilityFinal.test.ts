import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readProjectFile } from './sourceTestUtils';

const appSource = readAppRuntimeSource();
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const topicActionsControllerSource = readProjectFile('src', 'app', 'useTopicActionsController.ts');
const topicControllerSource = readProjectFile('src', 'app', 'useTopicController.ts');
const topicNavigationControllerSource = readProjectFile('src', 'app', 'useTopicNavigationController.ts');

describe('Android App final stability guards', () => {
  it('keeps account detection and clearing out of the app shell', () => {
    expect(appSource).toContain('useAccountController');
    expect(accountControllerSource).toContain('export function useAccountController');

    for (const name of [
      'handleLoginMessage',
      'readCurrentNodeSeekCookies',
      'rememberCurrentNodeSeekCookies',
      'checkLogin',
      'checkYaohuoCookie',
      'clearLogin',
      'clearYaohuoLogin',
      'clearLinuxDoCookie',
      'refreshLinuxDoLevel'
    ]) {
      expect(appSource).not.toMatch(new RegExp(`const\\s+${name}\\s*=\\s*useCallback`));
    }
  });

  it('updates visible account state only through site session events', () => {
    expect(accountControllerSource).toContain('updateNodeSeekSession');
    expect(accountControllerSource).toContain('updateYaohuoSession');
    expect(accountControllerSource).toContain('updateLinuxDoSession');
    expect(accountControllerSource).toContain("type: 'login-detected'");
    expect(accountControllerSource).toContain("type: 'verification-succeeded'");
    expect(accountControllerSource).toContain("type: 'login-expired'");
    expect(accountControllerSource).toContain("type: 'cleared'");

    expect(accountControllerSource).not.toContain('setHasNodeSeekLoginCookie');
    expect(accountControllerSource).not.toContain('setHasYaohuoCookie');
    expect(accountControllerSource).not.toContain('setHasLinuxDoClearance');
    expect(accountControllerSource).not.toContain('setHasLinuxDoLogin');
  });

  it('keeps topic write operations out of the app shell and under request ownership', () => {
    expect(appSource).toContain('useTopicActionsController');
    expect(topicActionsControllerSource).toContain('export function useTopicActionsController');

    for (const name of [
      'startTopicActionRequest',
      'isCurrentTopicActionRequest',
      'runNodeSeekRequest',
      'runYaohuoRequest',
      'runLinuxDoRequest',
      'runNodeSeekActionForOptimisticUpdate',
      'runLinuxDoActionForOptimisticUpdate',
      'startOptimisticTopicAction',
      'submitReply',
      'checkIn',
      'interact',
      'favoriteOnYaohuoSite',
      'collectOnNodeSeekSite',
      'bookmarkOnLinuxDoSite',
      'votePoll'
    ]) {
      expect(appSource).not.toMatch(new RegExp(`const\\s+${name}\\s*=\\s*useCallback`));
    }

    expect(topicActionsControllerSource).toContain('startOwnedRequest');
    expect(topicActionsControllerSource).toContain('isCurrentOwnedRequest');
    expect(topicActionsControllerSource).toContain('isCurrentTopicActionRequest(requestOwner)');
    expect(topicActionsControllerSource).toContain('setTopicDetail((current)');
    expect(topicActionsControllerSource).toContain('setTopicReplies((current)');
  });

  it('derives write capability from SiteSessionState instead of legacy login booleans', () => {
    expect(topicActionsControllerSource).toContain('isSiteLoggedIn(siteSessionStates.nodeseek)');
    expect(topicActionsControllerSource).toContain('isSiteLoggedIn(siteSessionStates.yaohuo)');
    expect(topicActionsControllerSource).toContain('isSiteLoggedIn(siteSessionStates.linuxdo)');
    expect(topicActionsControllerSource).not.toContain('hasNodeSeekLoginCookie');
    expect(topicActionsControllerSource).not.toContain('hasYaohuoCookie');
    expect(topicActionsControllerSource).not.toContain('hasLinuxDoClearance');
    expect(topicActionsControllerSource).not.toContain('hasLinuxDoLogin');
  });

  it('invalidates in-flight topic writes when the active topic context changes', () => {
    expect(topicActionsControllerSource).toContain('export function invalidateTopicActionRequestOwner');
    expect(appSource).toContain('const invalidateTopicActionRequests = useCallback');
    expect(appSource).toContain('invalidateTopicActionRequestOwner(topicActionRequestOwnerRef, nextTopicKey)');
    expect(appSource).toContain('invalidateTopicActionRequests(null);');
    expect(topicNavigationControllerSource).toContain('invalidateTopicActionRequests(restoredTopic ? topicKey(restoredTopic) : null);');
    expect(appSource).toContain('onTopicContextChange: invalidateTopicActionRequests');
    expect(topicControllerSource).toContain('onTopicContextChange: (topicKey: string | null) => void;');
    expect(topicControllerSource).toContain('onTopicContextChange(nextTopicKey);');
  });
});
