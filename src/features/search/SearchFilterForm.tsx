import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { SearchStyles } from './styles';
import {
  isDiscourseSearchFilter,
  searchTimeRangeItems,
  type DiscourseVisitedFilter,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';

function FilterChoiceGroup({
  horizontal = false,
  items,
  title,
  value,
  styles,
  theme,
  onChange
}: {
  horizontal?: boolean;
  items: { value: string; label: string }[];
  title: string;
  value: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (value: string) => void;
}) {
  const options = items.map((item) => {
    const selected = value === item.value;
    return (
      <Pressable
        key={`${title}-${item.value}-${item.label}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
        onPress={() => onChange(item.value)}
      >
        <Text
          numberOfLines={1}
          style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{title}</Text>
      {horizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.searchFilterOptionRow}
        >
          {options}
        </ScrollView>
      ) : (
        <View style={styles.searchFilterOptionWrap}>{options}</View>
      )}
    </View>
  );
}

function FilterTextField({
  label,
  placeholder,
  value,
  styles,
  theme,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.searchFilterField}>
      <Text style={styles.searchFilterLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function FilterCheckbox({
  checked,
  label,
  styles,
  theme,
  onChange
}: {
  checked: boolean;
  label: string;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      android_ripple={androidRipple(theme.primarySoft)}
      style={[styles.searchFilterOption, checked && styles.searchFilterOptionActive]}
      onPress={() => onChange(!checked)}
    >
      <Text style={[styles.searchFilterOptionText, checked && styles.searchFilterOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FilterNumberField({
  label,
  value,
  styles,
  theme,
  onChange
}: {
  label: string;
  value: number | null;
  styles: SearchStyles;
  theme: ReaderTheme;
  onChange: (value: number | null) => void;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      style={[styles.input, styles.flex]}
      value={value === null ? '' : String(value)}
      onChangeText={(nextValue) => {
        if (!/^\d*$/.test(nextValue)) {
          return;
        }
        onChange(nextValue ? Number(nextValue) : null);
      }}
      placeholder={label.includes('最小') ? '最小' : '最大'}
      placeholderTextColor={theme.muted}
      keyboardType="number-pad"
    />
  );
}

export function hasDiscourseAdvancedFilters(filter: SourceSearchFilter) {
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
      (filter.siteExtension?.source === 'linuxdo' && filter.siteExtension.expertResponse))
  );
}

export function SearchFilterForm({
  categoryNames,
  discourseMoreInitiallyVisible = false,
  draftFilter,
  filterSheetVisible,
  nodeSeekCategoryItems,
  openCategoryPicker,
  openTagPicker,
  openUserPicker,
  styles,
  theme,
  toggleTag,
  toggleVisited,
  updateDraft,
  updateLinuxDoExpertResponse,
  yaohuoCategoryItems
}: {
  categoryNames: ReadonlyMap<string, string>;
  discourseMoreInitiallyVisible?: boolean;
  draftFilter: SourceSearchFilter;
  filterSheetVisible: boolean;
  nodeSeekCategoryItems: { value: string; label: string }[];
  openCategoryPicker: () => void;
  openTagPicker: () => void;
  openUserPicker: () => void;
  styles: SearchStyles;
  theme: ReaderTheme;
  toggleTag: (name: string) => void;
  toggleVisited: (value: DiscourseVisitedFilter) => void;
  updateDraft: (partial: Partial<SourceSearchFilter>) => void;
  updateLinuxDoExpertResponse: (expertResponse: boolean) => void;
  yaohuoCategoryItems: { value: string; label: string }[];
}) {
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [discourseMoreVisible, setDiscourseMoreVisible] = useState(discourseMoreInitiallyVisible);
  const [v2exMoreVisible, setV2exMoreVisible] = useState(false);
  useEffect(() => {
    setDatePickerVisible(false);
    setDiscourseMoreVisible(discourseMoreInitiallyVisible);
    setV2exMoreVisible(false);
  }, [discourseMoreInitiallyVisible, draftFilter.source, filterSheetVisible]);
  useEffect(() => {
    if (!('date' in draftFilter) || !draftFilter.date) {
      setDatePickerVisible(false);
    }
  }, [draftFilter]);
  const changeExactDate = useCallback(
    (event: DateTimePickerEvent, value?: Date) => {
      setDatePickerVisible(false);
      if (event.type === 'set' && value) {
        updateDraft({ date: localSearchDate(value), timeRange: 'all' });
      }
    },
    [updateDraft]
  );
  const discourseAdvancedFiltersSet = hasDiscourseAdvancedFilters(draftFilter);
  const DiscourseMoreChevron = discourseMoreVisible ? ChevronUp : ChevronDown;
  const V2exMoreChevron = v2exMoreVisible ? ChevronUp : ChevronDown;
  return (
    <>
      {draftFilter.source === 'v2ex' ? (
        <>
          <FilterChoiceGroup
            title="排序"
            value={draftFilter.sort}
            items={[
              { value: 'relevance', label: '相关' },
              { value: 'time', label: '最新' }
            ]}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ sort: value as typeof draftFilter.sort })}
          />
          <FilterChoiceGroup
            title="时间"
            value={draftFilter.timeRange}
            items={searchTimeRangeItems}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ timeRange: value as typeof draftFilter.timeRange })}
          />
          <FilterTextField
            label="节点"
            placeholder="例如 qna / jobs"
            value={draftFilter.node}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ node: value })}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={v2exMoreVisible ? '收起 V2EX 更多筛选' : '展开 V2EX 更多筛选'}
            accessibilityState={{ expanded: v2exMoreVisible }}
            android_ripple={androidRipple(theme.primarySoft)}
            style={styles.searchFilterMoreButton}
            onPress={() => setV2exMoreVisible((current) => !current)}
          >
            <Text style={styles.searchFilterMoreText}>更多筛选</Text>
            <V2exMoreChevron size={16} color={theme.muted} strokeWidth={1.8} />
          </Pressable>
          {v2exMoreVisible ? (
            <>
              <FilterTextField
                label="作者"
                placeholder="V2EX 用户名"
                value={draftFilter.username}
                styles={styles}
                theme={theme}
                onChange={(value) => updateDraft({ username: value })}
              />
              <FilterChoiceGroup
                title="关键词关系"
                value={draftFilter.operator}
                items={[
                  { value: 'or', label: '任一关键词' },
                  { value: 'and', label: '全部关键词' }
                ]}
                styles={styles}
                theme={theme}
                onChange={(value) => updateDraft({ operator: value as typeof draftFilter.operator })}
              />
            </>
          ) : null}
        </>
      ) : null}
      {isDiscourseSearchFilter(draftFilter) ? (
        <>
          <FilterChoiceGroup
            title="排序"
            value={draftFilter.order}
            items={[
              { value: 'relevance', label: '相关' },
              { value: 'latest', label: '最新' }
            ]}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ order: value as typeof draftFilter.order })}
          />
          <FilterChoiceGroup
            title="时间"
            value={draftFilter.timeRange}
            items={searchTimeRangeItems}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ timeRange: value as typeof draftFilter.timeRange, date: '' })}
          />
          <FilterChoiceGroup
            title="搜索范围"
            value={draftFilter.scope}
            items={[
              { value: 'all', label: '全文' },
              { value: 'title', label: '标题' }
            ]}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ scope: value as typeof draftFilter.scope })}
          />
          <View style={styles.searchFilterField}>
            <Text style={styles.searchFilterLabel}>分类</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="选择分类"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.input}
              onPress={openCategoryPicker}
            >
              <Text
                style={[styles.searchFilterOptionText, draftFilter.category && styles.searchFilterOptionTextActive]}
              >
                {draftFilter.category ? categoryNames.get(draftFilter.category) || draftFilter.category : '全部分类'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.searchFilterField}>
            <Text style={styles.searchFilterLabel}>标签</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="选择标签"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.input}
              onPress={openTagPicker}
            >
              <Text
                style={[
                  styles.searchFilterOptionText,
                  draftFilter.tags.length > 0 && styles.searchFilterOptionTextActive
                ]}
              >
                {draftFilter.tags.length ? `已选择 ${draftFilter.tags.length} 个标签` : '选择标签'}
              </Text>
            </Pressable>
            {draftFilter.tags.length ? (
              <View style={styles.chipWrap}>
                {draftFilter.tags.map((tag) => (
                  <Pressable
                    key={tag}
                    accessibilityRole="button"
                    accessibilityLabel={`移除标签 ${tag}`}
                    style={styles.searchFilterOption}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={styles.searchFilterOptionText}>{tag} ×</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {draftFilter.tags.length >= 2 ? (
              <FilterCheckbox
                checked={draftFilter.tagMatch === 'all'}
                label="匹配全部标签"
                styles={styles}
                theme={theme}
                onChange={(checked) => updateDraft({ tagMatch: checked ? 'all' : 'any' })}
              />
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${discourseMoreVisible ? '收起' : '展开'}更多筛选${
              discourseAdvancedFiltersSet ? '，已设置' : ''
            }`}
            accessibilityState={{ expanded: discourseMoreVisible }}
            android_ripple={androidRipple(theme.primarySoft)}
            style={styles.searchFilterMoreButton}
            onPress={() => {
              setDatePickerVisible(false);
              setDiscourseMoreVisible((current) => !current);
            }}
          >
            <Text style={styles.searchFilterMoreText}>更多筛选{discourseAdvancedFiltersSet ? ' · 已设置' : ''}</Text>
            <DiscourseMoreChevron size={16} color={theme.muted} strokeWidth={1.8} />
          </Pressable>
          {discourseMoreVisible ? (
            <>
              <View style={styles.searchFilterField}>
                <Text style={styles.searchFilterLabel}>回访范围</Text>
                <View style={styles.searchFilterOptionWrap}>
                  {(
                    [
                      ['seen', '我读过'],
                      ['bookmarks', '我已添加为书签'],
                      ['likes', '我赞过'],
                      ['posted', '我发过帖'],
                      ['created', '我创建']
                    ] as [DiscourseVisitedFilter, string][]
                  ).map(([value, label]) => (
                    <FilterCheckbox
                      key={value}
                      checked={draftFilter.visited.includes(value)}
                      label={label}
                      styles={styles}
                      theme={theme}
                      onChange={() => toggleVisited(value)}
                    />
                  ))}
                </View>
              </View>
              <FilterChoiceGroup
                title="话题状态"
                value={draftFilter.status}
                items={[
                  { value: '', label: '不限状态' },
                  { value: 'open', label: '开放' },
                  { value: 'closed', label: '已关闭' },
                  { value: 'public', label: '公开' },
                  { value: 'archived', label: '已归档' },
                  { value: 'noreplies', label: '无回复' },
                  { value: 'single_user', label: '单一用户' },
                  { value: 'solved', label: '已解决' },
                  { value: 'unsolved', label: '未解决' }
                ]}
                styles={styles}
                theme={theme}
                onChange={(value) => updateDraft({ status: value as typeof draftFilter.status })}
              />
              <View style={styles.searchFilterField}>
                <Text style={styles.searchFilterLabel}>精确日期</Text>
                <FilterChoiceGroup
                  title="日期关系"
                  value={draftFilter.dateRelation}
                  items={[
                    { value: 'after', label: '之后' },
                    { value: 'before', label: '之前' }
                  ]}
                  styles={styles}
                  theme={theme}
                  onChange={(value) => updateDraft({ dateRelation: value as typeof draftFilter.dateRelation })}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="选择精确日期"
                  android_ripple={androidRipple(theme.primarySoft)}
                  style={styles.input}
                  onPress={() => setDatePickerVisible(true)}
                >
                  <Text
                    style={[styles.searchFilterOptionText, draftFilter.date && styles.searchFilterOptionTextActive]}
                  >
                    {draftFilter.date || '选择日期'}
                  </Text>
                </Pressable>
                {draftFilter.date ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除精确日期"
                    style={styles.searchFilterOption}
                    onPress={() => updateDraft({ date: '' })}
                  >
                    <Text style={styles.searchFilterOptionText}>清除日期</Text>
                  </Pressable>
                ) : null}
                {datePickerVisible ? (
                  <DateTimePicker
                    value={draftFilter.date ? new Date(`${draftFilter.date}T12:00:00`) : new Date()}
                    mode="date"
                    onChange={changeExactDate}
                  />
                ) : null}
              </View>
              <View style={styles.searchFilterField}>
                <Text style={styles.searchFilterLabel}>帖子数范围</Text>
                <View style={styles.searchFilterOptionRow}>
                  <FilterNumberField
                    label="帖子数最小值"
                    value={draftFilter.minPosts}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ minPosts: value })}
                  />
                  <FilterNumberField
                    label="帖子数最大值"
                    value={draftFilter.maxPosts}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ maxPosts: value })}
                  />
                </View>
              </View>
              <View style={styles.searchFilterField}>
                <Text style={styles.searchFilterLabel}>浏览量范围</Text>
                <View style={styles.searchFilterOptionRow}>
                  <FilterNumberField
                    label="浏览量最小值"
                    value={draftFilter.minViews}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ minViews: value })}
                  />
                  <FilterNumberField
                    label="浏览量最大值"
                    value={draftFilter.maxViews}
                    styles={styles}
                    theme={theme}
                    onChange={(value) => updateDraft({ maxViews: value })}
                  />
                </View>
              </View>
              {draftFilter.siteExtension?.source === 'linuxdo' ? (
                <View style={styles.searchFilterField}>
                  <Text style={styles.searchFilterLabel}>其他</Text>
                  <FilterCheckbox
                    checked={draftFilter.siteExtension.expertResponse}
                    label="有专家回应"
                    styles={styles}
                    theme={theme}
                    onChange={updateLinuxDoExpertResponse}
                  />
                </View>
              ) : null}
              <View style={styles.searchFilterField}>
                <Text style={styles.searchFilterLabel}>发帖人</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="选择作者"
                  android_ripple={androidRipple(theme.primarySoft)}
                  style={styles.input}
                  onPress={openUserPicker}
                >
                  <Text
                    style={[styles.searchFilterOptionText, draftFilter.username && styles.searchFilterOptionTextActive]}
                  >
                    {draftFilter.username || '选择站点用户'}
                  </Text>
                </Pressable>
                {draftFilter.username ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`移除作者 ${draftFilter.username}`}
                    style={styles.searchFilterOption}
                    onPress={() => updateDraft({ username: '' })}
                  >
                    <Text style={styles.searchFilterOptionText}>{draftFilter.username} ×</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
        </>
      ) : null}
      {draftFilter.source === 'nodeseek' ? (
        <>
          <FilterChoiceGroup
            horizontal={nodeSeekCategoryItems.length > 8}
            title="分类"
            value={draftFilter.category}
            items={nodeSeekCategoryItems}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ category: value })}
          />
          <FilterChoiceGroup
            title="排序"
            value={draftFilter.sort}
            items={[
              { value: 'replyTime', label: '新评论' },
              { value: 'postTime', label: '新帖子' }
            ]}
            styles={styles}
            theme={theme}
            onChange={(value) => updateDraft({ sort: value as typeof draftFilter.sort })}
          />
        </>
      ) : null}
      {draftFilter.source === 'yaohuo' ? (
        <FilterChoiceGroup
          horizontal={yaohuoCategoryItems.length > 8}
          title="版块"
          value={draftFilter.category}
          items={yaohuoCategoryItems}
          styles={styles}
          theme={theme}
          onChange={(value) => updateDraft({ category: value })}
        />
      ) : null}
    </>
  );
}

function localSearchDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
