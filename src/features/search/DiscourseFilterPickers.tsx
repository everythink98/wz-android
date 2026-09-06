import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, TextInput, type ViewStyle, View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import type { Category, DiscourseTagOption, DiscourseUserOption } from '@/domain/forum/models';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { DiscourseSearchFilter, SourceSearchFilter } from '@/domain/forum/searchFilters';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import type { SearchStyles } from './styles';

type SearchTagCandidatesRequest = {
  categoryId?: string;
  query: string;
  selectedTags: string[];
  source: DiscourseSource;
};

type SearchUserCandidatesRequest = {
  categoryId?: string;
  source: DiscourseSource;
  term: string;
};

export function useSearchCandidateQueries({
  sessionEpochs,
  enabled,
  readPlanScopes,
  searchDiscourseTags,
  searchDiscourseUsers,
  tagRequest,
  userRequest
}: {
  sessionEpochs: ForumSessionEpochs;
  enabled: boolean;
  readPlanScopes: { tags: string; users: string };
  searchDiscourseTags: (
    options: SearchTagCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseTagOption[]>;
  searchDiscourseUsers: (
    options: SearchUserCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseUserOption[]>;
  tagRequest: SearchTagCandidatesRequest | null;
  userRequest: SearchUserCandidatesRequest | null;
}) {
  const queryClient = useQueryClient();
  const tagCandidatesQuery = useQuery<DiscourseTagOption[]>({
    queryKey: forumQueryKeys.searchTags({
      categoryId: tagRequest?.categoryId,
      query: tagRequest?.query || '',
      readPlanScope: readPlanScopes.tags,
      scope: sessionEpochs,
      selectedTags: tagRequest?.selectedTags || [],
      source: tagRequest?.source || 'linuxdo'
    }),
    enabled: Boolean(enabled && tagRequest),
    queryFn: ({ signal }) => (tagRequest ? searchDiscourseTags({ ...tagRequest, signal }) : Promise.resolve([]))
  });
  const userCandidatesQuery = useQuery<DiscourseUserOption[]>({
    queryKey: forumQueryKeys.searchUsers({
      categoryId: userRequest?.categoryId,
      readPlanScope: readPlanScopes.users,
      scope: sessionEpochs,
      source: userRequest?.source || 'linuxdo',
      term: userRequest?.term || ''
    }),
    enabled: Boolean(enabled && userRequest),
    queryFn: ({ signal }) => (userRequest ? searchDiscourseUsers({ ...userRequest, signal }) : Promise.resolve([]))
  });

  useEffect(() => {
    if (enabled) return;
    void queryClient.cancelQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === 'forum' && (queryKey[2] === 'search-tags' || queryKey[2] === 'search-users')
    });
  }, [enabled, queryClient]);

  return {
    tags: {
      error: tagCandidatesQuery.isError,
      loading: tagCandidatesQuery.isFetching,
      options: tagCandidatesQuery.data || [],
      retry: tagCandidatesQuery.refetch
    },
    users: {
      error: userCandidatesQuery.isError,
      loading: userCandidatesQuery.isFetching,
      options: userCandidatesQuery.data || [],
      retry: userCandidatesQuery.refetch
    }
  };
}

