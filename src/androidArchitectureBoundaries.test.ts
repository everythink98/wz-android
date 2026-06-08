import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readProjectFile, readThemeRuntimeSource, readTopicRuntimeSource } from './sourceTestUtils';

const appSource = readAppRuntimeSource();
const topicScreenSource = readTopicRuntimeSource();
const topicScreenEntrySource = readProjectFile('src', 'screens', 'TopicScreen.tsx');
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const themeSource = readThemeRuntimeSource();
const themeEntrySource = readProjectFile('src', 'theme.ts');

describe('Android architecture boundaries', () => {
  it('keeps image preview orchestration outside the app shell', () => {
    const imagePreviewControllerSource = readProjectFile('src', 'app', 'useImagePreviewController.ts');

    expect(imagePreviewControllerSource).toContain('export function useImagePreviewController');
    expect(appSource).toContain('useImagePreviewController');
    expect(appSource).not.toContain('const savePreviewImage = useCallback');
    expect(appSource).not.toContain('createImagePreviewList({');
  });

  it('keeps HTML renderer configuration outside the app shell', () => {
    const htmlRenderingSource = readProjectFile('src', 'app', 'useHtmlRenderingController.tsx');

    expect(htmlRenderingSource).toContain('export function useHtmlRenderingController');
    expect(htmlRenderingSource).toContain('htmlBaseStyle');
    expect(htmlRenderingSource).toContain('htmlRenderersProps');
    expect(htmlRenderingSource).toContain('PreviewImageRenderer');
    expect(appSource).not.toContain('const htmlRenderers = useMemo<HtmlRenderers>');
    expect(appSource).not.toContain('const htmlTagsStyles = useMemo<HtmlTagsStyles>');
  });

  it('keeps hidden browser fetch WebView scripts outside the app shell', () => {
    const hiddenBrowserControllerSource = readProjectFile('src', 'app', 'useHiddenBrowserFetchController.ts');

    expect(hiddenBrowserControllerSource).toContain('NODESEEK_BROWSER_FETCH_SCRIPT');
    expect(hiddenBrowserControllerSource).toContain('LINUXDO_BROWSER_FETCH_SCRIPT');
    expect(hiddenBrowserControllerSource).toContain('handleNodeSeekBrowserFetchMessage');
    expect(hiddenBrowserControllerSource).toContain('handleLinuxDoBrowserFetchMessage');
    expect(appSource).not.toContain('const NODESEEK_BROWSER_FETCH_SCRIPT = `');
    expect(appSource).not.toContain('const LINUXDO_BROWSER_FETCH_SCRIPT = `');
  });

  it('keeps topic navigation snapshot orchestration outside the app shell', () => {
    const topicNavigationSource = readProjectFile('src', 'app', 'useTopicNavigationController.ts');

    expect(topicNavigationSource).toContain('export function useTopicNavigationController');
    expect(topicNavigationSource).toContain('topicSnapshot');
    expect(topicNavigationSource).toContain('restoreTopicSnapshot');
    expect(appSource).not.toContain('const topicSnapshot = useCallback');
    expect(appSource).not.toContain('const restoreTopicSnapshot = useCallback');
  });

  it('splits topic screen detail regions into focused components', () => {
    const topicPollsSource = readProjectFile('src', 'screens', 'topic', 'TopicPolls.tsx');
    const topicActionBarSource = readProjectFile('src', 'screens', 'topic', 'TopicActionBar.tsx');
    const topicContentSource = readProjectFile('src', 'screens', 'topic', 'TopicContentBlock.tsx');
    const replyItemSource = readProjectFile('src', 'screens', 'topic', 'ReplyItem.tsx');

    expect(topicScreenEntrySource).toContain("export { TopicScreen } from './topic/TopicScreenBody';");
    expect(topicScreenEntrySource).toContain("export type { TopicListItem } from './topic/TopicScreenBody';");
    expect(topicScreenEntrySource).not.toContain('<FlatList');
    expect(topicPollsSource).toContain('export function TopicPolls');
    expect(topicActionBarSource).toContain('export function TopicActionBar');
    expect(topicContentSource).toContain('export function TopicContentBlock');
    expect(replyItemSource).toContain('export function ReplyItem');
    expect(topicScreenSource).not.toContain('function PollBlockList');
    expect(topicScreenSource).not.toContain('function ReplyCard');
    expect(topicScreenSource).not.toContain('function HtmlContent');
  });

  it('splits more screen panels into focused components', () => {
    const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');

    expect(morePanelsSource).toContain('export function BackupRestorePanel');
    expect(morePanelsSource).toContain('export function NodeSeekLoginPanel');
    expect(morePanelsSource).toContain('export function LinuxDoLevelPanel');
    expect(morePanelsSource).toContain('export function SettingsPanel');
    expect(moreScreenSource).not.toContain('function BackupRestorePanel');
    expect(moreScreenSource).not.toContain('function LinuxDoLevelPanel');
  });

  it('keeps theme public API while moving style groups behind helpers', () => {
    expect(themeEntrySource).toContain("export { createStyles } from './themeStyles';");
    expect(themeEntrySource).toContain("} from './themeCore';");
    expect(themeEntrySource).toContain("export type { ReaderTheme, StatusBadgeTone } from './themeCore';");
    expect(themeEntrySource).not.toContain('StyleSheet.create');
    expect(themeSource).toContain('export function createTheme');
    expect(themeSource).toContain('export function createStyles');
    expect(themeSource).toContain('createNavigationStyles(');
    expect(themeSource).toContain('createTopicStyles(');
    expect(themeSource).toContain('createPanelStyles(');
  });
});
