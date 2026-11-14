import type { Source } from '@/domain/forum/models';
import {
  defaultSearchFilterForSource,
  discourseSearchFilterError,
  isDiscourseSearchFilter,
  type DiscourseVisitedFilter,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';

type Feedback = { kind: 'clear' } | { kind: 'invalid'; message: string };
type Snapshot = Readonly<{ visible: boolean; draft: SourceSearchFilter; error: string; more: boolean }>;
const copy = (filter: SourceSearchFilter): SourceSearchFilter =>
  isDiscourseSearchFilter(filter) ? { ...filter, tags: [...filter.tags], visited: [...filter.visited] } : { ...filter };

export function createSearchFilterEdit(initial: SourceSearchFilter) {
  let surface: 'closed' | 'editing' = 'closed';
  let draft = initial;
  let feedback: Feedback = { kind: 'clear' };
  let more = false;
  let snapshot: Snapshot = { visible: false, draft, error: '', more };
  const clearFeedback = () => {
    feedback = { kind: 'clear' };
  };
  const install = (filter: SourceSearchFilter, advanced: boolean) => {
    draft = copy(filter);
    clearFeedback();
    more = advanced;
  };
  return {
    get snapshot() {
      const visible = surface === 'editing';
      const error = feedback.kind === 'invalid' ? feedback.message : '';
      if (
        snapshot.visible !== visible ||
        snapshot.draft !== draft ||
        snapshot.error !== error ||
        snapshot.more !== more
      )
        snapshot = { visible, draft, error, more };
      return snapshot;
    },
    open(filter: SourceSearchFilter, advanced: boolean) {
      install(filter, advanced);
      surface = 'editing';
    },
    observe(filter: SourceSearchFilter, advanced: boolean) {
      if (surface === 'editing') install(filter, advanced);
    },
    close() {
      surface = 'closed';
    },
    edit(partial: Partial<SourceSearchFilter>) {
      // The existing form contract supplies fields belonging to the displayed source.
      draft = { ...draft, ...partial } as SourceSearchFilter;
      clearFeedback();
    },
    reset(source: Source) {
      draft = defaultSearchFilterForSource(source);
      clearFeedback();
    },
    moreChanged(value: boolean) {
      more = value;
    },
    toggleTag(name: string) {
      clearFeedback();
      if (isDiscourseSearchFilter(draft))
        draft = {
          ...draft,
          tags: draft.tags.includes(name) ? draft.tags.filter((tag) => tag !== name) : [...draft.tags, name]
        };
    },
    toggleVisited(value: DiscourseVisitedFilter) {
      clearFeedback();
      if (isDiscourseSearchFilter(draft))
        draft = {
          ...draft,
          visited: draft.visited.includes(value)
            ? draft.visited.filter((item) => item !== value)
            : [...draft.visited, value]
        };
    },
    expertResponseChanged(expertResponse: boolean) {
      clearFeedback();
      if (isDiscourseSearchFilter(draft)) draft = { ...draft, expertResponse };
    },
    validate() {
      const error = isDiscourseSearchFilter(draft) ? discourseSearchFilterError(draft) : null;
      if (error) {
        feedback = { kind: 'invalid', message: error };
        return null;
      }
      return draft;
    }
  };
}