export function useDiscourseFilterPickers({
  categories,
  discourseDraft,
  filterSheetVisible,
  requestsEnabled,
  readPlanScopes,
  sessionEpochs,
  searchDiscourseTags,
  searchDiscourseUsers
}: {
  categories: Category[];
  discourseDraft: DiscourseSearchFilter | null;
  filterSheetVisible: boolean;
  requestsEnabled: boolean;
  readPlanScopes: { tags: string; users: string };
  sessionEpochs: ForumSessionEpochs;
  searchDiscourseTags: (
    options: SearchTagCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseTagOption[]>;
  searchDiscourseUsers: (
    options: SearchUserCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseUserOption[]>;
}) {
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [debouncedTagQuery, setDebouncedTagQuery] = useState<string | null>(null);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [userPickerVisible, setUserPickerVisible] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [debouncedUserQuery, setDebouncedUserQuery] = useState<string | null>(null);
  const discourseSource = discourseDraft?.source;
  const discourseCategories = useMemo(
    () => (discourseSource ? categories.filter((category) => category.source === discourseSource) : []),
    [categories, discourseSource]
  );
  const categoryNames = useMemo(
    () => new Map(discourseCategories.map((category) => [category.id, category.name])),
    [discourseCategories]
  );
  const categoryOptions = useMemo(() => {
    const query = categoryQuery.trim().toLowerCase();
    return discourseCategories.filter((category) => {
      const parentName = category.parentId ? categoryNames.get(category.parentId) || '' : '';
      return !query || `${parentName} ${category.name} ${category.slug || ''}`.toLowerCase().includes(query);
    });
  }, [categoryNames, categoryQuery, discourseCategories]);

  const closeAll = useCallback(() => {
    setTagPickerVisible(false);
    setCategoryPickerVisible(false);
    setUserPickerVisible(false);
  }, []);

  useEffect(() => {
    closeAll();
  }, [closeAll, discourseSource, filterSheetVisible]);

  useEffect(() => {
    setDebouncedTagQuery(null);
    if (!tagPickerVisible) return;
    const timer = setTimeout(() => setDebouncedTagQuery(tagQuery), 300);
    return () => clearTimeout(timer);
  }, [tagPickerVisible, tagQuery]);

  useEffect(() => {
    setDebouncedUserQuery(null);
    const term = userQuery.trim();
    if (!userPickerVisible || !term) return;
    const timer = setTimeout(() => setDebouncedUserQuery(term), 300);
    return () => clearTimeout(timer);
  }, [userPickerVisible, userQuery]);

  const candidates = useSearchCandidateQueries({
    sessionEpochs,
    enabled: requestsEnabled && filterSheetVisible,
    readPlanScopes,
    searchDiscourseTags,
    searchDiscourseUsers,
    tagRequest:
      tagPickerVisible && discourseDraft && debouncedTagQuery !== null
        ? {
            source: discourseDraft.source,
            query: debouncedTagQuery,
            categoryId: discourseDraft.category || undefined,
            selectedTags: discourseDraft.tags
          }
        : null,
    userRequest:
      userPickerVisible && discourseDraft && debouncedUserQuery
        ? {
            source: discourseDraft.source,
            term: debouncedUserQuery,
            categoryId: discourseDraft.category || undefined
          }
        : null
  });
  const normalizedUserQuery = userQuery.trim();
  const tagDebouncing = tagPickerVisible && debouncedTagQuery !== tagQuery;
  const userDebouncing =
    userPickerVisible && Boolean(normalizedUserQuery) && debouncedUserQuery !== normalizedUserQuery;

  return {
    category: {
      close: () => setCategoryPickerVisible(false),
      names: categoryNames,
      open: () => {
        setCategoryQuery('');
        setCategoryPickerVisible(true);
      },
      options: categoryOptions,
      query: categoryQuery,
      setQuery: setCategoryQuery,
      visible: categoryPickerVisible
    },
    tags: {
      close: () => setTagPickerVisible(false),
      error: !tagDebouncing && candidates.tags.error ? '标签候选加载失败' : '',
      loading: tagDebouncing || candidates.tags.loading,
      open: () => {
        setTagQuery('');
        setTagPickerVisible(true);
      },
      options: tagDebouncing ? [] : candidates.tags.options,
      query: tagQuery,
      retry: candidates.tags.retry,
      setQuery: setTagQuery,
      visible: tagPickerVisible
    },
    users: {
      close: () => setUserPickerVisible(false),
      error: !userDebouncing && candidates.users.error ? '作者候选加载失败' : '',
      loading: userDebouncing || candidates.users.loading,
      open: () => {
        setUserQuery('');
        setUserPickerVisible(true);
      },
      options: userDebouncing ? [] : candidates.users.options,
      query: userQuery,
      retry: candidates.users.retry,
      setQuery: setUserQuery,
      visible: userPickerVisible
    }
  };
}

export type DiscourseFilterPickerController = ReturnType<typeof useDiscourseFilterPickers>;

export function DiscourseFilterPickers({
  controller,
  discourseDraft,
  filterBodyStyle,
  styles,
  theme,
  toggleTag,
  updateDraft
}: {
  controller: DiscourseFilterPickerController;
  discourseDraft: DiscourseSearchFilter | null;
  filterBodyStyle: ViewStyle;
  styles: SearchStyles;
  theme: ReaderTheme;
  toggleTag: (name: string) => void;
  updateDraft: (partial: Partial<SourceSearchFilter>) => void;
}) {
  const { category, tags, users } = controller;
  return (
    <>
      <ModalSheetFrame backdropLabel="关闭标签选择" visible={tags.visible} onRequestClose={tags.close}>
        <View style={styles.searchFilterHeader}>
          <Text style={styles.searchFilterTitle}>选择标签</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭标签选择"
            hitSlop={TOUCH_HIT_SLOP}
            style={styles.searchInlineButton}
            onPress={tags.close}
          >
            <X size={18} color={theme.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <View style={styles.searchFilterBodyInner}>
          <TextInput
            accessibilityLabel="搜索标签"
            style={styles.input}
            value={tags.query}
            onChangeText={tags.setQuery}
            placeholder="搜索站点标签"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <ScrollView
          style={[styles.searchFilterBody, filterBodyStyle]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="handled"
        >
          {tags.loading ? <LoadingState text="正在加载标签..." /> : null}
          {tags.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{tags.error}</Text>
              <AppButton compact label="重试标签候选" variant="ghost" onPress={() => void tags.retry()} />
            </View>
          ) : null}
          {!tags.loading && !tags.error && !tags.options.length ? <EmptyText text="没有匹配标签" /> : null}
          {tags.options.map((option) => {
            const selected = Boolean(discourseDraft?.tags.includes(option.name));
            return (
              <Pressable
                key={option.name}
                accessibilityRole="checkbox"
                accessibilityLabel={`标签 ${option.name}`}
                accessibilityState={{ checked: selected }}
                style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                onPress={() => toggleTag(option.name)}
              >
                <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                  {option.name}
                  {option.topicCount === undefined ? '' : ` · ${option.topicCount}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.searchFilterActions}>
          <AppButton compact label="完成" variant="primary" onPress={tags.close} />
        </View>
      </ModalSheetFrame>
      <ModalSheetFrame backdropLabel="关闭分类选择" visible={category.visible} onRequestClose={category.close}>
        <View style={styles.searchFilterHeader}>
          <Text style={styles.searchFilterTitle}>选择分类</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭分类选择"
            hitSlop={TOUCH_HIT_SLOP}
            style={styles.searchInlineButton}
            onPress={category.close}
          >
            <X size={18} color={theme.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <View style={styles.searchFilterBodyInner}>
          <TextInput
            accessibilityLabel="搜索分类"
            style={styles.input}
            value={category.query}
            onChangeText={category.setQuery}
            placeholder="搜索分类"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <ScrollView
          style={[styles.searchFilterBody, filterBodyStyle]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="分类 全部分类"
            accessibilityState={{ checked: !discourseDraft?.category }}
            style={[styles.searchFilterOption, !discourseDraft?.category && styles.searchFilterOptionActive]}
            onPress={() => {
              updateDraft({ category: '' });
              category.close();
            }}
          >
            <Text
              style={[styles.searchFilterOptionText, !discourseDraft?.category && styles.searchFilterOptionTextActive]}
            >
              全部分类
            </Text>
          </Pressable>
          {category.options.map((option) => {
            const parentName = option.parentId ? category.names.get(option.parentId) : '';
            const label = parentName ? `${parentName} / ${option.name}` : option.name;
            const selected = discourseDraft?.category === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityLabel={`分类 ${label}`}
                accessibilityState={{ checked: selected }}
                style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                onPress={() => {
                  updateDraft({ category: option.id });
                  category.close();
                }}
              >
                <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                  {label}
                  {option.readRestricted ? ' · 🔒' : ''}
                  {option.topicCount === undefined ? '' : ` · ${option.topicCount}`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </ModalSheetFrame>
      <ModalSheetFrame backdropLabel="关闭作者选择" visible={users.visible} onRequestClose={users.close}>
        <View style={styles.searchFilterHeader}>
          <Text style={styles.searchFilterTitle}>选择发帖人</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭作者选择"
            hitSlop={TOUCH_HIT_SLOP}
            style={styles.searchInlineButton}
            onPress={users.close}
          >
            <X size={18} color={theme.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <View style={styles.searchFilterBodyInner}>
          <TextInput
            accessibilityLabel="搜索作者"
            style={styles.input}
            value={users.query}
            onChangeText={users.setQuery}
            placeholder="输入用户名"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <ScrollView
          style={[styles.searchFilterBody, filterBodyStyle]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="handled"
        >
          {users.loading ? <LoadingState text="正在加载作者..." /> : null}
          {users.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{users.error}</Text>
              <AppButton compact label="重试作者候选" variant="ghost" onPress={() => void users.retry()} />
            </View>
          ) : null}
          {!users.query.trim() ? <EmptyText text="输入用户名后选择" /> : null}
          {!users.loading && !users.error && users.query.trim() && !users.options.length ? (
            <EmptyText text="没有匹配用户" />
          ) : null}
          {users.options.map((user) => (
            <Pressable
              key={user.id}
              accessibilityRole="radio"
              accessibilityLabel={`用户 ${user.username}`}
              accessibilityState={{ checked: discourseDraft?.username === user.username }}
              style={[
                styles.searchFilterOption,
                discourseDraft?.username === user.username && styles.searchFilterOptionActive
              ]}
              onPress={() => {
                updateDraft({ username: user.username });
                users.close();
              }}
            >
              <Text
                style={[
                  styles.searchFilterOptionText,
                  discourseDraft?.username === user.username && styles.searchFilterOptionTextActive
                ]}
              >
                {user.displayName && user.displayName !== user.username ? `${user.displayName} · ` : ''}@{user.username}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </ModalSheetFrame>
    </>
  );
}
