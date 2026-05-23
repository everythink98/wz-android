import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View, type ListRenderItem } from 'react-native';
import type { FeedSource, Source, Topic } from '../types';
import { type ReaderData, type TopicRecord } from '../readerData';
import { type LibraryTab } from '../feedLogic';
import { filterLibraryRecords, groupLibraryRecordsByTime } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, PillRail } from '../components/AppControls';
import { MemoizedTopicCard, type TopicSwipeActionConfig } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

const sources: Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];

export type LibraryUndo = {
  section: LibraryTab;
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
  records,
  readerData,
  topicListStateInput,
  styles,
  theme,
  onClearHistory,
  onOpenTopic,
  onRemoveMany,
  onRemove,
  onTabChange,
  onUndoDelete,
  onUpdateRecord
}: {
  libraryTab: LibraryTab;
  libraryUndo: LibraryUndo;
  records: TopicRecord[];
  readerData: ReaderData;
  topicListStateInput: NormalizedTopicListStateInput;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onRemoveMany: (topics: Topic[]) => void;
  onRemove: (topic: Topic) => void;
  onTabChange: (tab: LibraryTab) => void;
  onUndoDelete: () => void;
  onUpdateRecord: (topic: Topic, patch: Pick<TopicRecord, 'tags' | 'note'>) => void;
}) {
  type LibraryListItem = { type: 'section'; key: string; label: string } | { type: 'record'; key: string; record: TopicRecord };
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editingKey, setEditingKey] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const deleteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'delete',
    onPress: onRemove
  }), [onRemove]);
  const categories = useMemo(() => Array.from(new Set(records.map((record) => record.topic.category).filter(Boolean) as string[])), [records]);
  const tags = useMemo(() => Array.from(new Set(records.flatMap((record) => record.tags || []))).sort(), [records]);
  const filteredRecords = useMemo(() => filterLibraryRecords(records, {
    source: sourceFilter,
    category: categoryFilter,
    tag: tagFilter
  }), [categoryFilter, records, sourceFilter, tagFilter]);
  const listItems = useMemo<LibraryListItem[]>(() => groupLibraryRecordsByTime(filteredRecords).flatMap((section) => [
    { type: 'section' as const, key: `section:${section.label}`, label: section.label },
    ...section.records.map((record) => ({ type: 'record' as const, key: libraryRecordKey(record), record }))
  ]), [filteredRecords]);
  const recordKeys = useMemo(() => records.map(libraryRecordKey).join('|'), [records]);
  useEffect(() => {
    setSourceFilter('all');
    setCategoryFilter('all');
    setTagFilter('all');
  }, [libraryTab]);
  useEffect(() => {
    setSelected(new Set());
    setEditingKey('');
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
  }, [beginEdit, bulkMode, deleteSwipeAction, editingKey, noteInput, onOpenTopic, onRemove, readerData, saveEdit, selected, styles, tagInput, theme, toggleSelected, topicListStateInput]);

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>收藏</Text>
        <Text style={styles.meta}>{filteredRecords.length === records.length ? `${records.length} 条` : `${filteredRecords.length} / ${records.length} 条`}</Text>
      </View>
      <PillRail
        items={[
          { value: 'favorites', label: '收藏' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
      <PillRail
        items={[
          { value: 'all', label: '来源全部' },
          ...sources.map((source) => ({ value: source, label: sourceLabel(source) }))
        ]}
        value={sourceFilter}
        styles={styles}
        onChange={(value) => setSourceFilter(value as FeedSource)}
      />
      {categories.length ? (
        <PillRail
          items={[{ value: 'all', label: '节点全部' }, ...categories.map((category) => ({ value: category, label: category }))]}
          value={categoryFilter}
          styles={styles}
          onChange={setCategoryFilter}
        />
      ) : null}
      {tags.length ? (
        <PillRail
          items={[{ value: 'all', label: '标签筛选' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
          value={tagFilter}
          styles={styles}
          onChange={setTagFilter}
        />
      ) : null}
      <View style={styles.actions}>
        <AppButton compact label={bulkMode ? '退出批量' : '批量删除'} variant="ghost" styles={styles} onPress={toggleBulkMode} />
        {bulkMode && selected.size ? <AppButton compact label={`删除选中 ${selected.size}`} styles={styles} onPress={removeSelected} /> : null}
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
      data={listItems}
      keyExtractor={(item) => item.key}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyText text="这里还没有内容" styles={styles} />}
      renderItem={renderLibraryItem}
    />
  );
}
