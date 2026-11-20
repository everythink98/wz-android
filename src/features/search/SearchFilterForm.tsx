import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { Category } from '@/domain/forum/models';
import {
  discourseSearchStatusItems,
  discourseVisitedItems,
  isDiscourseSearchFilter,
  searchTimeRangeItems,
  type DiscourseSearchFilter,
  type DiscourseSearchFilterError,
  type DiscourseVisitedFilter,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import {
  FilterFieldRow,
  FilterOptionRow,
  FilterSegments,
  FilterTextField,
  type FilterAppearance,
  type FilterOption
} from './SearchFilterControls';

export type LocalFilterPage = 'time' | 'category' | 'visited' | 'status' | 'date' | 'posts' | 'views';
export type SearchFilterPage = 'main' | LocalFilterPage | 'nodes' | 'tags' | 'author';

export const filterPageTitles = {
  time: '时间',
  category: '选择分类',
  nodes: '选择节点',
  visited: '回访范围',
  status: '话题状态',
  date: '精确日期',
  posts: '帖子数范围',
  views: '浏览量范围',
  tags: '选择标签',
  author: '选择发帖人'
} satisfies Record<Exclude<SearchFilterPage, 'main'>, string>;

type DraftControls = FilterAppearance & {
  draftFilter: SourceSearchFilter;
  updateDraft: (partial: Partial<SourceSearchFilter>) => void;
};

function textForOption<Value extends string>(items: readonly FilterOption<Value>[], value: Value) {
  return items.find((item) => item.value === value)?.label ?? value;
}

function rangeLabel(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `至少 ${min}`;
  if (max !== null) return `至多 ${max}`;
  return '不限';
}

function exactDateLabel(filter: DiscourseSearchFilter) {
  return `${filter.date} ${filter.dateRelation === 'after' ? '之后' : '之前'}`;
}

export function hasAdvancedSearchFilters(filter: SourceSearchFilter) {
  if (filter.source === 'v2ex') return Boolean(filter.username.trim() || filter.operator === 'and');
  return Boolean(
    isDiscourseSearchFilter(filter) &&
    (filter.username.trim() ||
      filter.visited.length ||
      filter.status ||
      filter.date.trim() ||
      filter.minPosts !== null ||
      filter.maxPosts !== null ||
      filter.minViews !== null ||
      filter.maxViews !== null ||
      filter.expertResponse)
  );
}

export function SearchFilterForm({
  authorDisplayName,
  categoryNames,
  draftFilter,
  moreVisible,
  onMoreVisibleChange,
  openPage,
  styles,
  theme,
  toggleTag,
  updateDraft
}: DraftControls & {
  authorDisplayName?: string;
  categoryNames: ReadonlyMap<string, string>;
  moreVisible: boolean;
  onMoreVisibleChange: (visible: boolean) => void;
  openPage: (page: Exclude<SearchFilterPage, 'main'>) => void;
  toggleTag: (name: string) => void;
}) {
  const appearance = { styles, theme };
  const advancedSet = hasAdvancedSearchFilters(draftFilter);
  const v2ex = draftFilter.source === 'v2ex';
  const discourse = isDiscourseSearchFilter(draftFilter);
  const MoreChevron = moreVisible ? ChevronUp : ChevronDown;

  return (
    <>
      {v2ex ? (
        <FilterSegments
          {...appearance}
          label="排序"
          value={draftFilter.sort}
          items={[
            { value: 'relevance', label: '相关' },
            { value: 'time', label: '最新' }
          ]}
          onChange={(sort) => updateDraft({ sort })}
        />
      ) : null}
      {discourse ? (
        <>
          <FilterSegments
            {...appearance}
            label="排序"
            value={draftFilter.order}
            items={[
              { value: 'relevance', label: '相关' },
              { value: 'latest', label: '最新' }
            ]}
            onChange={(order) => updateDraft({ order })}
          />
          <FilterSegments
            {...appearance}
            label="搜索范围"
            value={draftFilter.scope}
            items={[
              { value: 'all', label: '全文' },
              { value: 'title', label: '标题' }
            ]}
            onChange={(scope) => updateDraft({ scope })}
          />
        </>
      ) : null}
      {draftFilter.source === 'nodeseek' ? (
        <FilterSegments
          {...appearance}
          label="排序"
          value={draftFilter.sort}
          items={[
            { value: 'replyTime', label: '新评论' },
            { value: 'postTime', label: '新帖子' }
          ]}
          onChange={(sort) => updateDraft({ sort })}
        />
      ) : null}
      {v2ex || discourse ? (
        <FilterFieldRow
          {...appearance}
          field="时间"
          label="选择时间范围"
          testID="search-filter-time"
          value={
            discourse && draftFilter.date
              ? exactDateLabel(draftFilter)
              : textForOption(searchTimeRangeItems, draftFilter.timeRange)
          }
          active={draftFilter.timeRange !== 'all' || (discourse && Boolean(draftFilter.date))}
          onPress={() => openPage('time')}
        />
      ) : null}
      {v2ex ? (
        <FilterFieldRow
          {...appearance}
          field="节点"
          label="选择节点"
          testID="search-filter-node"
          value={categoryNames.get(draftFilter.node) || draftFilter.node || '全部节点'}
          active={Boolean(draftFilter.node)}
          clear={draftFilter.node ? { label: '清除节点', onPress: () => updateDraft({ node: '' }) } : undefined}
          onPress={() => openPage('nodes')}
        />
      ) : (
        <FilterFieldRow
          {...appearance}
          field={draftFilter.source === 'yaohuo' ? '版块' : '分类'}
          label={draftFilter.source === 'yaohuo' ? '选择版块' : '选择分类'}
          value={categoryNames.get(draftFilter.category) || draftFilter.category || '全部分类'}
          active={Boolean(draftFilter.category && draftFilter.category !== '0')}
          clear={
            draftFilter.category && draftFilter.category !== '0'
              ? {
                  label: draftFilter.source === 'yaohuo' ? '清除版块' : '清除分类',
                  onPress: () => updateDraft({ category: draftFilter.source === 'yaohuo' ? '0' : '' })
                }
              : undefined
          }
          onPress={() => openPage('category')}
        />
      )}
      {discourse ? (
        <>
          <FilterFieldRow
            {...appearance}
            field="标签"
            label="选择标签"
            value={draftFilter.tags.join('、') || '不限'}
            active={draftFilter.tags.length > 0}
            clear={
              draftFilter.tags.length === 1
                ? { label: `移除标签 ${draftFilter.tags[0]}`, onPress: () => toggleTag(draftFilter.tags[0]) }
                : undefined
            }
            onPress={() => openPage('tags')}
          />
          {draftFilter.tags.length >= 2 ? (
            <FilterOptionRow
              {...appearance}
              checked={draftFilter.tagMatch === 'all'}
              label="匹配全部标签"
              role="checkbox"
              onPress={() => updateDraft({ tagMatch: draftFilter.tagMatch === 'all' ? 'any' : 'all' })}
            />
          ) : null}
        </>
      ) : null}
      {v2ex || discourse ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${moreVisible ? '收起' : '展开'}${v2ex ? ' V2EX ' : ''}更多筛选${!v2ex && advancedSet ? '，已设置' : ''}`}
          accessibilityState={{ expanded: moreVisible }}
          style={styles.searchFilterRow}
          onPress={() => onMoreVisibleChange(!moreVisible)}
        >
          <Text style={[styles.searchFilterLabel, styles.flex]}>
            更多筛选{advancedSet && !moreVisible ? ' · 已设置' : ''}
          </Text>
          <View style={styles.searchFilterTrailing}>
            <MoreChevron size={17} color={theme.muted} strokeWidth={1.8} accessible={false} />
          </View>
        </Pressable>
      ) : null}
      {v2ex && moreVisible ? (
        <>
          <FilterTextField
            {...appearance}
            field="作者"
            id="search-filter-input-v2ex-author"
            placeholder="V2EX 用户名"
            value={draftFilter.username}
            onChange={(username) => updateDraft({ username })}
          />
          <FilterSegments
            {...appearance}
            label="关键词关系"
            value={draftFilter.operator}
            items={[
              { value: 'or', label: '任一关键词' },
              { value: 'and', label: '全部关键词' }
            ]}
            onChange={(operator) => updateDraft({ operator })}
          />
        </>
      ) : null}
      {discourse && moreVisible ? (
        <>
          <FilterFieldRow
            {...appearance}
            field="发帖人"
            label="选择作者"
            value={authorDisplayName || draftFilter.username || '不限'}
            active={Boolean(draftFilter.username)}
            clear={
              draftFilter.username
                ? {
                    label: `移除作者 ${authorDisplayName || draftFilter.username}`,
                    onPress: () => updateDraft({ username: '' })
                  }
                : undefined
            }
            onPress={() => openPage('author')}
          />
          <FilterFieldRow
            {...appearance}
            field="回访范围"
            label="选择回访范围"
            value={
              discourseVisitedItems
                .filter((item) => draftFilter.visited.includes(item.value))
                .map((item) => item.label)
                .join('、') || '不限'
            }
            active={draftFilter.visited.length > 0}
            onPress={() => openPage('visited')}
          />
          <FilterFieldRow
            {...appearance}
            field="话题状态"
            label="选择话题状态"
            value={textForOption(discourseSearchStatusItems, draftFilter.status)}
            active={Boolean(draftFilter.status)}
            onPress={() => openPage('status')}
          />
          <FilterFieldRow
            {...appearance}
            field="精确日期"
            label="设置精确日期"
            value={draftFilter.date ? exactDateLabel(draftFilter) : '不限'}
            active={Boolean(draftFilter.date)}
            clear={draftFilter.date ? { label: '清除精确日期', onPress: () => updateDraft({ date: '' }) } : undefined}
            onPress={() => openPage('date')}
          />
          <FilterFieldRow
            {...appearance}
            field="帖子数范围"
            label="设置帖子数范围"
            value={rangeLabel(draftFilter.minPosts, draftFilter.maxPosts)}
            active={draftFilter.minPosts !== null || draftFilter.maxPosts !== null}
            onPress={() => openPage('posts')}
          />
          <FilterFieldRow
            {...appearance}
            field="浏览量范围"
            label="设置浏览量范围"
            value={rangeLabel(draftFilter.minViews, draftFilter.maxViews)}
            active={draftFilter.minViews !== null || draftFilter.maxViews !== null}
            onPress={() => openPage('views')}
          />
          <FilterOptionRow
            {...appearance}
            checked={draftFilter.expertResponse}
            label="有专家回应"
            role="checkbox"
            onPress={() => updateDraft({ expertResponse: !draftFilter.expertResponse })}
          />
        </>
      ) : null}
    </>
  );
}

export function SearchFilterChoices({
  categories,
  categoryNames,
  categoryQuery,
  draftFilter,
  error,
  page,
  styles,
  theme,
  onReturn,
  toggleVisited,
  updateDraft
}: DraftControls & {
  categories: Category[];
  categoryNames: ReadonlyMap<string, string>;
  categoryQuery: string;
  error: DiscourseSearchFilterError | null;
  page: LocalFilterPage;
  onReturn: () => void;
  toggleVisited: (value: DiscourseVisitedFilter) => void;
}) {
  const appearance = { styles, theme };
  const choose = (partial: Partial<SourceSearchFilter>) => {
    updateDraft(partial);
    onReturn();
  };

  if (page === 'category' && 'category' in draftFilter) {
    const allValue = draftFilter.source === 'yaohuo' ? '0' : '';
    const allLabel = categoryNames.get(allValue) ?? '全部分类';
    const field = draftFilter.source === 'yaohuo' ? '版块' : '分类';
    const query = categoryQuery.trim().toLowerCase();
    const options = categories.flatMap((category) => {
      const parent = category.parentId ? categoryNames.get(category.parentId) : undefined;
      const title = parent ? `${parent} / ${category.name}` : category.name;
      if (query && !`${title} ${category.slug ?? ''}`.toLowerCase().includes(query)) return [];
      return [{ category, title }];
    });
    return (
      <>
        <FilterOptionRow
          {...appearance}
          title={allLabel}
          label={`${field} ${allLabel}`}
          checked={draftFilter.category === allValue}
          onPress={() => choose({ category: allValue })}
        />
        {query && !options.length ? <Text style={styles.searchFilterDetail}>没有匹配{field}</Text> : null}
        {options.map(({ category, title }) => (
          <FilterOptionRow
            {...appearance}
            key={category.id}
            title={title}
            label={`${field} ${title}`}
            detail={[
              category.readRestricted ? '受限分类' : '',
              category.topicCount === undefined ? '' : `${category.topicCount} 个主题`
            ]
              .filter(Boolean)
              .join(' · ')}
            checked={draftFilter.category === category.id}
            onPress={() => choose({ category: category.id })}
          />
        ))}
      </>
    );
  }
  if (page === 'time' && 'timeRange' in draftFilter) {
    const exact = isDiscourseSearchFilter(draftFilter) && draftFilter.date;
    return (
      <>
        {searchTimeRangeItems.map(({ label, value }) => (
          <FilterOptionRow
            {...appearance}
            key={value}
            checked={!exact && draftFilter.timeRange === value}
            label={label}
            onPress={() =>
              choose(isDiscourseSearchFilter(draftFilter) ? { timeRange: value, date: '' } : { timeRange: value })
            }
          />
        ))}
      </>
    );
  }
  if (!isDiscourseSearchFilter(draftFilter)) return null;

  switch (page) {
    case 'visited':
      return discourseVisitedItems.map(({ label, value }) => (
        <FilterOptionRow
          {...appearance}
          key={value}
          checked={draftFilter.visited.includes(value)}
          label={label}
          role="checkbox"
          onPress={() => toggleVisited(value)}
        />
      ));
    case 'status':
      return discourseSearchStatusItems.map(({ label, value }) => (
        <FilterOptionRow
          {...appearance}
          key={value}
          checked={draftFilter.status === value}
          label={label}
          onPress={() => choose({ status: value })}
        />
      ));
    case 'date':
      return (
        <ExactDateFields
          {...appearance}
          draftFilter={draftFilter}
          error={error?.field === 'date' ? error.message : undefined}
          updateDraft={updateDraft}
        />
      );
    case 'posts':
      return (
        <NumericRangeFields
          {...appearance}
          name="帖子数"
          kind="posts"
          draftFilter={draftFilter}
          error={error}
          updateDraft={updateDraft}
        />
      );
    case 'views':
      return (
        <NumericRangeFields
          {...appearance}
          name="浏览量"
          kind="views"
          draftFilter={draftFilter}
          error={error}
          updateDraft={updateDraft}
        />
      );
    default:
      return null;
  }
}

function ExactDateFields({
  draftFilter,
  error,
  styles,
  theme,
  updateDraft
}: DraftControls & { draftFilter: DiscourseSearchFilter; error?: string }) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const today = new Date();
  const draftDate = draftFilter.date && !error ? new Date(`${draftFilter.date.trim()}T12:00:00`) : today;
  return (
    <>
      <FilterSegments
        styles={styles}
        theme={theme}
        label="日期关系"
        value={draftFilter.dateRelation}
        items={[
          { value: 'after', label: '之后' },
          { value: 'before', label: '之前' }
        ]}
        onChange={(dateRelation) => updateDraft({ dateRelation })}
      />
      <FilterFieldRow
        styles={styles}
        theme={theme}
        field="日期"
        label="选择精确日期"
        error={error}
        value={draftFilter.date || '选择日期'}
        active={Boolean(draftFilter.date)}
        clear={draftFilter.date ? { label: '清除精确日期', onPress: () => updateDraft({ date: '' }) } : undefined}
        onPress={() => setPickerVisible(true)}
      />
      {pickerVisible ? (
        <DateTimePicker
          value={Number.isNaN(draftDate.getTime()) ? today : draftDate}
          mode="date"
          onDismiss={() => setPickerVisible(false)}
          onValueChange={(_event, value) => {
            setPickerVisible(false);
            updateDraft({ date: localSearchDate(value), timeRange: 'all' });
          }}
        />
      ) : null}
    </>
  );
}

function NumericRangeFields({
  draftFilter,
  error,
  styles,
  theme,
  kind,
  name,
  updateDraft
}: DraftControls & {
  draftFilter: DiscourseSearchFilter;
  error: DiscourseSearchFilterError | null;
  kind: 'posts' | 'views';
  name: string;
}) {
  const fields = kind === 'posts' ? (['minPosts', 'maxPosts'] as const) : (['minViews', 'maxViews'] as const);
  return fields.map((field, index) => {
    const bound = index === 0 ? '最小值' : '最大值';
    const value = draftFilter[field];
    return (
      <FilterTextField
        key={field}
        styles={styles}
        theme={theme}
        field={bound}
        id={`search-filter-input-${field}`}
        label={`${name}${bound}`}
        error={error?.field === field ? error.message : undefined}
        placeholder="不限"
        keyboardType="number-pad"
        value={value === null ? '' : String(value)}
        onChange={(input) => {
          if (/^\d*$/.test(input)) updateDraft({ [field]: input ? Number(input) : null });
        }}
      />
    );
  });
}

function localSearchDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
