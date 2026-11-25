import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Star, Trash2, type LucideIcon } from 'lucide-react-native';
import type { FeedSource, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import { topicKey, type FollowedUserRecord, type TopicRecord } from '@/domain/reader/readerData';
import { type LibraryTab } from '@/domain/forum/feed';
import type { libraryCategoryFilterItems } from './model/libraryFilters';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { sourceCatalog, sourceValues, type Source } from '@/domain/forum/sourceCatalog';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ContentLoadingPlaceholder, SkeletonBlock } from '@/ui/controls/ContentLoadingPlaceholder';
import { EmptyText, LoadingState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { Avatar } from '@/ui/avatar/Avatar';
import { MemoizedTopicCard, TopicListPlaceholder } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import {
  createLibraryListItems,
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
  footer,
  header,
  listRef,
  openedTopicKey,
  readyTestID,
  renderItem,
  styles,
  tab,
  onLoadMore
}: {
  accessibilityLabel?: string;
  data: LibraryDataItem[];
  empty: ReactElement;
  footer?: ReactElement;
  header: ReactElement;
  listRef: RefObject<FlashListRef<LibraryDataItem> | null>;
  openedTopicKey?: string;
  readyTestID?: string;
  renderItem: ListRenderItem<LibraryDataItem>;
  styles: LibraryStyles;
  tab: LibraryTab;
  onLoadMore: (tab: LibraryTab) => void;
}) {
  const { bottom } = useSafeAreaInsets();
  const contentStyle = useMemo(() => ({ ...styles.libraryContentInner, paddingBottom: bottom + 16 }), [bottom, styles]);
  const positionOptions = useMemo(
    () =>
      tab !== 'history' || !openedTopicKey
        ? { disabled: true }
        : {
            shouldAnchorItem: (item: LibraryDataItem) =>
              'type' in item && item.type === 'record' && item.key !== openedTopicKey
          },
    [openedTopicKey, tab]
  );
  return (
    <FlashList
      testID={readyTestID}
      accessibilityLabel={accessibilityLabel}
      ref={listRef}
      style={styles.content}
      contentContainerStyle={contentStyle}
      data={data}
      keyExtractor={(item) => libraryDataItemKey(item, tab)}
      getItemType={(item) => libraryDataItemType(item, tab)}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      drawDistance={250}
      maintainVisibleContentPosition={positionOptions}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      renderItem={renderItem}
      onEndReached={() => onLoadMore(tab)}
      onEndReachedThreshold={0.5}
    />
  );
});

