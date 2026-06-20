import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appEntrySource = readProjectFile('App.tsx');
const appRootSource = readProjectFile('src', 'app', 'AppRoot.tsx');
const appNavigatorSource = readProjectFile('src', 'app', 'AppNavigator.tsx');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const appUpdateControllerSource = readProjectFile('src', 'app', 'useAppUpdateController.ts');
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
const navBarSource = readProjectFile('src', 'components', 'NavBar.tsx');
const feedControllerSource = readProjectFile('src', 'app', 'useFeedController.ts');
const appControlsSource = readProjectFile('src', 'components', 'AppControls.tsx');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const searchControllerSource = readProjectFile('src', 'app', 'useSearchController.ts');
const topicActionsControllerSource = readProjectFile('src', 'app', 'useTopicActionsController.ts');
const topicControllerSource = readProjectFile('src', 'app', 'useTopicController.ts');
const topicCardSource = readProjectFile('src', 'components', 'TopicCard.tsx');
const readerDataControllerSource = readProjectFile('src', 'app', 'useReaderDataController.ts');
const userControllerSource = readProjectFile('src', 'app', 'useUserController.ts');
const mainTabScrollToTopSource = readProjectFile('src', 'app', 'useMainTabScrollToTop.ts');
const operatorRunbookSource = readProjectFile('docs', 'operator-runbook.md');

const appReadControllerSources = [
  accountControllerSource,
  backupStatusControllerSource,
  feedControllerSource,
  searchControllerSource,
  topicControllerSource,
  userControllerSource
];

const appActionAndAccountRequestSources = [
  accountControllerSource,
  backupStatusControllerSource,
  topicActionsControllerSource
];

describe('Android architecture boundaries', () => {
  it('keeps App.tsx as a thin entry file', () => {
    expect(appEntrySource).toContain("import 'react-native-gesture-handler';");
    expect(appEntrySource).toContain("import 'expo-dev-client';");
    expect(appEntrySource).toContain("import { AppRoot } from './src/app/AppRoot';");
    expect(appEntrySource).toContain('export default AppRoot;');
  });

  it('keeps app read flows behind the source gateway', () => {
    for (const source of appReadControllerSources) {
      expect(source).toContain("from '../sources/sourceGateway'");
      expect(source).not.toContain("from '../forumApi'");
      expect(source).not.toContain("from '../yaohuoApi'");
    }
  });

  it('keeps app action and account requests behind the source gateway', () => {
    for (const source of appActionAndAccountRequestSources) {
      expect(source).toContain("from '../sources/sourceGateway'");
      expect(source).not.toContain("from '../nodeseekActionClient'");
      expect(source).not.toContain("from '../linuxdoActionClient'");
      expect(source).not.toContain("from '../yaohuoActionClient'");
      expect(source).not.toContain("from '../linuxdoLevel'");
    }
  });

  it('does not pass raw cookie headers through More screen props', () => {
    expect(moreScreenSource).not.toContain('yaohuoLoginCookieHeader');
    expect(moreScreenSource).not.toContain('linuxDoWebViewCookieHeader');
    expect(morePanelsSource).not.toContain('yaohuoLoginCookieHeader');
    expect(morePanelsSource).not.toContain('headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined');
  });

  it('does not keep a hand-maintained TopicCard field whitelist', () => {
    expect(topicCardSource).toContain('export const MemoizedTopicCard = memo(TopicCard);');
    expect(topicCardSource).not.toContain('stringArrayValuesEqual');
  });

  it('keeps reader data save failures visible to callers', () => {
    expect(readerDataControllerSource).toContain('notify(errorMessage(error));\n        throw error;');
    expect(readerDataControllerSource).not.toContain('waitForReaderDataSave = useCallback(() => (\n    saveQueueRef.current.catch(() => undefined)\n  )');
  });

  it('does not update an unused more tab scroll signal', () => {
    expect(mainTabScrollToTopSource).toContain("if (target === 'more')");
    expect(mainTabScrollToTopSource).toContain('return;');
    expect(mainTabScrollToTopSource).not.toContain('more: 0');
  });

  it('disables app update checks while a check is already running', () => {
    expect(appControlsSource).toContain('disabled = false');
    expect(appControlsSource).toContain('disabled={disabled}');
    expect(moreScreenSource).toContain('disabled={appUpdateBusy}');
  });

  it('auto-checks app updates silently and badges the more tab when a new version exists', () => {
    expect(appUpdateControllerSource).toContain('silent?: boolean');
    expect(appUpdateControllerSource).toContain('if (!silent)');
    expect(appRootSource).toContain('autoAppUpdateCheckedRef');
    expect(appRootSource).toContain('checkAppUpdate({ silent: true })');
    expect(appRootSource).toContain('moreHasBadge={Boolean(appUpdateInfo)}');
    expect(appNavigatorSource).toContain('moreHasBadge');
    expect(navBarSource).toContain('showBadge');
    expect(navBarSource).toContain('navBadge');
  });

  it('does not keep React Query when feed categories already bypass caching', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'));

    expect(packageJson.dependencies).not.toHaveProperty('@tanstack/react-query');
    expect(appRootSource).not.toContain('@tanstack/react-query');
    expect(feedControllerSource).not.toContain('@tanstack/react-query');
    expect(feedControllerSource).not.toContain('queryClient');
  });

  it('keeps backup and status ownership to one busy flag each', () => {
    expect(backupStatusControllerSource).not.toContain('../requestOwnership');
    expect(backupStatusControllerSource).not.toContain('RequestOwner');
    expect(backupStatusControllerSource).not.toContain('backupRequestIdRef');
    expect(backupStatusControllerSource).not.toContain('statusRequestIdRef');
  });

  it('keeps large backup JSON out of editable UI state', () => {
    expect(morePanelsSource).not.toContain('TextInput');
    expect(morePanelsSource).not.toContain('backupJson');
    expect(backupStatusControllerSource).not.toContain('setBackupJson');
  });

  it('does not use error display text as verification control flow', () => {
    expect(feedControllerSource).not.toContain('/Cloudflare|验证/');
    expect(searchControllerSource).not.toContain('/Cloudflare|验证/');
  });

  it('keeps operator runbook verification files in sync with this repo', () => {
    expect(operatorRunbookSource).not.toContain('androidArchitectureBoundaries.test.ts');
    expect(operatorRunbookSource).not.toContain('androidMatureComponents.test.ts');
    expect(operatorRunbookSource).not.toContain('androidUxUpgrade.test.ts');
    expect(operatorRunbookSource).not.toContain('appPerformance.test.ts');
    expect(operatorRunbookSource).not.toContain('appExperience.test.ts');
    expect(operatorRunbookSource).not.toContain('detailReadingLayout.test.ts');
  });
});
