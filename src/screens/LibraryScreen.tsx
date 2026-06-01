import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { Star } from 'lucide-react-native';
import type { FeedSource, Topic, UserProfile } from '../types';
import { type FollowedUserRecord, type ReaderData, type TopicRecord, userKey } from '../readerData';
import { type LibraryTab } from '../feedLogic';
import { filterLibraryRecords, groupLibraryRecordsByTime, libraryCategoryFilterItems } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { feedSources } from '../feedCategoryRail';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, PillRail } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

function libraryRecordKey(record: TopicRecord) {
  return `${record.topic.source}:${record.topic.id}`;
}

export function LibraryScreen({
  libraryTab,
  categories,
  followedUsers,
  records,
  readerData,
  scrollToTopSignal,
  topicListStateInput,
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
  readerData: ReaderData;
  scrollToTopSignal: number;
  topicListStateInput: NormalizedTopicListStateInput;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserProfile) => void;
  onRemove: (topic: Topic) => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  type LibraryListItem = { type: 'section'; key: string; label: string } | { type: 'record'; key: string; record: TopicRecord };
  const listRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const userRecords = useMemo(() => (
    sourceFilter === 'all'
      ? followedUsers
      : followedUsers.filter((record) => record.user.source === sourceFilter)
  ), [followedUsers, sourceFilter]);
  const categoryItems = useMemo(() => libraryCategoryFilterItems(categories, sourceFilter), [categories, sourceFilter]);
  const filteredRecords = useMemo(() => filterLibraryRecords(records, {
    source: sourceFilter,
    category: categoryFilter
  }), [categoryFilter, records, sourceFilter]);
  const listItems = useMemo<LibraryListItem[]>(() => groupLibraryRecordsByTime(filteredRecords).flatMap((section) => [
    { type: 'section' as const, key: `section:${section.label}`, label: section.label },
    ...section.records.map((record) => ({ type: 'record' as const, key: libraryRecordKey(record), record }))
  ]), [filteredRecords]);
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
  const renderLibraryItem = useCallback<ListRenderItem<LibraryListItem>>(({ item }) => {
    if (item.type === 'section') {
      return <Text style={styles.librarySectionTitle}>{item.label}</Text>;
    }
    const record = item.record;
    return (
      <View style={styles.libraryItem}>
        <View style={styles.libraryTopicRow}>
          <View style={styles.flex}>
            <MemoizedTopicCard
              readerState={getTopicListItemState(readerData, record.topic, topicListStateInput)}
              styles={styles}
              theme={theme}
              topic={record.topic}
              onOpenTopic={onOpenTopic}
            />
          </View>
          {libraryTab === 'favorites' ? (
            <IconButton iconOnly ghost active icon={Star} label="取消收藏" styles={styles} theme={theme} onPress={() => confirmRemoveFavorite(record.topic)} />
          ) : null}
        </View>
        <View style={styles.libraryMetaBlock}>
          <Text style={styles.meta}>保存于 {formatDateTime(record.savedAt) || record.savedAt}{record.visitCount ? ` · ${record.visitCount} 次阅读` : ''}</Text>
        </View>
        {libraryTab === 'history' ? (
          <View style={styles.libraryActionRow}>
            <AppButton compact label="删除" variant="ghost" styles={styles} onPress={() => onRemove(record.topic)} />
          </View>
        ) : null}
      </View>
    );
  }, [confirmRemoveFavorite, libraryTab, onOpenTopic, onRemove, readerData, styles, theme, topicListStateInput]);
  const renderUserItem = useCallback(({ item }: { item: FollowedUserRecord }) => (
    <View style={styles.libraryItem}>
      <Pressable accessibilityRole="button" style={styles.menuButton} onPress={() => onOpenUser(item.user)}>
        <View style={styles.menuIcon}>
          <Text style={styles.replyAvatarText}>{(item.user.displayName || item.user.username || '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.menuLabel} numberOfLines={1}>{item.user.displayName || item.user.username}</Text>
          <Text style={styles.meta} numberOfLines={2}>{sourceLabel(item.user.source)} · 关注于 {formatDateTime(item.followedAt) || item.followedAt}</Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <AppButton compact label="取消关注" variant="ghost" styles={styles} onPress={() => onRemoveUser(item.user)} />
      </View>
    </View>
  ), [onOpenUser, onRemoveUser, styles]);

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>收藏</Text>
        <Text style={styles.meta}>{libraryTab === 'users' ? `${userRecords.length} / ${followedUsers.length} 人` : filteredRecords.length === records.length ? `${records.length} 条` : `${filteredRecords.length} / ${records.length} 条`}</Text>
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
      <View style={styles.actions}>
        {libraryTab === 'history' && records.length ? <AppButton compact label="清空历史" variant="ghost" styles={styles} onPress={onClearHistory} /> : null}
      </View>
    </View>
  );

  return (
    <FlashList
      ref={listRef}
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={libraryTab === 'users' ? userRecords : listItems}
      keyExtractor={(item) => libraryTab === 'users' ? userKey((item as FollowedUserRecord).user) : (item as LibraryListItem).key}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyText text={libraryTab === 'users' ? '这里还没有关注用户' : '这里还没有内容'} styles={styles} />}
      renderItem={libraryTab === 'users' ? renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem> : renderLibraryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>}
    />
  );
}
