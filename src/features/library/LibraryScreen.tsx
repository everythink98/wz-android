import { createLibraryStyles, type LibraryStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Alert, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Star, Trash2, type LucideIcon } from 'lucide-react-native';
import type { FeedSource, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import { type FollowedUserRecord, type TopicRecord } from '@/domain/reader/readerData';
import { type LibraryTab } from '@/domain/forum/feed';
import { filterLibraryRecords, libraryCategoryFilterItems } from './model/libraryFilters';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { feedSources } from '@/domain/forum/feedOptions';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { useReaderStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP, triggerPressFeedback } from '@/ui/controls/pressFeedback';
import { avatarInitial } from '@/ui/avatar/Avatar';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import {
  createLibraryListItems,
  filterFollowedUsersBySource,
  libraryCountLabel,
  libraryDataItemKey,
  libraryDataItemType,
  type LibraryDataItem,
  type LibraryListItem
} from './libraryScreenItems';

const LIBRARY_TAB_ITEMS = [
  { value: 'favorites', label: '帖子' },
  { value: 'users', label: '关注用户' },
  { value: 'history', label: '历史' }
];
const LIBRARY_SOURCE_ITEMS = [
  { value: 'all', label: '全部' },
  ...feedSources.map((source) => ({ value: source, label: sourceLabel(source) }))
];

function pressLibraryAction(event: GestureResponderEvent, onPress: () => void) {
  event.stopPropagation?.();
  triggerPressFeedback();
  onPress();
}

function LibraryRowAction({ label, styles, onPress }: { label: string; styles: LibraryStyles; onPress: () => void }) {
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.libraryInlineAction}
      onPress={(event) => pressLibraryAction(event, onPress)}
    >
      <Text style={styles.libraryInlineActionText}>{label}</Text>
    </Pressable>
  );
}

function LibraryIconAction({
  icon,
  label,
  tone = 'primary',
  filled = false,
  styles,
  theme,
  onPress
}: {
  icon: LucideIcon;
  label: string;
  tone?: 'primary' | 'danger' | 'favorite';
  filled?: boolean;
  styles: LibraryStyles;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const color = tone === 'danger' ? theme.danger : tone === 'favorite' ? theme.favorite : theme.primary;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.libraryIconAction}
      onPress={(event) => pressLibraryAction(event, onPress)}
    >
      <Icon size={18} color={color} fill={filled ? color : 'none'} strokeWidth={1.9} />
    </Pressable>
  );
}

