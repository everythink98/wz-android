import { useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Button, Chip, List, Searchbar } from 'react-native-paper';
import { CheckCircle2, CheckSquare2, Circle, Search, Square, X } from 'lucide-react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { TopicTag } from '@/domain/forum/topicComposer';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import type { useTopicComposerController } from './useTopicComposerController';
import type { useTopicTagSearch } from './useTopicTagSearch';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    root: { flexShrink: 1, gap: 8 },
    search: { backgroundColor: theme.surface2, borderRadius: 12 },
    input: {
      minHeight: 48,
      fontSize: 14 * settings.fontScale,
      fontFamily,
      includeFontPadding: false,
      textAlignVertical: 'center'
    },
    text: {
      color: theme.ink,
      fontSize: 14 * settings.fontScale,
      lineHeight: 20 * settings.fontScale,
      fontFamily,
      letterSpacing: 0,
      includeFontPadding: false
    },
    muted: {
      color: theme.muted,
      fontSize: 12 * settings.fontScale,
      lineHeight: 18 * settings.fontScale,
      fontFamily,
      letterSpacing: 0,
      includeFontPadding: false
    },
    error: { color: theme.danger, fontSize: 13 * settings.fontScale, fontFamily },
    list: { flex: 1 },
    row: { paddingVertical: 0, paddingRight: 16, marginBottom: 4, borderRadius: 10 },
    rowContainer: { minHeight: 48, marginVertical: 0, paddingVertical: 8, alignItems: 'center' },
    selected: { backgroundColor: theme.primarySoft },
    selectedText: { color: theme.primary, fontWeight: '600' },
    disabledText: { color: theme.muted },
    check: { width: 24, alignItems: 'center', alignSelf: 'center' },
    chips: { flexGrow: 0, flexShrink: 0 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    chip: { minHeight: 48, justifyContent: 'center', backgroundColor: theme.primarySoft },
    chipText: { marginRight: 22 },
    chipClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    empty: { paddingVertical: 24, textAlign: 'center' },
    footer: { borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
    done: { minHeight: 48, justifyContent: 'center' }
  });
}

