import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Star, Trash2, type LucideIcon } from 'lucide-react-native';
import type { FeedSource, Topic, UserProfile } from '../types';
import { type FollowedUserRecord, type TopicRecord } from '../readerData';
import { type LibraryTab } from '../feedLogic';
import { filterLibraryRecords, libraryCategoryFilterItems } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { feedSources } from '../feedCategoryRail';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, PillRail, TOUCH_HIT_SLOP, triggerPressFeedback } from '../components/AppControls';
import { avatarInitial } from '../components/Avatar';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import {
  createLibraryListItems,
  filterFollowedUsersBySource,
  libraryCountLabel,
  libraryDataItemKey,
  libraryDataItemType,
  type LibraryDataItem,
  type LibraryListItem
} from './library/libraryScreenItems';

function pressLibraryAction(event: GestureResponderEvent, onPress: () => void) {
  event.stopPropagation?.();
  triggerPressFeedback();
  onPress();
}

function LibraryRowAction({
  label,
  styles,
  onPress
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
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
  tone?: 'primary' | 'danger';
  filled?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const color = tone === 'danger' ? theme.danger : theme.primary;
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

export function LibraryScreen({
  libraryTab,
  categories,
  followedUsers,
  records,
  scrollToTopSignal,
  topicStateIndex,
  styles,
  theme,
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
  records: TopicRecord[];
  scrollToTopSignal: number;
  topicStateIndex: TopicListItemStateIndex;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserProfile) => void;
  onRemove: (topic: Topic) => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const listRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const userRecords = useMemo(() => filterFollowedUsersBySource(followedUsers, sourceFilter), [followedUsers, sourceFilter]);
  const categoryItems = useMemo(() => libraryCategoryFilterItems(categories, sourceFilter), [categories, sourceFilter]);
  const filteredRecords = useMemo(() => filterLibraryRecords(records, {
    source: sourceFilter,
    category: categoryFilter
  }), [categoryFilter, records, sourceFilter]);
  const listItems = useMemo<LibraryListItem[]>(() => createLibraryListItems(filteredRecords), [filteredRecords]);
  useEffect(() => {
    setSourceFilter('all');
    setCategoryFilter('all');
  }, [libraryTab]);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryItems.some((item) => item.value === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryItems]);
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [scrollToTopSignal]);
  const confirmRemoveFavorite = useCallback((topic: Topic) => {
    Alert.alert('确定取消收藏吗？', topic.title || '这条收藏将从本机移除。', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: () => onRemove(topic) }
    ]);
  }, [onRemove]);
  const confirmClearHistory = useCallback(() => {
    Alert.alert('清空历史？', '清空后无法恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: onClearHistory }
    ]);
  }, [onClearHistory]);
  const renderTopicTrailingAction = useCallback((topic: Topic) => {
    if (libraryTab === 'favorites') {
      return <LibraryIconAction filled icon={Star} label="取消收藏" styles={styles} theme={theme} onPress={() => confirmRemoveFavorite(topic)} />;
    }
    if (libraryTab === 'history') {
      return <LibraryIconAction icon={Trash2} label="删除" tone="danger" styles={styles} theme={theme} onPress={() => onRemove(topic)} />;
    }
    return null;
  }, [confirmRemoveFavorite, libraryTab, onRemove, styles, theme]);
  const renderLibraryItem = useCallback<ListRenderItem<LibraryListItem>>(({ item }) => {
    if (item.type === 'section') {
      return <Text style={[styles.librarySectionTitle, item.first && styles.libraryFirstSectionTitle]}>{item.label}</Text>;
    }
    const record = item.record;
    return (
      <View style={styles.libraryItem}>
        <MemoizedTopicCard
          readerState={getTopicListItemStateFromIndex(topicStateIndex, record.topic)}
          styles={styles}
          theme={theme}
          renderTrailingAction={renderTopicTrailingAction}
          topic={record.topic}
          onOpenTopic={onOpenTopic}
        />
      </View>
    );
  }, [onOpenTopic, renderTopicTrailingAction, styles, theme, topicStateIndex]);
  const renderUserItem = useCallback(({ item }: { item: FollowedUserRecord }) => (
    <View style={styles.libraryUserRow}>
      <Pressable accessibilityRole="button" style={[styles.menuButton, styles.libraryUserButton]} onPress={() => onOpenUser(item.user)}>
        <View style={styles.menuIcon}>
          <Text style={styles.replyAvatarText}>{avatarInitial(item.user.displayName || item.user.username)}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.menuLabel} numberOfLines={1}>{item.user.displayName || item.user.username}</Text>
          <Text style={styles.meta} numberOfLines={2}>{sourceLabel(item.user.source)} · 关注于 {formatDateTime(item.followedAt) || item.followedAt}</Text>
        </View>
      </Pressable>
      <View style={styles.libraryUserAction}>
        <LibraryRowAction label="取消关注" styles={styles} onPress={() => onRemoveUser(item.user)} />
      </View>
    </View>
  ), [onOpenUser, onRemoveUser, styles]);

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>收藏</Text>
        <Text style={styles.meta}>{libraryCountLabel({ filteredRecords, followedUsers, libraryTab, records, userRecords })}</Text>
      </View>
      <PillRail
        variant="tabs"
        items={[
          { value: 'favorites', label: '帖子' },
          { value: 'users', label: '关注用户' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
      <PillRail
        variant="subtabs"
        items={[
          { value: 'all', label: '全部' },
          ...feedSources.map((source) => ({ value: source, label: sourceLabel(source) }))
        ]}
        value={sourceFilter}
        styles={styles}
        onChange={(value) => setSourceFilter(value as FeedSource)}
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
  );

  return (
    <FlashList
      key={libraryTab}
      ref={listRef}
      style={styles.content}
      contentContainerStyle={styles.libraryContentInner}
      data={libraryTab === 'users' ? userRecords : listItems}
      keyExtractor={(item) => libraryDataItemKey(item as LibraryDataItem, libraryTab)}
      getItemType={(item) => libraryDataItemType(item as LibraryDataItem, libraryTab)}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyText text={libraryTab === 'users' ? '这里还没有关注用户' : '这里还没有内容'} styles={styles} />}
      renderItem={libraryTab === 'users' ? renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem> : renderLibraryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>}
    />
  );
}
