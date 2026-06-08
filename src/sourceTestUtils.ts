import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8').replace(/\r\n/g, '\n');
}

export function readOptionalProjectFile(...segments: string[]) {
  const filePath = join(process.cwd(), ...segments);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n') : '';
}

export function readAppRuntimeSource() {
  return [
    readProjectFile('src', 'app', 'AppRoot.tsx'),
    readProjectFile('src', 'app', 'AppShell.tsx'),
    readProjectFile('src', 'app', 'AppScreenRenderers.tsx'),
    readProjectFile('src', 'app', 'useMainTabScrollToTop.ts'),
    readProjectFile('src', 'app', 'useReaderDataActionsController.ts'),
    readProjectFile('src', 'app', 'useTopicUiStateController.ts')
  ].join('\n');
}

export function readThemeRuntimeSource() {
  return [
    readProjectFile('src', 'theme.ts'),
    readProjectFile('src', 'themeCore.ts'),
    readProjectFile('src', 'themeStyles.ts'),
    readProjectFile('src', 'themeParts.ts')
  ].join('\n');
}

export function readTopicRuntimeSource() {
  return [
    readProjectFile('src', 'screens', 'TopicScreen.tsx'),
    readProjectFile('src', 'screens', 'topic', 'topicScreenHelpers.ts'),
    readProjectFile('src', 'screens', 'topic', 'TopicScreenBody.tsx')
  ].join('\n');
}

export function readMoreRuntimeSource() {
  return [
    readProjectFile('src', 'screens', 'MoreScreen.tsx'),
    readProjectFile('src', 'screens', 'more', 'MorePanels.tsx'),
    readProjectFile('src', 'screens', 'more', 'LinuxDoLevelPanel.tsx')
  ].join('\n');
}

export function readLibraryRuntimeSource() {
  return [
    readProjectFile('src', 'screens', 'LibraryScreen.tsx'),
    readProjectFile('src', 'screens', 'library', 'libraryScreenItems.ts')
  ].join('\n');
}
