import { createLibraryStyles, type LibraryStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ViewStyle
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { ChevronDown, Star, Trash2, type LucideIcon } from 'lucide-react-native';
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
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP, triggerPressFeedback } from '@/ui/controls/pressFeedback';
import { avatarInitial } from '@/ui/avatar/Avatar';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
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

const LibraryViewportList = memo(function LibraryViewportList({
  accessibilityLabel,
  data,
  empty,
  header,
  listRef,
  readyTestID,
  renderItem,
  styles,
  tab,
  onLoad
}: {
  accessibilityLabel?: string;
  data: LibraryDataItem[];
  empty: ReactElement;
  header: ReactElement;
  listRef: RefObject<FlashListRef<LibraryDataItem> | null>;
  readyTestID?: string;
  renderItem: ListRenderItem<LibraryDataItem>;
  styles: LibraryStyles;
  tab: LibraryTab;
  onLoad: (tab: LibraryTab) => void;
}) {
  return (
    <FlashList
      testID={readyTestID}
      accessibilityLabel={accessibilityLabel}
      ref={listRef}
      style={styles.content}
      contentContainerStyle={styles.libraryContentInner}
      data={data}
      keyExtractor={(item) => libraryDataItemKey(item, tab)}
      getItemType={(item) => libraryDataItemType(item, tab)}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      drawDistance={250}
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      renderItem={renderItem}
      onLoad={() => onLoad(tab)}
    />
  );
});

