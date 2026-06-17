import { useCallback, type ComponentProps, type RefObject } from 'react';
import { ScrollView } from 'react-native';
import type { createStyles } from '../theme';
import { FeedScreen } from '../screens/FeedScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { TopicScreen } from '../screens/TopicScreen';
import { UserScreen } from '../screens/UserScreen';

type UseAppScreenRenderersParams = {
  feedProps: ComponentProps<typeof FeedScreen>;
  libraryProps: ComponentProps<typeof LibraryScreen>;
  moreProps: ComponentProps<typeof MoreScreen>;
  moreScrollRef: RefObject<ScrollView | null>;
  searchProps: ComponentProps<typeof SearchScreen>;
  styles: ReturnType<typeof createStyles>;
  topicProps: ComponentProps<typeof TopicScreen>;
  userProps: ComponentProps<typeof UserScreen>;
};

export function useAppScreenRenderers({
  feedProps,
  libraryProps,
  moreProps,
  moreScrollRef,
  searchProps,
  styles,
  topicProps,
  userProps
}: UseAppScreenRenderersParams) {
  const renderFeedTab = useCallback(() => (
    <FeedScreen {...feedProps} />
  ), [feedProps]);

  const renderSearchTab = useCallback(() => (
    <SearchScreen {...searchProps} />
  ), [searchProps]);

  const renderLibraryTab = useCallback(() => (
    <LibraryScreen {...libraryProps} />
  ), [libraryProps]);

  const renderMoreTab = useCallback(() => (
    <ScrollView ref={moreScrollRef} style={styles.content} contentContainerStyle={styles.moreContentInner} keyboardShouldPersistTaps="handled">
      <MoreScreen {...moreProps} />
    </ScrollView>
  ), [moreProps, moreScrollRef, styles]);

  const renderTopicScreen = useCallback(() => (
    <TopicScreen {...topicProps} />
  ), [topicProps]);

  const renderUserScreen = useCallback(() => (
    <UserScreen {...userProps} />
  ), [userProps]);

  return {
    renderFeedTab,
    renderLibraryTab,
    renderMoreTab,
    renderSearchTab,
    renderTopicScreen,
    renderUserScreen
  };
}
