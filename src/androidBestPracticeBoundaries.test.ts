import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appEntrySource = readProjectFile('App.tsx');
const appRootSource = readProjectFile('src', 'app', 'AppRoot.tsx');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
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
    expect(readerDataControllerSource).toContain('void persistReaderData(next).catch(() => undefined);');
  });

  it('disables app update checks while a check is already running', () => {
    expect(appControlsSource).toContain('disabled = false');
    expect(appControlsSource).toContain('disabled={disabled}');
    expect(moreScreenSource).toContain('disabled={appUpdateBusy}');
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
});