export const LibraryScreen = memo(function LibraryScreen({
  active,
  libraryTab,
  categories,
  enabledSources,
  favoriteRecords,
  followedUsers,
  historyRecords,
  loaded,
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
  active: boolean;
  libraryTab: LibraryTab;
  categories: Parameters<typeof libraryCategoryFilterItems>[0];
  enabledSources: readonly Source[];
  favoriteRecords: TopicRecord[];
  followedUsers: FollowedUserRecord[];
  historyRecords: TopicRecord[];
  loaded: boolean;
  scrollRef?: RefObject<FlashListRef<FollowedUserRecord | LibraryListItem> | null>;
  topicStateIndex: TopicListItemStateIndex;
  onClearHistory: () => void;
  onManageContentSources: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserReference) => void;
  onRemove: (topic: Topic, section: 'favorites' | 'history') => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createLibraryStyles);
  const { height: windowHeight } = useWindowDimensions();
  const favoriteListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const historyListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const userListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const favoriteCategoryMenuTriggerRef = useRef<View>(null);
  const historyCategoryMenuTriggerRef = useRef<View>(null);
  const loadedTabsRef = useRef(new Set<LibraryTab>());
  const prewarmFrameRef = useRef<number | null>(null);
  const [mountedTabs, setMountedTabs] = useState<LibraryTab[]>([libraryTab]);
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categoryMenuTab, setCategoryMenuTab] = useState<'favorites' | 'history' | null>(null);
  const [categoryMenuPlacement, setCategoryMenuPlacement] = useState<ViewStyle>({
    position: 'absolute',
    left: 16,
    top: 12,
    minWidth: 180
  });
  const enabledSourceOrderKey = enabledSources.join('|');
  const enabledMembershipKey = sourceValues.filter((source) => enabledSources.includes(source)).join('|');
  const enabledSourceSet = useMemo(
    () => new Set<Source>(enabledMembershipKey ? (enabledMembershipKey.split('|') as Source[]) : []),
    [enabledMembershipKey]
  );
  const sourceItems = useMemo(
    () => [
      { value: 'all', label: '全部' },
      ...(enabledSourceOrderKey ? (enabledSourceOrderKey.split('|') as Source[]) : []).map((source) => ({
        value: source,
        label: sourceCatalog[source].label
      }))
    ],
    [enabledSourceOrderKey]
  );
  const effectiveSourceFilter =
    sourceFilter === 'all' || enabledSourceSet.has(sourceFilter as Source) ? sourceFilter : 'all';
  const effectiveCategoryFilter = effectiveSourceFilter === sourceFilter ? categoryFilter : 'all';
  const visibleFollowedUsers = useMemo(
    () => followedUsers.filter((record) => enabledSourceSet.has(record.user.source)),
    [enabledSourceSet, followedUsers]
  );
  const visibleFavoriteRecords = useMemo(
    () => favoriteRecords.filter((record) => enabledSourceSet.has(record.topic.source)),
    [enabledSourceSet, favoriteRecords]
  );
  const visibleHistoryRecords = useMemo(
    () => historyRecords.filter((record) => enabledSourceSet.has(record.topic.source)),
    [enabledSourceSet, historyRecords]
  );
  const userRecords = useMemo(
    () => filterFollowedUsersBySource(visibleFollowedUsers, effectiveSourceFilter),
    [effectiveSourceFilter, visibleFollowedUsers]
  );
  const categoryItems = useMemo(
    () => libraryCategoryFilterItems(categories, effectiveSourceFilter),
    [categories, effectiveSourceFilter]
  );
  const categoryLabel =
    categoryItems.find((item) => item.value === effectiveCategoryFilter)?.label || categoryItems[0]?.label || '全部';
  const filteredFavoriteRecords = useMemo(
    () =>
      filterLibraryRecords(visibleFavoriteRecords, {
        source: effectiveSourceFilter,
        category: effectiveCategoryFilter
      }),
    [effectiveCategoryFilter, effectiveSourceFilter, visibleFavoriteRecords]
  );
  const filteredHistoryRecords = useMemo(
    () =>
      filterLibraryRecords(visibleHistoryRecords, {
        source: effectiveSourceFilter,
        category: effectiveCategoryFilter
      }),
    [effectiveCategoryFilter, effectiveSourceFilter, visibleHistoryRecords]
  );
  const favoriteListItems = useMemo<LibraryListItem[]>(
    () => createLibraryListItems(filteredFavoriteRecords),
    [filteredFavoriteRecords]
  );
  const historyListItems = useMemo<LibraryListItem[]>(
    () => createLibraryListItems(filteredHistoryRecords),
    [filteredHistoryRecords]
  );
  const scrollLibraryToTop = useCallback((tab: LibraryTab) => {
    const listRef = tab === 'favorites' ? favoriteListRef : tab === 'history' ? historyListRef : userListRef;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  const scheduleNextPrewarm = useLatestCallback(() => {
    if (!active || prewarmFrameRef.current !== null) return;
    prewarmFrameRef.current = requestAnimationFrame(() => {
      prewarmFrameRef.current = null;
      const order: LibraryTab[] =
        libraryTab === 'favorites'
          ? ['history', 'users']
          : libraryTab === 'history'
            ? ['favorites', 'users']
            : ['favorites', 'history'];
      setMountedTabs((current) => {
        const next = order.find((tab) => !current.includes(tab));
        return next ? [...current, next] : current;
      });
    });
  });
  const handleViewportLoad = useCallback(
    (tab: LibraryTab) => {
      loadedTabsRef.current.add(tab);
      scheduleNextPrewarm();
    },
    [scheduleNextPrewarm]
  );
  useEffect(() => {
    if (!active) {
      if (prewarmFrameRef.current !== null) cancelAnimationFrame(prewarmFrameRef.current);
      prewarmFrameRef.current = null;
      setMountedTabs((current) => (current.length === 1 && current[0] === libraryTab ? current : [libraryTab]));
      loadedTabsRef.current = loadedTabsRef.current.has(libraryTab) ? new Set([libraryTab]) : new Set();
      return;
    }
    if (loadedTabsRef.current.has(libraryTab)) scheduleNextPrewarm();
    return () => {
      if (prewarmFrameRef.current !== null) cancelAnimationFrame(prewarmFrameRef.current);
      prewarmFrameRef.current = null;
    };
  }, [active, libraryTab, scheduleNextPrewarm]);
  useEffect(() => {
    if (!scrollRef) return;
    const activeListRef =
      libraryTab === 'favorites' ? favoriteListRef : libraryTab === 'history' ? historyListRef : userListRef;
    scrollRef.current = activeListRef.current;
    return () => {
      if (scrollRef.current === activeListRef.current) scrollRef.current = null;
    };
  }, [libraryTab, scrollRef]);
  const changeLibraryTab = useLatestCallback((value: string) => {
    if (value === libraryTab) return;
    const nextTab = value as LibraryTab;
    setMountedTabs((current) => (current.includes(nextTab) ? current : [...current, nextTab]));
    setCategoryMenuTab(null);
    setSourceFilter('all');
    setCategoryFilter('all');
    scrollLibraryToTop(nextTab);
    onTabChange(nextTab);
    requestAnimationFrame(() => scrollLibraryToTop(nextTab));
  });
  const changeSourceFilter = useCallback((value: string) => {
    setCategoryMenuTab(null);
    setSourceFilter(value as FeedSource);
  }, []);
  const openCategoryMenu = useCallback(
    (tab: 'favorites' | 'history') => {
      if (categoryItems.length <= 1) return;
      triggerPressFeedback();
      setCategoryMenuTab(tab);
      const triggerRef = tab === 'favorites' ? favoriteCategoryMenuTriggerRef : historyCategoryMenuTriggerRef;
      triggerRef.current?.measureInWindow((x, y, _width, height) => {
        const margin = 8;
        const opensAbove = y + height / 2 > windowHeight / 2;
        setCategoryMenuPlacement({
          position: 'absolute',
          left: Math.max(margin, x),
          ...(opensAbove ? { bottom: Math.max(margin, windowHeight - y + 4) } : { top: y + height + 4 }),
          maxHeight: Math.max(160, opensAbove ? y - margin : windowHeight - y - height - margin),
          minWidth: 180
        });
      });
    },
    [categoryItems.length, windowHeight]
  );
  const closeCategoryMenu = useCallback(() => setCategoryMenuTab(null), []);
  const selectCategory = useCallback((value: string) => {
    triggerPressFeedback();
    setCategoryMenuTab(null);
    setCategoryFilter(value);
  }, []);
  useEffect(() => {
    if (sourceFilter !== 'all' && !enabledSourceSet.has(sourceFilter as Source)) {
      setCategoryMenuTab(null);
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
        { text: '确定', style: 'destructive', onPress: () => onRemove(topic, 'favorites') }
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
  const renderFavoriteTrailingAction = useCallback(
    (topic: Topic) => (
      <LibraryIconAction
        filled
        icon={Star}
        label="取消收藏"
        tone="favorite"
        styles={styles}
        theme={theme}
        onPress={() => confirmRemoveFavorite(topic)}
      />
    ),
    [confirmRemoveFavorite, styles, theme]
  );
  const renderHistoryTrailingAction = useCallback(
    (topic: Topic) => (
      <LibraryIconAction
        icon={Trash2}
        label="删除"
        tone="danger"
        styles={styles}
        theme={theme}
        onPress={() => onRemove(topic, 'history')}
      />
    ),
    [onRemove, styles, theme]
  );
  const renderTopicItem = useCallback(
    (item: LibraryListItem, tab: 'favorites' | 'history') => {
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
            testID={item.first ? (tab === 'favorites' ? 'library-favorite-first' : 'library-history-first') : undefined}
            readerState={tab === 'favorites' ? { ...readerState, favorite: false, read: false } : readerState}
            renderTrailingAction={tab === 'favorites' ? renderFavoriteTrailingAction : renderHistoryTrailingAction}
            topic={record.topic}
            onOpenTopic={onOpenTopic}
          />
        </View>
      );
    },
    [onOpenTopic, renderFavoriteTrailingAction, renderHistoryTrailingAction, styles, topicStateIndex]
  );
  const renderFavoriteItem = useCallback<ListRenderItem<LibraryListItem>>(
    ({ item }) => renderTopicItem(item, 'favorites'),
    [renderTopicItem]
  );
  const renderHistoryItem = useCallback<ListRenderItem<LibraryListItem>>(
    ({ item }) => renderTopicItem(item, 'history'),
    [renderTopicItem]
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

  const renderHeader = useCallback(
    (viewportTab: LibraryTab) => {
      const viewportVisibleRecords = viewportTab === 'history' ? visibleHistoryRecords : visibleFavoriteRecords;
      const viewportFilteredRecords = viewportTab === 'history' ? filteredHistoryRecords : filteredFavoriteRecords;
      const viewportCategoryButtonHidden = viewportTab === 'users';
      const viewportCategorySelectionAvailable = !viewportCategoryButtonHidden && categoryItems.length > 1;
      const categoryMenuTriggerRef =
        viewportTab === 'favorites'
          ? favoriteCategoryMenuTriggerRef
          : viewportTab === 'history'
            ? historyCategoryMenuTriggerRef
            : undefined;
      return (
        <View style={styles.stack}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>收藏</Text>
            <Text style={styles.meta}>
              {libraryCountLabel({
                filteredRecords: viewportFilteredRecords,
                followedUsers: visibleFollowedUsers,
                libraryTab: viewportTab,
                records: viewportVisibleRecords,
                userRecords
              })}
            </Text>
          </View>
          <PillRail
            variant="tabs"
            items={LIBRARY_TAB_ITEMS}
            value={viewportTab}
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
          <View
            accessibilityElementsHidden={viewportCategoryButtonHidden}
            importantForAccessibility={viewportCategoryButtonHidden ? 'no-hide-descendants' : 'auto'}
            pointerEvents={viewportCategoryButtonHidden ? 'none' : 'auto'}
            style={[styles.categoryFilterSlot, viewportCategoryButtonHidden && styles.hiddenCategoryFilterSlot]}
          >
            <Pressable
              ref={categoryMenuTriggerRef}
              collapsable={false}
              testID="library-category-menu-button"
              accessibilityRole="button"
              accessibilityLabel={`分类：${categoryLabel}`}
              accessibilityState={{
                disabled: !viewportCategorySelectionAvailable,
                expanded: categoryMenuTab === viewportTab
              }}
              disabled={!viewportCategorySelectionAvailable}
              style={({ pressed }) => [styles.categoryFilterButton, pressed && styles.categoryFilterButtonPressed]}
              onPress={() => {
                if (viewportTab !== 'users') openCategoryMenu(viewportTab);
              }}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.categoryFilterButtonText,
                  !viewportCategorySelectionAvailable && styles.categoryFilterButtonTextDisabled
                ]}
              >
                分类：{categoryLabel}
              </Text>
              <ChevronDown
                size={14}
                color={viewportCategorySelectionAvailable ? theme.primary : theme.muted}
                strokeWidth={1.8}
              />
            </Pressable>
            {categoryMenuTab === viewportTab ? (
              <PopupMenu
                accessibilityLabel="关闭分类菜单"
                placementStyle={categoryMenuPlacement}
                visible
                onRequestClose={closeCategoryMenu}
              >
                <ScrollView>
                  {categoryItems.map((item, index) => (
                    <PopupMenuItem
                      key={item.value}
                      compact
                      label={item.label}
                      last={index === categoryItems.length - 1}
                      selected={item.value === effectiveCategoryFilter}
                      onPress={() => selectCategory(item.value)}
                    />
                  ))}
                </ScrollView>
              </PopupMenu>
            ) : null}
          </View>
          {viewportTab === 'history' && viewportVisibleRecords.length ? (
            <View style={styles.actions}>
              <AppButton compact label="清空历史" variant="danger" onPress={confirmClearHistory} />
            </View>
          ) : null}
          {viewportTab === 'users' ? <View style={styles.libraryUserListSpacer} /> : null}
        </View>
      );
    },
    [
      categoryItems,
      categoryLabel,
      categoryMenuPlacement,
      categoryMenuTab,
      changeLibraryTab,
      changeSourceFilter,
      closeCategoryMenu,
      confirmClearHistory,
      effectiveCategoryFilter,
      effectiveSourceFilter,
      filteredFavoriteRecords,
      filteredHistoryRecords,
      openCategoryMenu,
      selectCategory,
      sourceItems,
      styles,
      theme,
      userRecords,
      visibleFavoriteRecords,
      visibleFollowedUsers,
      visibleHistoryRecords
    ]
  );
  const favoriteHeader = useMemo(() => renderHeader('favorites'), [renderHeader]);
  const historyHeader = useMemo(() => renderHeader('history'), [renderHeader]);
  const userHeader = useMemo(() => renderHeader('users'), [renderHeader]);

  const renderEmpty = useCallback(
    (viewportTab: LibraryTab, recordCount: number) => (
      <View testID={loaded && viewportTab === 'favorites' && !recordCount ? 'library-favorites-empty' : undefined}>
        <EmptyText
          text={
            enabledSources.length === 0
              ? '尚未启用内容源'
              : viewportTab === 'users'
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
    ),
    [enabledSources.length, loaded, onManageContentSources, styles]
  );
  const favoriteEmpty = useMemo(
    () => renderEmpty('favorites', favoriteListItems.length),
    [favoriteListItems.length, renderEmpty]
  );
  const historyEmpty = useMemo(
    () => renderEmpty('history', historyListItems.length),
    [historyListItems.length, renderEmpty]
  );
  const userEmpty = useMemo(() => renderEmpty('users', userRecords.length), [renderEmpty, userRecords.length]);

  const renderViewport = (viewportTab: LibraryTab) => {
    if (!mountedTabs.includes(viewportTab)) return null;
    const current = viewportTab === libraryTab;
    const data =
      viewportTab === 'favorites' ? favoriteListItems : viewportTab === 'history' ? historyListItems : userRecords;
    const viewportRef =
      viewportTab === 'favorites' ? favoriteListRef : viewportTab === 'history' ? historyListRef : userListRef;
    const header =
      viewportTab === 'favorites' ? favoriteHeader : viewportTab === 'history' ? historyHeader : userHeader;
    const empty = viewportTab === 'favorites' ? favoriteEmpty : viewportTab === 'history' ? historyEmpty : userEmpty;
    const readyTestID =
      viewportTab === 'favorites'
        ? 'library-favorites-ready'
        : viewportTab === 'history'
          ? 'library-history-ready'
          : 'library-users-ready';
    return (
      <View
        key={viewportTab}
        testID={`library-${viewportTab}-viewport`}
        accessibilityElementsHidden={!current}
        importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
        pointerEvents={current ? 'auto' : 'none'}
        style={[styles.libraryViewport, current ? styles.activeLibraryViewport : styles.hiddenLibraryViewport]}
      >
        <LibraryViewportList
          readyTestID={loaded ? readyTestID : undefined}
          accessibilityLabel={
            loaded && viewportTab === 'favorites'
              ? filteredFavoriteRecords.length
                ? '收藏列表，已加载，有收藏'
                : '收藏列表，已加载，没有收藏'
              : '收藏列表'
          }
          data={data}
          empty={empty}
          header={header}
          listRef={viewportRef}
          renderItem={
            viewportTab === 'favorites'
              ? (renderFavoriteItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
              : viewportTab === 'history'
                ? (renderHistoryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
                : (renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
          }
          styles={styles}
          tab={viewportTab}
          onLoad={handleViewportLoad}
        />
      </View>
    );
  };

  return (
    <View style={styles.libraryViewportStack}>
      {renderViewport('favorites')}
      {renderViewport('history')}
      {renderViewport('users')}
    </View>
  );
});