export function TopicSelectionPanel({
  mode,
  controller: c,
  query,
  onQueryChange,
  error,
  hint,
  tagSearch,
  onSelectCategory,
  onClose
}: {
  mode: 'categories' | 'tags';
  controller: ReturnType<typeof useTopicComposerController>;
  query: string;
  onQueryChange: (query: string) => void;
  error?: string;
  hint?: string;
  tagSearch: ReturnType<typeof useTopicTagSearch>;
  onSelectCategory: () => void;
  onClose: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { height } = useWindowDimensions();
  const { draft, context } = c;
  const { result: tagResult, rulesCurrent: tagRulesCurrent, error: tagSearchError } = tagSearch;
  const categoryNames = useMemo(
    () =>
      new Map<string | undefined, string>(
        context?.categories.map((category) => [category.id, category.name] as const).reverse()
      ),
    [context?.categories]
  );
  if (mode === 'tags' && !draft?.categoryId) {
    return (
      <View style={styles.root}>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          请先选择版块，再选择标签
        </Text>
        <Button disabled={c.busy} onPress={onSelectCategory}>
          先选择版块
        </Button>
      </View>
    );
  }
  const tags = draft?.source === 'linuxdo' ? draft.tags : [];
  const maxTags = context?.source === 'linuxdo' ? context.maxTags : 0;
  const categories = context?.categories || [];
  const term = query.trim().toLocaleLowerCase();
  const changeTag = (tag: TopicTag) =>
    c.change((value) => {
      if (value.source !== 'linuxdo' || c.busy) return value;
      const selected = value.tags.some((item) => item.name === tag.name);
      if (!selected && value.tags.length >= maxTags) return value;
      return { ...value, tags: selected ? value.tags.filter((item) => item.name !== tag.name) : [...value.tags, tag] };
    });
  const canCreate =
    tagRulesCurrent &&
    context?.source === 'linuxdo' &&
    context.canCreateTag &&
    tagResult &&
    !tagResult.forbidden &&
    !tagResult.forbiddenMessage &&
    query.trim() &&
    tags.length < maxTags &&
    ![...tags, ...tagResult.tags].some((tag) => tag.name === query.trim());
  const loading = mode === 'tags' && tagSearch.loading;
  const requiredGroupHint =
    tagRulesCurrent && tagResult?.requiredGroup
      ? `请从 ${tagResult.requiredGroup.name} 选择至少 ${tagResult.requiredGroup.minCount} 个标签`
      : '';
  const showRequiredGroup =
    requiredGroupHint &&
    ![hint, error].some((message) => message?.replace(/\s/g, '') === requiredGroupHint.replace(/\s/g, ''));
  return (
    <View style={[styles.root, { height: height * 0.62 }]}>
      <Searchbar
        accessibilityLabel={mode === 'categories' ? '搜索版块' : '搜索标签'}
        placeholder={mode === 'categories' ? '搜索版块' : '搜索标签'}
        searchAccessibilityLabel="搜索"
        clearAccessibilityLabel="清空搜索"
        icon={({ size, color }) => <Search size={size} color={color} />}
        clearIcon={({ size, color }) => <X size={size} color={color} />}
        value={query}
        onChangeText={onQueryChange}
        editable={!c.busy}
        loading={loading}
        elevation={0}
        style={styles.search}
        inputStyle={styles.input}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      {mode === 'categories' ? (
        <FlatList
          style={styles.list}
          data={
            term
              ? categories.filter((item) =>
                  [item.name, categoryNames.get(item.parentId) || ''].some((name) =>
                    name.toLocaleLowerCase().includes(term)
                  )
                )
              : categories
          }
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>没有匹配的版块</Text>}
          renderItem={({ item }) => {
            const selected = item.id === draft?.categoryId;
            const disabled = c.busy || item.canCreate === false;
            const description = [
              categoryNames.get(item.parentId),
              item.canCreate === false ? '当前账号不可发帖' : item.minimumTags ? `至少 ${item.minimumTags} 个标签` : ''
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <List.Item
                title={item.name}
                description={description || undefined}
                titleNumberOfLines={2}
                titleStyle={[styles.text, selected && styles.selectedText, disabled && styles.disabledText]}
                descriptionStyle={styles.muted}
                accessibilityRole="radio"
                accessibilityLabel={`选择版块 ${item.name}`}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                style={[styles.row, selected && styles.selected]}
                containerStyle={styles.rowContainer}
                right={() => (
                  <View style={styles.check}>
                    {selected ? (
                      <CheckCircle2 size={22} color={theme.primary} />
                    ) : (
                      <Circle size={22} color={theme.muted} />
                    )}
                  </View>
                )}
                onPress={() => {
                  void c.changeCategory(item.id);
                  onClose();
                }}
              />
            );
          }}
        />
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            已选 {tags.length} / {maxTags}
            {tags.length >= maxTags ? ' · 已达上限，可移除后重新选择' : ''}
          </Text>
          {tags.length ? (
            <ScrollView
              horizontal
              style={styles.chips}
              contentContainerStyle={styles.chipRow}
              keyboardShouldPersistTaps="handled"
            >
              {tags.map((tag) => (
                <Chip
                  key={tag.name}
                  accessibilityLabel={`移除标签 ${tag.name}`}
                  disabled={c.busy}
                  onPress={() => changeTag(tag)}
                  onClose={() => changeTag(tag)}
                  closeIconAccessibilityLabel={`移除已选标签 ${tag.name}`}
                  closeIcon={({ size, color }) => (
                    <View style={styles.chipClose}>
                      <X size={size} color={color} />
                    </View>
                  )}
                  style={styles.chip}
                  textStyle={[styles.text, styles.chipText]}
                >
                  {tag.name}
                </Chip>
              ))}
            </ScrollView>
          ) : null}
          {loading && !tagResult ? (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              正在读取可用标签…
            </Text>
          ) : null}
          {tagSearchError ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {tagSearchError}
              </Text>
              <Button disabled={c.busy} onPress={tagSearch.retry}>
                重试读取标签
              </Button>
            </>
          ) : null}
          {tagRulesCurrent && (tagResult?.forbidden || tagResult?.forbiddenMessage) ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {tagResult.forbiddenMessage || `此标签不可创建：${tagResult.forbidden}`}
            </Text>
          ) : null}
          {showRequiredGroup ? <Text style={styles.muted}>{requiredGroupHint}</Text> : null}
          <FlatList
            style={styles.list}
            data={tagResult?.tags || []}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(tag) => tag.name}
            ListEmptyComponent={
              tagResult && !loading && !tagSearchError && !canCreate ? (
                <Text style={[styles.muted, styles.empty]}>没有可选标签，请调整搜索词</Text>
              ) : null
            }
            renderItem={({ item }) => {
              const selected = tags.some((tag) => tag.name === item.name);
              const disabled = c.busy || (!selected && tags.length >= maxTags);
              const Icon = selected ? CheckSquare2 : Square;
              return (
                <List.Item
                  title={item.name}
                  titleStyle={[styles.text, selected && styles.selectedText, disabled && styles.disabledText]}
                  titleNumberOfLines={2}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`标签 ${item.name}`}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  style={[styles.row, selected && styles.selected]}
                  containerStyle={styles.rowContainer}
                  right={() => (
                    <View style={styles.check}>
                      <Icon size={22} color={selected ? theme.primary : theme.muted} />
                    </View>
                  )}
                  onPress={() => changeTag(item)}
                />
              );
            }}
            ListFooterComponent={
              canCreate ? (
                <Button
                  accessibilityLabel={`创建标签“${query.trim()}”`}
                  disabled={c.busy}
                  onPress={() => {
                    changeTag({ name: query.trim() });
                    onQueryChange('');
                  }}
                >
                  创建标签“{query.trim()}”
                </Button>
              ) : null
            }
          />
          <View style={styles.footer}>
            <Button
              mode="contained"
              disabled={c.busy}
              onPress={onClose}
              contentStyle={styles.done}
              labelStyle={[styles.text, { color: theme.onPrimary }]}
            >
              完成
            </Button>
          </View>
        </>
      )}
    </View>
  );
}
