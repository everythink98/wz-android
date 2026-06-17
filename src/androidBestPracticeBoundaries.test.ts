import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appEntrySource = readProjectFile('App.tsx');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('src', 'app', 'useFeedController.ts');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const searchControllerSource = readProjectFile('src', 'app', 'useSearchController.ts');
const topicActionsControllerSource = readProjectFile('src', 'app', 'useTopicActionsController.ts');
const topicControllerSource = readProjectFile('src', 'app', 'useTopicController.ts');
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
});