export const LibraryScreen = memo(function LibraryScreen({
  libraryTab,
  categories,
  followedUsers,
  loaded,
  records,
  scrollRef,
  topicStateIndex,
  onClearHistory,
  onOpenTopic,
  onOpenUser,
  onRemove,
  onRemoveUser,
  onTabChange
}: {
  libraryTab: LibraryTab;
  categories: Parameters<typeof libraryCategoryFilterItems>[0];
  followedUsers: FollowedUserRecord[];
  loaded: boolean;
  records: TopicRecord[];
  scrollRef?: RefObject<FlashListRef<FollowedUserRecord | LibraryListItem> | null>;
  topicStateIndex: TopicListItemStateIndex;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  onRemove: (topic: Topic) => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const { styles, theme } = useReaderStyles(createLibraryStyles);
  const internalListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const listRef = scrollRef || internalListRef;
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const userRecords = useMemo(
    () => filterFollowedUsersBySource(followedUsers, sourceFilter),
    [followedUsers, sourceFilter]
  );
  const categoryItems = useMemo(() => libraryCategoryFilterItems(categories, sourceFilter), [categories, sourceFilter]);
  const filteredRecords = useMemo(
    () =>
      filterLibraryRecords(records, {
        source: sourceFilter,
        category: categoryFilter
      }),
    [categoryFilter, records, sourceFilter]
  );
  const listItems = useMemo<LibraryListItem[]>(() => createLibraryListItems(filteredRecords), [filteredRecords]);
  const scrollLibraryToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const changeLibraryTab = useCallback(
    (value: string) => {
      if (value === libraryTab) return;
      setSourceFilter('all');
      setCategoryFilter('all');
      scrollLibraryToTop();
      onTabChange(value as LibraryTab);
      requestAnimationFrame(scrollLibraryToTop);
    },
    [libraryTab, onTabChange, scrollLibraryToTop]
  );
  const changeSourceFilter = useCallback((value: string) => {
    setSourceFilter(value as FeedSource);
  }, []);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryItems.some((item) => item.value === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryItems]);
  const confirmRemoveFavorite = useCallback(
    (topic: Topic) => {
      Alert.alert('确定取消收藏吗？', topic.title || '这条收藏将从本机移除。', [
        { text: '取消', style: 'cancel' },
        { text: '确定', style: 'destructive', onPress: () => onRemove(topic) }
      ]);
    },
    [onRemove]
  );
  const confirmClearHistory = useCallback(() => {
    Alert.alert('清空历史？', '清空后无法恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: onClearHistory }
    ]);
  }, [onClearHistory]);
  const renderTopicTrailingAction = useCallback(
    (topic: Topic) => {
      if (libraryTab === 'favorites') {
        return (
          <LibraryIconAction
            filled
            icon={Star}
            label="取消收藏"
            tone="favorite"
            styles={styles}
            theme={theme}
            onPress={() => confirmRemoveFavorite(topic)}
          />
        );
      }
      if (libraryTab === 'history') {
        return (
          <LibraryIconAction
            icon={Trash2}
            label="删除"
            tone="danger"
            styles={styles}
            theme={theme}
            onPress={() => onRemove(topic)}
          />
        );
      }
      return null;
    },
    [confirmRemoveFavorite, libraryTab, onRemove, styles, theme]
  );
  const renderLibraryItem = useCallback<ListRenderItem<LibraryListItem>>(
    ({ item }) => {
      if (item.type === 'section') {
        return (
          <Text style={[styles.librarySectionTitle, item.first && styles.libraryFirstSectionTitle]}>{item.label}</Text>
        );
      }
      const record = item.record;
      const readerState = getTopicListItemStateFromIndex(topicStateIndex, record.topic);
      return (
        <View style={styles.libraryItem}>
          <MemoizedTopicCard
            testID={
              record === filteredRecords[0]
                ? libraryTab === 'favorites'
                  ? 'library-favorite-first'
                  : libraryTab === 'history'
                    ? 'library-history-first'
                    : undefined
                : undefined
            }
            readerState={libraryTab === 'favorites' ? { ...readerState, favorite: false, read: false } : readerState}
            styles={styles}
            theme={theme}
            renderTrailingAction={renderTopicTrailingAction}
            topic={record.topic}
            onOpenTopic={onOpenTopic}
          />
        </View>
      );
    },
    [filteredRecords, libraryTab, onOpenTopic, renderTopicTrailingAction, styles, theme, topicStateIndex]
  );
  const renderUserItem = useCallback(
    ({ index, item }: { index: number; item: FollowedUserRecord }) => (
      <View style={styles.libraryUserRow}>
        <Pressable
          testID={index === 0 ? 'library-user-first' : undefined}
          accessibilityRole="button"
          style={[styles.menuButton, styles.libraryUserButton]}
          onPress={() => onOpenUser(item.user)}
        >
          <View style={styles.menuIcon}>
            <Text style={styles.replyAvatarText}>{avatarInitial(item.user.displayName || item.user.username)}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.menuLabel} numberOfLines={1}>
              {item.user.displayName || item.user.username}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {[
                sourceLabel(item.user.source),
                item.user.levelLabel,
                `关注于 ${formatDateTime(item.followedAt) || item.followedAt}`
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Pressable>
        <View style={styles.libraryUserAction}>
          <LibraryRowAction label="取消关注" styles={styles} onPress={() => onRemoveUser(item.user)} />
        </View>
      </View>
    ),
    [onOpenUser, onRemoveUser, styles]
  );

  const header = useMemo(
    () => (
      <View style={styles.stack}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>收藏</Text>
          <Text style={styles.meta}>
            {libraryCountLabel({ filteredRecords, followedUsers, libraryTab, records, userRecords })}
          </Text>
        </View>
        <PillRail
          variant="tabs"
          items={LIBRARY_TAB_ITEMS}
          value={libraryTab}
          testIDPrefix="library-tab"
          styles={styles}
          onChange={changeLibraryTab}
        />
        <PillRail
          variant="subtabs"
          items={LIBRARY_SOURCE_ITEMS}
          value={sourceFilter}
          testIDPrefix="library-source"
          styles={styles}
          onChange={changeSourceFilter}
        />
        {libraryTab !== 'users' && categoryItems.length > 1 ? (
          <PillRail
            variant="subtabs"
            items={categoryItems}
            value={categoryFilter}
            styles={styles}
            onChange={setCategoryFilter}
          />
        ) : null}
        {libraryTab === 'history' && records.length ? (
          <View style={styles.actions}>
            <AppButton compact label="清空历史" variant="danger" styles={styles} onPress={confirmClearHistory} />
          </View>
        ) : null}
        {libraryTab === 'users' ? <View style={styles.libraryUserListSpacer} /> : null}
      </View>
    ),
    [
      categoryFilter,
      categoryItems,
      changeLibraryTab,
      changeSourceFilter,
      confirmClearHistory,
      filteredRecords,
      followedUsers,
      libraryTab,
      loaded,
      records,
      sourceFilter,
      styles,
      userRecords
    ]
  );

  return (
    <FlashList
      testID={
        loaded
          ? libraryTab === 'favorites'
            ? 'library-favorites-ready'
            : libraryTab === 'users'
              ? 'library-users-ready'
              : 'library-history-ready'
          : undefined
      }
      accessibilityLabel={
        loaded && libraryTab === 'favorites'
          ? filteredRecords.length
            ? '收藏列表，已加载，有收藏'
            : '收藏列表，已加载，没有收藏'
          : '收藏列表'
      }
      ref={listRef}
      style={styles.content}
      contentContainerStyle={styles.libraryContentInner}
      data={libraryTab === 'users' ? userRecords : listItems}
      keyExtractor={(item) => libraryDataItemKey(item as LibraryDataItem, libraryTab)}
      getItemType={(item) => libraryDataItemType(item as LibraryDataItem, libraryTab)}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      drawDistance={250}
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View
          testID={
            loaded && libraryTab === 'favorites' && !filteredRecords.length ? 'library-favorites-empty' : undefined
          }
        >
          <EmptyText text={libraryTab === 'users' ? '这里还没有关注用户' : '这里还没有内容'} styles={styles} />
        </View>
      }
      renderItem={
        libraryTab === 'users'
          ? (renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
          : (renderLibraryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
      }
    />
  );
});
