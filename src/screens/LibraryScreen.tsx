import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View, type ListRenderItem } from 'react-native';
import type { FeedSource, Topic, UserProfile } from '../types';
import { type FollowedUserRecord, type ReaderData, type TopicRecord, topicKey, userKey } from '../readerData';
import { type LibraryTab } from '../feedLogic';
import { filterLibraryRecords, groupLibraryRecordsByTime, libraryCategoryFilterItems } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { feedSources } from '../feedCategoryRail';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, PillRail } from '../components/AppControls';
import { MemoizedTopicCard, type TopicSwipeActionConfig } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

export type LibraryUndo = {
  section: 'favorites' | 'history';
  records: Record<string, TopicRecord>;
  label: string;
} | null;

function parseTagsInput(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(/[,\s，、]+/)) {
    const clean = part.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      tags.push(clean);
    }
  }
  return tags.slice(0, 12);
}

function libraryRecordKey(record: TopicRecord) {
  return `${record.topic.source}:${record.topic.id}`;
}

export function LibraryScreen({
  libraryTab,
  libraryUndo,
  categories,
  followedUsers,
  records,
  readerData,
  topicListStateInput,
  styles,
  theme,
  onClearHistory,
  onOpenTopic,
  onOpenUser,
  onRemoveMany,
  onRemove,
  onRemoveUser,
  onTabChange,
  onUndoDelete,
  onUpdateRecord
}: {
  libraryTab: LibraryTab;
  libraryUndo: LibraryUndo;
  categories: Parameters<typeof libraryCategoryFilterItems>[1];
  followedUsers: FollowedUserRecord[];
  records: TopicRecord[];
  readerData: ReaderData;
  topicListStateInput: NormalizedTopicListStateInput;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onOpenUser: (user: UserProfile) => void;
  onRemoveMany: (topics: Topic[]) => void;
  onRemove: (topic: Topic) => void;
  onRemoveUser: (user: UserProfile) => void;
  onTabChange: (tab: LibraryTab) => void;
  onUndoDelete: () => void;
  onUpdateRecord: (topic: Topic, patch: Pick<TopicRecord, 'tags' | 'note'>) => void;
}) {
  type LibraryListItem = { type: 'section'; key: string; label: string } | { type: 'record'; key: string; record: TopicRecord };
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [bulkMode, setBulkMode] = useState(false);
  const [rowSwipeActive, setRowSwipeActive] = useState(false);
  const [swipeOpenKey, setSwipeOpenKey] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editingKey, setEditingKey] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const deleteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'delete',
    onPress: onRemove
  }), [onRemove]);
  const userRecords = useMemo(() => (
    sourceFilter === 'all'
      ? followedUsers
      : followedUsers.filter((record) => record.user.source === sourceFilter)
  ), [followedUsers, sourceFilter]);
  const recordsForSource = useMemo(() => (
    sourceFilter === 'all'
      ? records
      : records.filter((record) => record.topic.source === sourceFilter)
  ), [records, sourceFilter]);
  const categoryItems = useMemo(() => libraryCategoryFilterItems(records, categories, sourceFilter), [categories, records, sourceFilter]);
  const tags = useMemo(() => Array.from(new Set(recordsForSource.flatMap((record) => record.tags || []))).sort(), [recordsForSource]);
  const filteredRecords = useMemo(() => filterLibraryRecords(records, {
    source: sourceFilter,
    category: categoryFilter,
    tag: tagFilter
  }), [categoryFilter, records, sourceFilter, tagFilter]);
  const listItems = useMemo<LibraryListItem[]>(() => groupLibraryRecordsByTime(filteredRecords).flatMap((section) => [
    { type: 'section' as const, key: `section:${section.label}`, label: section.label },
    ...section.records.map((record) => ({ type: 'record' as const, key: libraryRecordKey(record), record }))
  ]), [filteredRecords]);
  const recordKeys = useMemo(() => `${records.map(libraryRecordKey).join('|')}|${followedUsers.map((record) => userKey(record.user)).join('|')}`, [followedUsers, records]);
  useEffect(() => {
    setSourceFilter('all');
    setCategoryFilter('all');
    setTagFilter('all');
    setSwipeOpenKey(undefined);
    setRowSwipeActive(false);
  }, [libraryTab]);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryItems.some((item) => item.value === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryItems]);
  useEffect(() => {
    if (tagFilter !== 'all' && !tags.includes(tagFilter)) {
      setTagFilter('all');
    }
  }, [tagFilter, tags]);
  useEffect(() => {
    setSelected(new Set());
    setEditingKey('');
    setSwipeOpenKey(undefined);
    setRowSwipeActive(false);
  }, [categoryFilter, libraryTab, sourceFilter, tagFilter]);
  useEffect(() => {
    setSelected(new Set());
    setEditingKey('');
  }, [recordKeys]);
  const beginEdit = useCallback((record: TopicRecord) => {
    setEditingKey(libraryRecordKey(record));
    setTagInput(record.tags?.join(', ') || '');
    setNoteInput(record.note || '');
  }, []);
  const saveEdit = useCallback((record: TopicRecord) => {
    onUpdateRecord(record.topic, {
      tags: parseTagsInput(tagInput),
      note: noteInput
    });
    setEditingKey('');
  }, [noteInput, onUpdateRecord, tagInput]);
  const toggleSelected = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const removeSelected = useCallback(() => {
    const topics = filteredRecords.filter((record) => selected.has(libraryRecordKey(record))).map((record) => record.topic);
    if (topics.length) {
      onRemoveMany(topics);
      setSelected(new Set());
    }
  }, [filteredRecords, onRemoveMany, selected]);
  const toggleBulkMode = useCallback(() => {
    if (bulkMode) {
      setSelected(new Set());
      setEditingKey('');
    }
    setBulkMode((value) => !value);
  }, [bulkMode]);
  const renderLibraryItem = useCallback<ListRenderItem<LibraryListItem>>(({ item }) => {
    if (item.type === 'section') {
      return <Text style={styles.librarySectionTitle}>{item.label}</Text>;
    }
    const record = item.record;
    const key = libraryRecordKey(record);
    const selectedRecord = selected.has(key);
    const editing = editingKey === key;
    return (
      <View style={styles.libraryItem}>
        {bulkMode ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedRecord }} style={styles.librarySelectRow} onPress={() => toggleSelected(key)}>
            <Text style={styles.pillText}>{selectedRecord ? '已选' : '选择'}</Text>
          </Pressable>
        ) : null}
        <MemoizedTopicCard
          readerState={getTopicListItemState(readerData, record.topic, topicListStateInput)}
          styles={styles}
          theme={theme}
          topic={record.topic}
          onOpenTopic={onOpenTopic}
          swipeAction={bulkMode ? undefined : deleteSwipeAction}
          swipeOpenKey={swipeOpenKey}
          onSwipeActiveChange={setRowSwipeActive}
          onSwipeClose={() => setSwipeOpenKey((current) => current === topicKey(record.topic) ? undefined : current)}
          onSwipeOpen={setSwipeOpenKey}
        />
        <View style={styles.libraryMetaBlock}>
          <Text style={styles.meta}>保存于 {formatDateTime(record.savedAt) || record.savedAt}{record.visitCount ? ` · ${record.visitCount} 次阅读` : ''}</Text>
          {record.tags?.length ? <Text style={styles.meta}>标签：{record.tags.join(', ')}</Text> : null}
          {record.note ? <Text style={styles.meta}>备注：{record.note}</Text> : null}
        </View>
        {editing ? (
          <View style={styles.stack}>
            <TextInput
              style={styles.input}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder="标签，用逗号分隔"
              placeholderTextColor={theme.muted}
            />
            <TextInput
              style={styles.input}
              value={noteInput}
              onChangeText={setNoteInput}
              placeholder="备注"
              placeholderTextColor={theme.muted}
            />
            <View style={styles.actions}>
              <AppButton compact label="保存" styles={styles} onPress={() => saveEdit(record)} />
              <AppButton compact label="取消" variant="ghost" styles={styles} onPress={() => setEditingKey('')} />
            </View>
          </View>
        ) : (
          <View style={styles.actions}>
            <AppButton compact label={record.tags?.length || record.note ? '编辑标签和备注' : '添加标签和备注'} variant="ghost" styles={styles} onPress={() => beginEdit(record)} />
            {!bulkMode ? <AppButton compact label="删除" variant="ghost" styles={styles} onPress={() => onRemove(record.topic)} /> : null}
          </View>
        )}
      </View>
    );
  }, [beginEdit, bulkMode, deleteSwipeAction, editingKey, noteInput, onOpenTopic, onRemove, readerData, saveEdit, selected, styles, swipeOpenKey, tagInput, theme, toggleSelected, topicListStateInput]);
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
        items={[
          { value: 'favorites', label: '帖子' },
          { value: 'users', label: '用户' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
      <PillRail
        items={[
          { value: 'all', label: '来源全部' },
          ...feedSources.map((source) => ({ value: source, label: sourceLabel(source) }))
        ]}
        value={sourceFilter}
        styles={styles}
        onChange={(value) => setSourceFilter(value as FeedSource)}
      />
      {libraryTab !== 'users' && categoryItems.length > 1 ? (
        <PillRail
          items={categoryItems}
          value={categoryFilter}
          styles={styles}
          onChange={setCategoryFilter}
        />
      ) : null}
      {libraryTab !== 'users' && tags.length ? (
        <PillRail
          items={[{ value: 'all', label: '标签筛选' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
          value={tagFilter}
          styles={styles}
          onChange={setTagFilter}
        />
      ) : null}
      <View style={styles.actions}>
        {libraryTab !== 'users' ? <AppButton compact label={bulkMode ? '退出批量' : '批量删除'} variant="ghost" styles={styles} onPress={toggleBulkMode} /> : null}
        {libraryTab !== 'users' && bulkMode && selected.size ? <AppButton compact label={`删除选中 ${selected.size}`} styles={styles} onPress={removeSelected} /> : null}
        {libraryTab === 'history' && records.length ? <AppButton compact label="清空历史" variant="ghost" styles={styles} onPress={onClearHistory} /> : null}
      </View>
      {libraryUndo ? (
        <View style={styles.noticeBox}>
          <Text style={styles.meta}>{libraryUndo.label}</Text>
          <AppButton compact label="撤销删除" variant="ghost" styles={styles} onPress={onUndoDelete} />
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={libraryTab === 'users' ? userRecords : listItems}
      keyExtractor={(item) => libraryTab === 'users' ? userKey((item as FollowedUserRecord).user) : (item as LibraryListItem).key}
      scrollEnabled={!rowSwipeActive}
      onScrollBeginDrag={() => {
        setSwipeOpenKey(undefined);
        setRowSwipeActive(false);
      }}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyText text={libraryTab === 'users' ? '这里还没有关注用户' : '这里还没有内容'} styles={styles} />}
      renderItem={libraryTab === 'users' ? renderUserItem as ListRenderItem<FollowedUserRecord | LibraryListItem> : renderLibraryItem as ListRenderItem<FollowedUserRecord | LibraryListItem>}
    />
  );
}