export const LibraryScreen = memo(function LibraryScreen({
  active,
  getFocusOwner,
  libraryTab,
  sourceFilter,
  categoryFilter,
  onSourceFilter,
  onCategoryFilter,
  historyCountToClear,
  error,
  onRetry,
  onRetryCategories,
  onLoadMore,
  categoryItems,
  enabledSources,
  favoriteRecords,
  followedUsers,
  historyRecords,
  loaded,
  loadingMore,
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
  getFocusOwner?: () => symbol | null;
  sourceFilter: FeedSource;
  categoryFilter: string;
  onSourceFilter: (source: FeedSource) => void;
  onCategoryFilter: (category: string) => void;
  historyCountToClear: number;
  error: boolean;
  onRetry: () => void;
  onRetryCategories?: () => void;
  onLoadMore: (tab: LibraryTab) => void;
  libraryTab: LibraryTab;
  categoryItems: ReturnType<typeof libraryCategoryFilterItems>;
  enabledSources: readonly Source[];
  favoriteRecords: TopicRecord[];
  followedUsers: FollowedUserRecord[];
  historyRecords: TopicRecord[];
  loaded: boolean;
  loadingMore: boolean;
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
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight } = useSafeAreaInsets();
  const [mountedTabs, setMountedTabs] = useState<LibraryTab[]>([libraryTab]);
  useEffect(() => {
    if (!active)
      setMountedTabs((current) => (current.length === 1 && current[0] === libraryTab ? current : [libraryTab]));
  }, [active, libraryTab]);
  const favoriteListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const historyListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const userListRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const favoriteCategoryMenuTriggerRef = useRef<View>(null);
  const historyCategoryMenuTriggerRef = useRef<View>(null);
  const categoryMenuRequestRef = useRef(0);
  const [categoryMenu, setCategoryMenu] = useState<{
    tab: 'favorites' | 'history';
    placement: ViewStyle;
  } | null>(null);
  const enabledSourceOrderKey = enabledSources.join('|');
  const enabledMembershipKey = sourceValues.filter((source) => enabledSources.includes(source)).join('|');
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
  const userRecords = followedUsers;
  const categoryLabel =
    categoryItems.find((item) => item.value === categoryFilter)?.label || categoryItems[0]?.label || '全部';
  const favoriteListItems = useMemo<LibraryListItem[]>(
    () => createLibraryListItems(favoriteRecords),
    [favoriteRecords]
  );
  const historyListItems = useMemo<LibraryListItem[]>(() => createLibraryListItems(historyRecords), [historyRecords]);
  const positionScope = `${enabledMembershipKey}:${sourceFilter}:${categoryFilter}`;
  const [historyAnchor, setHistoryAnchor] = useState<{ key: string; scope: string }>();
  useEffect(() => setHistoryAnchor(undefined), [enabledMembershipKey]);
  const openTopic = useLatestCallback((topic: Topic) => {
    if (libraryTab === 'history') setHistoryAnchor({ key: topicKey(topic), scope: positionScope });
    onOpenTopic(topic);
  });
  const closeCategoryMenu = useCallback(() => {
    categoryMenuRequestRef.current += 1;
    setCategoryMenu(null);
  }, []);
  useEffect(() => {
    closeCategoryMenu();
    return () => {
      categoryMenuRequestRef.current += 1;
    };
  }, [
    active,
    categoryItems,
    closeCategoryMenu,
    libraryTab,
    safeBottom,
    safeLeft,
    safeRight,
    safeTop,
    windowHeight,
    windowWidth
  ]);
  const scrollLibraryToTop = useCallback((tab: LibraryTab) => {
    const listRef = tab === 'favorites' ? favoriteListRef : tab === 'history' ? historyListRef : userListRef;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
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
    setHistoryAnchor(undefined);
    setMountedTabs((current) => (current.includes(nextTab) ? current : [...current, nextTab]));
    closeCategoryMenu();
    scrollLibraryToTop(nextTab);
    onTabChange(nextTab);
    requestAnimationFrame(() => scrollLibraryToTop(nextTab));
  });
  const changeSourceFilter = useLatestCallback((value: string) => {
    if (value === sourceFilter) return;
    setHistoryAnchor(undefined);
    closeCategoryMenu();
    onSourceFilter(value as FeedSource);
    scrollLibraryToTop(libraryTab);
  });
  const openCategoryMenu = useCallback(
    (tab: 'favorites' | 'history') => {
      if (!active || categoryItems.length <= 1) return;
      closeCategoryMenu();
      const request = categoryMenuRequestRef.current;
      const triggerRef = tab === 'favorites' ? favoriteCategoryMenuTriggerRef : historyCategoryMenuTriggerRef;
      triggerRef.current?.measureInWindow((x, y, _width, height) => {
        if (categoryMenuRequestRef.current !== request) return;
        const margin = 8;
        const start = safeLeft + margin;
        const end = Math.max(start, windowWidth - safeRight - margin);
        const minWidth = Math.min(180, end - start);
        const left = Math.max(start, Math.min(x, end - minWidth));
        const opensAbove = y + height / 2 > windowHeight / 2;
        setCategoryMenu({
          tab,
          placement: {
            position: 'absolute',
            left,
            minWidth,
            maxWidth: end - left,
            ...(opensAbove ? { bottom: Math.max(margin, windowHeight - y + 4) } : { top: y + height + 4 }),
            maxHeight: Math.max(
              160,
              opensAbove ? y - safeTop - margin : windowHeight - y - height - safeBottom - margin
            )
          }
        });
      });
    },
    [
      active,
      categoryItems.length,
      closeCategoryMenu,
      safeBottom,
      safeLeft,
      safeRight,
      safeTop,
      windowHeight,
      windowWidth
    ]
  );
  const selectCategory = useLatestCallback((value: string) => {
    if (!active || getFocusOwner?.() === null) return;
    closeCategoryMenu();
    if (value === categoryFilter) return;
    setHistoryAnchor(undefined);
    onCategoryFilter(value);
    scrollLibraryToTop(libraryTab);
  });
  const bindConfirmation = useCallback(
    (action: () => void) => {
      if (!getFocusOwner) return action;
      const owner = getFocusOwner();
      return () => {
        if (owner && getFocusOwner() === owner) action();
      };
    },
    [getFocusOwner]
  );
  const confirmRemoveFavorite = useCallback(
    (topic: Topic) => {
      Alert.alert('确定取消收藏吗？', topic.title || '这条收藏将从本机移除。', [
        { text: '取消', style: 'cancel' },
        { text: '确定', style: 'destructive', onPress: bindConfirmation(() => onRemove(topic, 'favorites')) }
      ]);
    },
    [bindConfirmation, onRemove]
  );
  const confirmClearHistory = useCallback(() => {
    Alert.alert(
      '清空历史？',
      `将清空所有来源的 ${historyCountToClear} 条本机历史记录，包括已停用来源。清空后无法恢复。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '清空', style: 'destructive', onPress: bindConfirmation(onClearHistory) }
      ]
    );
  }, [bindConfirmation, historyCountToClear, onClearHistory]);
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
            readerState={readerState}
            scene={tab}
            renderTrailingAction={tab === 'favorites' ? renderFavoriteTrailingAction : renderHistoryTrailingAction}
            showSource={sourceFilter === 'all'}
            topic={record.topic}
            onOpenTopic={openTopic}
          />
        </View>
      );
    },
    [sourceFilter, openTopic, renderFavoriteTrailingAction, renderHistoryTrailingAction, styles, topicStateIndex]
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
          <Avatar
            contentSource={item.user.source}
            name={item.user.displayName || item.user.username}
            uri={item.user.avatar}
          />
          <View style={styles.flex}>
            <Text style={styles.menuLabel} numberOfLines={1}>
              {item.user.displayName || item.user.username}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {[
                sourceFilter === 'all' ? sourceLabel(item.user.source) : '',
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
    [sourceFilter, onOpenUser, onRemoveUser, styles]
  );

  const renderHeader = useCallback(
    (viewportTab: LibraryTab) => {
      const viewportCategoryButtonHidden = viewportTab === 'users';
      const viewportCategorySelectionAvailable = !viewportCategoryButtonHidden && categoryItems.length > 1;
      const categoryActionAvailable = viewportCategorySelectionAvailable || Boolean(onRetryCategories);
      const categoryMenuTriggerRef =
        viewportTab === 'favorites'
          ? favoriteCategoryMenuTriggerRef
          : viewportTab === 'history'
            ? historyCategoryMenuTriggerRef
            : undefined;
      return (
        <View style={styles.stack}>
          <View style={styles.toolbarRow}>
            <View style={styles.toolbarRail}>
              <PillRail
                variant="tabs"
                items={LIBRARY_TAB_ITEMS}
                value={viewportTab}
                testIDPrefix="library-tab"
                onChange={changeLibraryTab}
              />
            </View>
            {viewportTab === 'history' && loaded && historyCountToClear > 0 ? (
              <AppButton compact icon={Trash2} label="清空历史" variant="ghost" onPress={confirmClearHistory} />
            ) : null}
          </View>
          <View testID="library-filters" style={styles.toolbarRow}>
            <View style={styles.toolbarRail}>
              <PillRail
                variant="subtabs"
                items={sourceItems}
                value={sourceFilter}
                testIDPrefix="library-source"
                onChange={changeSourceFilter}
              />
            </View>
            {!viewportCategoryButtonHidden ? (
              <View style={styles.categoryFilterSlot}>
                <Pressable
                  ref={categoryMenuTriggerRef}
                  collapsable={false}
                  testID="library-category-menu-button"
                  accessibilityRole="button"
                  accessibilityLabel={onRetryCategories ? '重新加载分类' : `分类：${categoryLabel}`}
                  accessibilityState={{
                    disabled: !categoryActionAvailable,
                    expanded: categoryMenu?.tab === viewportTab
                  }}
                  disabled={!categoryActionAvailable}
                  style={styles.categoryFilterButton}
                  onPress={onRetryCategories ?? (() => openCategoryMenu(viewportTab))}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.categoryFilterButtonText,
                      !categoryActionAvailable && styles.categoryFilterButtonTextDisabled
                    ]}
                  >
                    {onRetryCategories ? '分类 · 重试' : categoryFilter === 'all' ? '分类' : categoryLabel}
                  </Text>
                  {viewportCategorySelectionAvailable && !onRetryCategories ? (
                    <ChevronDown size={14} color={theme.primary} strokeWidth={1.8} />
                  ) : null}
                </Pressable>
                {categoryMenu?.tab === viewportTab ? (
                  <PopupMenu
                    accessibilityLabel="关闭分类菜单"
                    placementStyle={categoryMenu.placement}
                    visible
                    onRequestClose={closeCategoryMenu}
                  >
                    <ScrollView overScrollMode="never">
                      {categoryItems.map((item, index) => (
                        <PopupMenuItem
                          key={item.value}
                          compact
                          label={item.label}
                          last={index === categoryItems.length - 1}
                          selected={item.value === categoryFilter}
                          onPress={() => selectCategory(item.value)}
                        />
                      ))}
                    </ScrollView>
                  </PopupMenu>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      );
    },
    [
      categoryItems,
      categoryLabel,
      categoryMenu,
      changeLibraryTab,
      changeSourceFilter,
      closeCategoryMenu,
      confirmClearHistory,
      categoryFilter,
      sourceFilter,
      loaded,
      openCategoryMenu,
      onRetryCategories,
      selectCategory,
      sourceItems,
      styles,
      theme,
      historyCountToClear
    ]
  );
  const favoriteHeader = useMemo(() => renderHeader('favorites'), [renderHeader]);
  const historyHeader = useMemo(() => renderHeader('history'), [renderHeader]);
  const userHeader = useMemo(() => renderHeader('users'), [renderHeader]);
  const animatedEmptyTab = !loaded && !error && active ? libraryTab : null;

  const renderEmpty = useCallback(
    (viewportTab: LibraryTab, recordCount: number) => {
      if (!loaded && !error) {
        const animating = viewportTab === animatedEmptyTab;
        return viewportTab === 'users' ? (
          <ContentLoadingPlaceholder label="加载中" animating={animating}>
            {(['43%', '31%', '49%'] as const).map((width) => (
              <View key={width} style={styles.libraryUserRow}>
                <SkeletonBlock style={{ width: 42, height: 42, borderRadius: 21 }} />
                <View style={[styles.flex, { gap: 6 }]}>
                  <SkeletonBlock style={{ width, height: styles.menuLabel.fontSize }} />
                  <SkeletonBlock style={{ width: '58%', height: styles.meta.fontSize }} />
                </View>
              </View>
            ))}
          </ContentLoadingPlaceholder>
        ) : (
          <TopicListPlaceholder label="加载中" animating={animating} />
        );
      }
      return (
        <View
          style={styles.libraryEmpty}
          testID={loaded && viewportTab === 'favorites' && !recordCount ? 'library-favorites-empty' : undefined}
        >
          {error ? (
            <RecoverableEmptyState message="本机资料加载失败" actionLabel="重试" onAction={onRetry} />
          ) : enabledSources.length === 0 ? (
            <RecoverableEmptyState
              message="尚未启用内容源"
              actionLabel="管理内容源"
              onAction={onManageContentSources}
            />
          ) : sourceFilter !== 'all' || categoryFilter !== 'all' ? (
            <RecoverableEmptyState
              message="当前筛选下没有记录"
              actionLabel="清除筛选"
              onAction={() => (sourceFilter === 'all' ? selectCategory('all') : changeSourceFilter('all'))}
            />
          ) : (
            <EmptyText
              text={
                viewportTab === 'users' ? '暂无关注用户' : viewportTab === 'favorites' ? '暂无收藏' : '暂无浏览记录'
              }
            />
          )}
        </View>
      );
    },
    [
      animatedEmptyTab,
      changeSourceFilter,
      categoryFilter,
      sourceFilter,
      enabledSources.length,
      loaded,
      onManageContentSources,
      error,
      onRetry,
      selectCategory,
      styles
    ]
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
  const populatedListFooter = loadingMore ? (
    <LoadingState compact text="加载更多中" />
  ) : error ? (
    <RecoverableEmptyState message="本机资料加载失败" actionLabel="重试读取" onAction={onRetry} />
  ) : undefined;

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
            viewportTab === 'favorites'
              ? loaded
                ? favoriteRecords.length
                  ? '收藏列表，已加载，有收藏'
                  : '收藏列表，已加载，没有收藏'
                : '收藏列表'
              : viewportTab === 'users'
                ? '关注用户列表'
                : '浏览历史列表'
          }
          data={data}
          empty={empty}
          footer={current && data.length > 0 ? populatedListFooter : undefined}
          header={header}
          listRef={viewportRef}
          openedTopicKey={
            viewportTab === 'history' && historyAnchor?.scope === positionScope ? historyAnchor.key : undefined
          }
          renderItem={
            viewportTab === 'favorites'
              ? (renderFavoriteItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
              : viewportTab === 'history'
                ? (renderHistoryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
                : (renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem>)
          }
          styles={styles}
          tab={viewportTab}
          onLoadMore={onLoadMore}
        />
      </View>
    );
  };

  const onPageLayout = useStartupPageLayout();
  return (
    <View style={styles.libraryViewportStack} onLayout={onPageLayout}>
      {renderViewport('favorites')}
      {renderViewport('history')}
      {renderViewport('users')}
    </View>
  );
});
