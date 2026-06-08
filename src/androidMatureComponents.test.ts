import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readProjectFile } from './sourceTestUtils';

const packageJson = JSON.parse(readProjectFile('package.json')) as {
  dependencies?: Record<string, string>;
};
const appSource = readAppRuntimeSource();
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('src', 'app', 'useFeedController.ts');
const imagePreviewSource = readProjectFile('src', 'components', 'ImagePreviewModal.tsx');
const feedScreenSource = readProjectFile('src', 'screens', 'FeedScreen.tsx');
const searchScreenSource = readProjectFile('src', 'screens', 'SearchScreen.tsx');
const libraryScreenSource = readProjectFile('src', 'screens', 'LibraryScreen.tsx');
const topicScreenSource = readProjectFile('src', 'screens', 'TopicScreen.tsx');
const replyItemSource = readProjectFile('src', 'screens', 'topic', 'ReplyItem.tsx');
const userScreenSource = readProjectFile('src', 'screens', 'UserScreen.tsx');
const readerDataSource = readProjectFile('src', 'readerData.ts');

describe('Android mature component replacements', () => {
  it('declares mature Android replacement libraries in the Android app package', () => {
    expect(packageJson.dependencies).toMatchObject({
      '@shopify/flash-list': expect.any(String),
      '@tanstack/react-query': expect.any(String),
      'expo-image': expect.any(String),
      'react-native-zoom-toolkit': expect.any(String),
      zod: expect.any(String)
    });
  });

  it('uses the zoom toolkit for image preview gestures instead of hand-written zoom state', () => {
    expect(imagePreviewSource).toContain("from 'react-native-zoom-toolkit'");
    expect(imagePreviewSource).toContain("import { GestureHandlerRootView } from 'react-native-gesture-handler';");
    expect(imagePreviewSource).toContain('<ResumableZoom');
    expect(imagePreviewSource).toContain('maxScale={imagePreviewMaxScale}');
    expect(imagePreviewSource).toMatch(/<Modal[\s\S]*<GestureHandlerRootView style=\{styles\.imagePreviewOverlay\}>[\s\S]*<ResumableZoom/);
    expect(imagePreviewSource).toMatch(/<\/GestureHandlerRootView>\s*<\/Modal>/);
    expect(imagePreviewSource).toContain('onPress={() => onSelect(index)}');
    expect(imagePreviewSource).not.toContain('const [zoomed');
    expect(imagePreviewSource).not.toContain('lastTapRef');
    expect(imagePreviewSource).not.toContain('width * 1.8');
  });

  it('uses FlashList on stable long Android lists instead of hand-tuned FlatList rendering', () => {
    for (const source of [feedScreenSource, searchScreenSource, libraryScreenSource, userScreenSource]) {
      expect(source).toContain("from '@shopify/flash-list'");
      expect(source).toContain('<FlashList');
      expect(source).not.toMatch(/import\s+\{[^}]*\bFlatList\b[^}]*\}\s+from 'react-native'/);
    }
  });

  it('keeps the rich topic detail screen on FlatList to avoid dynamic HTML image overlap', () => {
    expect(topicScreenSource).toMatch(/import\s+\{[\s\S]*\bFlatList\b[\s\S]*\}\s+from 'react-native'/);
    expect(topicScreenSource).toContain('<FlatList');
    expect(topicScreenSource).not.toContain("from '@shopify/flash-list'");
  });

  it('keeps ordinary avatars and preview thumbnails on expo-image while preserving React Native Image for full-size detail images', () => {
    expect(imagePreviewSource).toContain("import { Image as ExpoImage } from 'expo-image';");
    expect(imagePreviewSource).toContain('<ExpoImage source={imageSourceFromUrl(url)}');
    expect(replyItemSource).toContain("import { Image as ExpoImage } from 'expo-image';");
    expect(userScreenSource).toContain("import { Image as ExpoImage } from 'expo-image';");
    expect(appSource).toContain("import {\n  AppState,");
    expect(appSource).toContain('Image,');
  });

  it('uses Zod for reader data shape validation before applying existing merge and cleanup rules', () => {
    expect(readerDataSource).toContain("from 'zod'");
    expect(readerDataSource).toContain('readerDataSchema.safeParse');
    expect(readerDataSource).toContain('topicRecordSchema');
    expect(readerDataSource).toContain('followedUserRecordSchema');
    expect(readerDataSource).toContain('readerSettingsSchema');
  });

  it('uses TanStack Query only for low-risk category and status read trials', () => {
    expect(appSource).toContain("import { QueryClient } from '@tanstack/react-query';");
    expect(appSource).toContain('const queryClientRef = useRef(new QueryClient');
    expect(feedControllerSource).toContain("queryKey: ['android-categories'");
    expect(backupStatusControllerSource).toContain("queryKey: ['android-status'");
    expect(appSource).not.toContain("queryKey: ['android-topic'");
    expect(appSource).not.toContain("queryKey: ['android-replies'");
  });
});
