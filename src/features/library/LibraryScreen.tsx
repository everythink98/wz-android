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
import { sourceCatalog, sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
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
  enabledSources,
  followedUsers,
  loaded,
  records,
  scrollRef,
  topicStateIndex,
  onClearHistory,
  onManageContentSources,
  onOpenTopic,
  onOpenUser,
  onRemove,
  onRemoveUser,
  onTabChange
}: {
  libraryTab: LibraryTab;
  categories: Parameters<typeof libraryCategoryFilterItems>[0];
  enabledSources: readonly Source[];
  followedUsers: FollowedUserRecord[];
  loaded: boolean;
  records: TopicRecord[];
  scrollRef?: RefObject<FlashListRef<FollowedUserRecord | LibraryListItem> | null>;
  topicStateIndex: TopicListItemStateIndex;
  onClearHistory: () => void;
  onManageContentSources: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  onRemove: (topic: Topic) => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createLibraryStyles);
  const internalListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const listRef = scrollRef || internalListRef;
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const enabledMembershipKey = sourceValues.filter((source) => enabledSources.includes(source)).join('|');
  const enabledSourceSet = useMemo(
    () => new Set<Source>(enabledMembershipKey ? (enabledMembershipKey.split('|') as Source[]) : []),
    [enabledMembershipKey]
  );
  const sourceItems = useMemo(
    () => [
      { value: 'all', label: '全部' },
      ...enabledSources.map((source) => ({ value: source, label: sourceCatalog[source].label }))
    ],
    [enabledSources]
  );
  const effectiveSourceFilter =
    sourceFilter === 'all' || enabledSourceSet.has(sourceFilter as Source) ? sourceFilter : 'all';
  const effectiveCategoryFilter = effectiveSourceFilter === sourceFilter ? categoryFilter : 'all';
  const visibleFollowedUsers = useMemo(
    () => followedUsers.filter((record) => enabledSourceSet.has(record.user.source)),
    [enabledSourceSet, followedUsers]
  );
  const visibleRecords = useMemo(
    () => records.filter((record) => enabledSourceSet.has(record.topic.source)),
    [enabledSourceSet, records]
  );
  const userRecords = useMemo(
    () => filterFollowedUsersBySource(visibleFollowedUsers, effectiveSourceFilter),
    [effectiveSourceFilter, visibleFollowedUsers]
  );
  const categoryItems = useMemo(
    () => libraryCategoryFilterItems(categories, effectiveSourceFilter),
    [categories, effectiveSourceFilter]
  );
  const filteredRecords = useMemo(
    () =>
      filterLibraryRecords(visibleRecords, {
        source: effectiveSourceFilter,
        category: effectiveCategoryFilter
      }),
    [effectiveCategoryFilter, effectiveSourceFilter, visibleRecords]
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
    if (sourceFilter !== 'all' && !enabledSourceSet.has(sourceFilter as Source)) {
      setSourceFilter('all');
      setCategoryFilter('all');
    }
  }, [enabledMembershipKey, enabledSourceSet, sourceFilter]);
  useEffect(() => {
    if (effectiveCategoryFilter !== 'all' && !categoryItems.some((item) => item.value === effectiveCategoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryItems, effectiveCategoryFilter]);
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
            {libraryCountLabel({
              filteredRecords,
              followedUsers: visibleFollowedUsers,
              libraryTab,
              records: visibleRecords,
              userRecords
            })}
          </Text>
        </View>
        <PillRail
          variant="tabs"
          items={LIBRARY_TAB_ITEMS}
          value={libraryTab}
          testIDPrefix="library-tab"
          onChange={changeLibraryTab}
        />
        <PillRail
          variant="subtabs"
          items={sourceItems}
          value={effectiveSourceFilter}
          testIDPrefix="library-source"
          onChange={changeSourceFilter}
        />
        {libraryTab !== 'users' && categoryItems.length > 1 ? (
          <PillRail
            variant="subtabs"
            items={categoryItems}
            value={effectiveCategoryFilter}
            onChange={setCategoryFilter}
          />
        ) : null}
        {libraryTab === 'history' && visibleRecords.length ? (
          <View style={styles.actions}>
            <AppButton compact label="清空历史" variant="danger" onPress={confirmClearHistory} />
          </View>
        ) : null}
        {libraryTab === 'users' ? <View style={styles.libraryUserListSpacer} /> : null}
      </View>
    ),
    [
      categoryItems,
      changeLibraryTab,
      changeSourceFilter,
      confirmClearHistory,
      filteredRecords,
      effectiveCategoryFilter,
      effectiveSourceFilter,
      libraryTab,
      loaded,
      sourceItems,
      styles,
      userRecords,
      visibleFollowedUsers,
      visibleRecords
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
          <EmptyText
            text={
              enabledSources.length === 0
                ? '尚未启用内容源'
                : libraryTab === 'users'
                  ? '这里还没有关注用户'
                  : '这里还没有内容'
            }
          />
          {enabledSources.length === 0 ? (
            <View style={styles.actions}>
              <AppButton label="管理内容源" variant="primary" onPress={onManageContentSources} />
            </View>
          ) : null}
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
