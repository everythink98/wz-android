import { useEffect, useMemo, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import type { DiscourseTagOption, DiscourseUserOption } from '@/domain/forum/models';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { DiscourseSearchFilter } from '@/domain/forum/searchFilters';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { FilterOptionRow, type FilterAppearance } from './SearchFilterControls';

type SearchTagCandidatesRequest = {
  categoryId?: string;
  query: string;
  source: DiscourseSource;
};

type SearchUserCandidatesRequest = {
  categoryId?: string;
  source: DiscourseSource;
  term: string;
};

type CandidateReads = {
  sessionEpochs: ForumSessionEpochs;
  readPlanScopes: { tags: string; users: string };
  searchDiscourseTags: (
    options: SearchTagCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseTagOption[]>;
  searchDiscourseUsers: (
    options: SearchUserCandidatesRequest & { signal?: AbortSignal }
  ) => Promise<DiscourseUserOption[]>;
};

export function useSearchCandidateQueries({
  sessionEpochs,
  enabled,
  readPlanScopes,
  searchDiscourseTags,
  searchDiscourseUsers,
  tagRequest,
  userRequest
}: CandidateReads & {
  enabled: boolean;
  tagRequest: SearchTagCandidatesRequest | null;
  userRequest: SearchUserCandidatesRequest | null;
}) {
  const tagQueryKey = forumQueryKeys.searchTags({
    categoryId: tagRequest?.categoryId,
    query: tagRequest?.query || '',
    readPlanScope: readPlanScopes.tags,
    scope: sessionEpochs,
    source: tagRequest?.source || 'linuxdo'
  });
  const userQueryKey = forumQueryKeys.searchUsers({
    categoryId: userRequest?.categoryId,
    readPlanScope: readPlanScopes.users,
    scope: sessionEpochs,
    source: userRequest?.source || 'linuxdo',
    term: userRequest?.term || ''
  });
  const tagCandidatesQuery = useQuery<DiscourseTagOption[]>({
    queryKey: tagQueryKey,
    subscribed: enabled && tagRequest !== null,
    queryFn: enabled && tagRequest ? ({ signal }) => searchDiscourseTags({ ...tagRequest, signal }) : skipToken
  });
  const userCandidatesQuery = useQuery<DiscourseUserOption[]>({
    queryKey: userQueryKey,
    subscribed: enabled && userRequest !== null,
    queryFn: enabled && userRequest ? ({ signal }) => searchDiscourseUsers({ ...userRequest, signal }) : skipToken
  });

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
  discourseDraft,
  picker,
  query,
  enabled,
  ...reads
}: CandidateReads & {
  discourseDraft: DiscourseSearchFilter | null;
  picker: 'tags' | 'author' | null;
  query: string;
  enabled: boolean;
}) {
  const term = query.trim();
  const input = useMemo(() => {
    if (picker === 'tags' || (picker === 'author' && term)) return { picker, term };
    return null;
  }, [picker, term]);
  const [submitted, setSubmitted] = useState<typeof input>(null);
  useEffect(() => {
    if (!input) return;
    const timer = setTimeout(() => setSubmitted(input), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const ready = input !== null && input === submitted;
  const candidates = useSearchCandidateQueries({
    ...reads,
    enabled,
    tagRequest:
      ready && input.picker === 'tags' && discourseDraft
        ? {
            source: discourseDraft.source,
            query: input.term,
            categoryId: discourseDraft.category || undefined
          }
        : null,
    userRequest:
      ready && input.picker === 'author' && discourseDraft
        ? { source: discourseDraft.source, term: input.term, categoryId: discourseDraft.category || undefined }
        : null
  });
  return {
    tags: {
      error: ready && candidates.tags.error ? '标签候选加载失败' : '',
      loading: (!!input && !ready) || candidates.tags.loading,
      options: ready ? candidates.tags.options : [],
      retry: candidates.tags.retry
    },
    users: {
      error: ready && candidates.users.error ? '作者候选加载失败' : '',
      loading: (!!input && !ready) || candidates.users.loading,
      options: ready ? candidates.users.options : [],
      retry: candidates.users.retry
    }
  };
}

type DiscourseFilterPickerController = ReturnType<typeof useDiscourseFilterPickers>;

export function DiscourseFilterPickerPage({
  picker,
  controller,
  query,
  draftFilter,
  styles,
  theme,
  toggleTag,
  selectAuthor
}: FilterAppearance & {
  picker: 'tags' | 'author';
  controller: DiscourseFilterPickerController;
  query: string;
  draftFilter: DiscourseSearchFilter;
  toggleTag: (name: string) => void;
  selectAuthor: (user: DiscourseUserOption) => void;
}) {
  const { tags, users } = controller;
  const appearance = { styles, theme };
  if (picker === 'tags') {
    const selected = new Set(draftFilter.tags);
    const visibleNames = new Set(tags.options.map(({ name }) => name));
    const options = [
      ...draftFilter.tags.filter((name) => !visibleNames.has(name)).map((name): DiscourseTagOption => ({ name })),
      ...tags.options
    ];
    return (
      <>
        {tags.error ? (
          <CandidateError {...appearance} message={tags.error} retryLabel="重试标签候选" retry={tags.retry} />
        ) : null}
        {!tags.loading && !tags.error && !options.length ? <EmptyText text="没有匹配标签" /> : null}
        {options.map((option) => (
          <FilterOptionRow
            {...appearance}
            key={option.name}
            title={option.name}
            label={`标签 ${option.name}`}
            checked={selected.has(option.name)}
            role="checkbox"
            detail={option.topicCount === undefined ? undefined : `${option.topicCount} 个主题`}
            onPress={() => toggleTag(option.name)}
          />
        ))}
        {tags.loading ? <LoadingState compact text="加载标签中" /> : null}
      </>
    );
  }

  const hasQuery = Boolean(query.trim());
  return (
    <>
      {users.error ? (
        <CandidateError {...appearance} message={users.error} retryLabel="重试作者候选" retry={users.retry} />
      ) : null}
      {!hasQuery ? <EmptyText text="输入用户名后选择" /> : null}
      {!users.loading && !users.error && hasQuery && !users.options.length ? <EmptyText text="没有匹配用户" /> : null}
      {users.options.map((user) => (
        <FilterOptionRow
          {...appearance}
          key={user.id}
          title={user.displayName || `@${user.username}`}
          label={`用户 ${user.displayName || user.username}`}
          testID={`search-filter-author-option-${user.id}`}
          checked={draftFilter.username === user.username}
          detail={user.displayName && user.displayName !== user.username ? `@${user.username}` : undefined}
          onPress={() => selectAuthor(user)}
        />
      ))}
      {users.loading ? <LoadingState compact text="加载作者中" /> : null}
    </>
  );
}

function CandidateError({
  message,
  retryLabel,
  styles,
  retry
}: FilterAppearance & { message: string; retryLabel: string; retry: () => Promise<unknown> }) {
  return (
    <View style={styles.errorBox}>
      <Text accessibilityRole="alert" style={styles.errorText}>
        {message}
      </Text>
      <AppButton compact label={retryLabel} variant="ghost" onPress={() => void retry()} />
    </View>
  );
}
