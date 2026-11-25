import { positiveNumber } from '@/domain/forum/numericValues';
import {
  withBrowserFetchIntent,
  withDefaultBrowserFetchIntent,
  type BrowserFetchIntent
} from '@/platform/network/browserFetchIntent';
import {
  fetchWithTimeout,
  REQUEST_CANCELED_MESSAGE,
  withAbortableTimeout,
  type Fetcher
} from '@/platform/network/request';
import type {
  AccessRequirement,
  CategoriesResponse,
  DiscourseFeedFilter,
  DiscourseTopicReading,
  FeedResponse,
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Topic,
  TopicDetail
} from '@/domain/forum/models';
import { isRecord, parsePositiveInteger, recordText, textContentFromHtml } from '@/domain/forum/html';
import { mergeTopics } from '@/domain/forum/feed';
import { accessRequirementLevelValue, accessRequirementSpecificity } from '@/domain/forum/presentation';
import { discoursePostPolicy } from '@/sources/discourse/policy';
import { accessRequirementFromObject, accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import {
  LINUXDO_BASE_URL as BASE_URL,
  LINUXDO_UNCATEGORIZED_CATEGORY_NAME as UNCATEGORIZED_CATEGORY_NAME,
  linuxDoAvatarUrl as avatarUrl,
  linuxDoFeedParams,
  linuxDoFeedPath,
  linuxDoRequestError,
  linuxDoUserUrl as userUrl,
  preferredLinuxDoAccessRequirement
} from './protocol';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { proveForumReadResponse } from '@/sources/forumSourceReadAttempt';
import {
  assertDiscourseTopicIdentity,
  discourseCategories,
  discourseOriginalPoster,
  discourseDisplayName,
  discoursePolls,
  discoursePostFields,
  discourseRepliesInStreamOrder,
  discourseReplyWindow,
  discourseStreamReplyWindow,
  discourseTopicFields,
  discourseUsersById,
  discourseVisiblePostIds
} from '@/sources/discourse/model';
import { prepareLinuxDoContent } from './parser';
import { linuxDoBoostFields } from './boosts';
import { orientReplyWindow } from '@/sources/replyWindows';
import { discourseReadingFromJson } from '@/domain/forum/discourseReading';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { AGGREGATE_SOURCE_BUDGET_MS } from '@/sources/readAggregation';

export const LIST_PAGE_SIZE = 30;
const LATEST_PINS_TIMEOUT_MS = 1_500;
const LINUXDO_FEED_CURSOR_SEEN_LIMIT = 200;
const LINUXDO_FEED_HISTORY_LIMIT = 64;
const LINUXDO_FEED_MAX_STALLED_PAGES = 2;
const LINUXDO_FEED_MAX_OVERLAP_PAGES = 6;

type LinuxDoResponseReadingEvidence = {
  scope: string;
  trustworthyUnseen: boolean;
  requiresBackfillConfirmation: boolean;
  malformedReading: boolean;
};

const linuxDoResponseReadingEvidence = new WeakMap<Topic, LinuxDoResponseReadingEvidence>();

function linuxDoResponseReadingScope(access?: LinuxDoReadAuth): string | null {
  if (access?.authenticated !== true) return null;
  return (
    access.readingScope?.trim() || access.identityKey?.trim() || access.categoryCacheScope?.trim() || 'authenticated'
  );
}

function hasValidHighestPostNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasMalformedLinuxDoReadingField(raw: Record<string, unknown>) {
  if (
    raw.last_read_post_number !== undefined &&
    raw.last_read_post_number !== null &&
    !isNonNegativeSafeInteger(raw.last_read_post_number)
  ) {
    return true;
  }
  if (raw.unread_posts !== undefined && raw.unread_posts !== null && !isNonNegativeSafeInteger(raw.unread_posts)) {
    return true;
  }
  if (raw.unseen === true) {
    if (raw.last_read_post_number !== undefined && raw.last_read_post_number !== null) return true;
    if (raw.unread !== undefined && raw.unread !== null && raw.unread !== false) return true;
    if (raw.unread_posts !== undefined && raw.unread_posts !== null && raw.unread_posts !== 0) return true;
    if (raw.new_posts !== undefined && raw.new_posts !== null && raw.new_posts !== 0) return true;
  }
  return false;
}

function mergeReadPostNumbers(current?: readonly number[], incoming?: readonly number[]) {
  if (!incoming?.length) return current ? [...current] : [];
  if (!current?.length) return [...new Set(incoming)];
  const merged = new Set(current);
  for (const floor of incoming) merged.add(floor);
  return [...merged];
}

function sameNumberList(left?: readonly number[], right?: readonly number[]) {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasLinuxDoReadingChange(previous?: DiscourseTopicReading, next?: DiscourseTopicReading) {
  if (previous === next) return false;
  if (!previous || !next) return true;
  return (
    previous.lastReadPostNumber !== next.lastReadPostNumber ||
    previous.highestPostNumber !== next.highestPostNumber ||
    previous.unreadPosts !== next.unreadPosts ||
    !sameNumberList(previous.readPostNumbers, next.readPostNumbers)
  );
}

function readingEvidenceForTopic(value: unknown): LinuxDoResponseReadingEvidence | undefined {
  return value && typeof value === 'object' ? linuxDoResponseReadingEvidence.get(value as Topic) : undefined;
}

function setLinuxDoResponseReadingEvidence(topic: Topic, evidence?: LinuxDoResponseReadingEvidence) {
  if (!evidence || topic.source !== 'linuxdo' || topic.isPrivateMessage) return;
  const trustworthyUnseen =
    evidence.trustworthyUnseen &&
    !evidence.requiresBackfillConfirmation &&
    !evidence.malformedReading &&
    topic.reading?.lastReadPostNumber === undefined &&
    hasValidHighestPostNumber(topic.reading?.highestPostNumber) &&
    !topic.reading.unreadPosts &&
    !topic.reading.readPostNumbers?.length;
  linuxDoResponseReadingEvidence.set(topic, {
    scope: evidence.scope,
    trustworthyUnseen,
    requiresBackfillConfirmation: evidence.requiresBackfillConfirmation,
    malformedReading: evidence.malformedReading
  });
}

function sameResponseReadingConflict(
  first: Topic,
  second: Topic,
  firstEvidence?: LinuxDoResponseReadingEvidence,
  secondEvidence?: LinuxDoResponseReadingEvidence
) {
  if (
    firstEvidence?.requiresBackfillConfirmation ||
    secondEvidence?.requiresBackfillConfirmation ||
    firstEvidence?.malformedReading ||
    secondEvidence?.malformedReading
  ) {
    return true;
  }
  const firstLast = first.reading?.lastReadPostNumber;
  const secondLast = second.reading?.lastReadPostNumber;
  if (firstLast !== undefined && secondLast !== undefined && firstLast !== secondLast) {
    return true;
  }
  const firstUnseen = firstEvidence?.trustworthyUnseen === true;
  const secondUnseen = secondEvidence?.trustworthyUnseen === true;
  if (firstUnseen !== secondUnseen) {
    return true;
  }
  const firstUnread = first.reading?.unreadPosts;
  const secondUnread = second.reading?.unreadPosts;
  if (firstUnread !== undefined && secondUnread !== undefined && firstUnread !== secondUnread) {
    return true;
  }
  const firstReadCount = first.reading?.readPostNumbers?.length ?? 0;
  const secondReadCount = second.reading?.readPostNumbers?.length ?? 0;
  if (
    ((firstLast === null || firstLast === 0 || firstUnseen) && secondReadCount > 0) ||
    ((secondLast === null || secondLast === 0 || secondUnseen) && firstReadCount > 0)
  ) {
    return true;
  }
  return false;
}

function mergeSameResponseDuplicateLinuxDoTopic(first: Topic, second: Topic): Topic {
  const firstEvidence = readingEvidenceForTopic(first);
  const secondEvidence = readingEvidenceForTopic(second);
  const scope = secondEvidence?.scope || firstEvidence?.scope;
  const pinned = first.pinned === true || second.pinned === true ? true : first.pinned;
  const updatedAccess = shouldUpdateAccessRequirement(first.accessRequirement, second.accessRequirement);
  const accessRequirement = updatedAccess ? second.accessRequirement : first.accessRequirement;

  const firstHigh = first.reading?.highestPostNumber;
  const secondHigh = second.reading?.highestPostNumber;
  const highestPostNumber =
    hasValidHighestPostNumber(firstHigh) && hasValidHighestPostNumber(secondHigh)
      ? Math.max(firstHigh, secondHigh)
      : hasValidHighestPostNumber(secondHigh)
        ? secondHigh
        : firstHigh;

  const conflict = sameResponseReadingConflict(first, second, firstEvidence, secondEvidence);
  let reading: DiscourseTopicReading | undefined;
  let nextEvidence: LinuxDoResponseReadingEvidence | undefined;
  if (conflict) {
    reading =
      highestPostNumber !== undefined ? { topicId: first.id, highestPostNumber, readPostNumbers: [] } : undefined;
    if (scope) {
      nextEvidence = {
        scope,
        trustworthyUnseen: false,
        requiresBackfillConfirmation: true,
        malformedReading: false
      };
    }
  } else {
    const firstLast = first.reading?.lastReadPostNumber;
    const secondLast = second.reading?.lastReadPostNumber;
    const lastReadPostNumber = firstLast !== undefined ? firstLast : secondLast;
    const firstUnread = first.reading?.unreadPosts;
    const secondUnread = second.reading?.unreadPosts;
    const unreadPosts = firstUnread !== undefined ? firstUnread : secondUnread;
    const readPostNumbers = mergeReadPostNumbers(first.reading?.readPostNumbers, second.reading?.readPostNumbers);
    if (first.reading || second.reading) {
      reading = {
        topicId: first.reading?.topicId || second.reading?.topicId || first.id,
        ...(lastReadPostNumber !== undefined ? { lastReadPostNumber } : {}),
        ...(highestPostNumber !== undefined ? { highestPostNumber } : {}),
        ...(unreadPosts !== undefined ? { unreadPosts } : {}),
        readPostNumbers
      };
    }
    if (scope) {
      nextEvidence = {
        scope,
        trustworthyUnseen: Boolean(firstEvidence?.trustworthyUnseen && secondEvidence?.trustworthyUnseen),
        requiresBackfillConfirmation: false,
        malformedReading: false
      };
    }
  }

  const merged: Topic = {
    ...first,
    ...(pinned !== undefined ? { pinned } : {}),
    ...(accessRequirement ? { accessRequirement } : {}),
    ...(reading ? { reading } : {})
  };
  if (!reading && 'reading' in merged) {
    delete merged.reading;
  }
  setLinuxDoResponseReadingEvidence(merged, nextEvidence);
  return merged;
}

function mergeSequentialLinuxDoReading(
  earlier?: DiscourseTopicReading,
  later?: DiscourseTopicReading,
  laterEvidence?: LinuxDoResponseReadingEvidence
): DiscourseTopicReading | undefined {
  if (laterEvidence?.requiresBackfillConfirmation) {
    const highestPostNumber = hasValidHighestPostNumber(later?.highestPostNumber)
      ? later.highestPostNumber
      : earlier?.highestPostNumber;
    return highestPostNumber !== undefined
      ? { topicId: earlier?.topicId || later?.topicId || '', highestPostNumber, readPostNumbers: [] }
      : undefined;
  }
  if (!later) return earlier;
  if (!earlier) return later;
  const lastReadPostNumber =
    later.lastReadPostNumber !== undefined ? later.lastReadPostNumber : earlier.lastReadPostNumber;
  const highestPostNumber = hasValidHighestPostNumber(later.highestPostNumber)
    ? later.highestPostNumber
    : earlier.highestPostNumber;
  const floorChanged =
    later.lastReadPostNumber !== undefined && later.lastReadPostNumber !== earlier.lastReadPostNumber;
  const floorRegressed =
    later.lastReadPostNumber !== undefined && (later.lastReadPostNumber || 0) < (earlier.lastReadPostNumber || 0);
  const unreadPosts =
    later.unreadPosts !== undefined ? later.unreadPosts : floorChanged ? undefined : earlier.unreadPosts;
  const readPostNumbers = floorRegressed
    ? [...(later.readPostNumbers || [])]
    : mergeReadPostNumbers(earlier.readPostNumbers, later.readPostNumbers);
  return {
    topicId: earlier.topicId || later.topicId,
    ...(lastReadPostNumber !== undefined ? { lastReadPostNumber } : {}),
    ...(highestPostNumber !== undefined ? { highestPostNumber } : {}),
    ...(unreadPosts !== undefined ? { unreadPosts } : {}),
    readPostNumbers
  };
}

export function applyFeedTopicUpdate(earlier: Topic, later: Topic): Topic {
  const earlierEvidence = readingEvidenceForTopic(earlier);
  const laterEvidence = readingEvidenceForTopic(later);
  const pinned = earlier.pinned === true || later.pinned === true ? true : earlier.pinned;
  const updatedAccess = shouldUpdateAccessRequirement(earlier.accessRequirement, later.accessRequirement);
  const accessRequirement = updatedAccess ? later.accessRequirement : earlier.accessRequirement;
  const reading =
    earlier.source === 'linuxdo'
      ? mergeSequentialLinuxDoReading(earlier.reading, later.reading, laterEvidence)
      : earlier.reading;
  const readingChanged = earlier.source === 'linuxdo' && hasLinuxDoReadingChange(earlier.reading, reading);
  const pinChanged = pinned !== earlier.pinned;
  const nextEvidence: LinuxDoResponseReadingEvidence | undefined = laterEvidence
    ? {
        scope: laterEvidence.scope,
        trustworthyUnseen:
          laterEvidence.trustworthyUnseen &&
          !laterEvidence.requiresBackfillConfirmation &&
          reading?.lastReadPostNumber === undefined,
        requiresBackfillConfirmation: laterEvidence.requiresBackfillConfirmation,
        malformedReading: laterEvidence.malformedReading
      }
    : earlierEvidence && reading?.lastReadPostNumber === undefined
      ? earlierEvidence
      : undefined;
  const evidenceChanged =
    Boolean(earlierEvidence?.trustworthyUnseen) !== Boolean(nextEvidence?.trustworthyUnseen) ||
    Boolean(earlierEvidence?.requiresBackfillConfirmation) !== Boolean(nextEvidence?.requiresBackfillConfirmation) ||
    Boolean(earlierEvidence?.malformedReading) !== Boolean(nextEvidence?.malformedReading) ||
    earlierEvidence?.scope !== nextEvidence?.scope;
  if (!pinChanged && !updatedAccess && !readingChanged && !evidenceChanged) {
    return earlier;
  }
  const merged: Topic = {
    ...earlier,
    ...(pinned !== undefined ? { pinned } : {}),
    ...(accessRequirement ? { accessRequirement } : {}),
    ...(reading ? { reading } : {})
  };
  if (!reading && 'reading' in merged) {
    delete merged.reading;
  }
  setLinuxDoResponseReadingEvidence(merged, nextEvidence);
  return merged;
}

export function stripLinuxDoTopicReading(topic: Topic): Topic {
  if (topic.source !== 'linuxdo') return topic;
  const hadEvidence = linuxDoResponseReadingEvidence.has(topic);
  if (topic.reading === undefined && !hadEvidence) return topic;
  const stripped: Topic = { ...topic };
  delete stripped.reading;
  return stripped;
}

export function mergeTopicsWithLinuxDoMetadata(current: Topic[], incoming: Topic[]): Topic[] {
  const merged = mergeTopics(current, incoming);
  const candidatesByLinuxDoId = new Map<string, Topic[]>();
  for (const topic of [...current, ...incoming]) {
    if (topic.source !== 'linuxdo') continue;
    const list = candidatesByLinuxDoId.get(topic.id);
    if (list) list.push(topic);
    else candidatesByLinuxDoId.set(topic.id, [topic]);
  }
  for (let index = 0; index < merged.length; index++) {
    const topic = merged[index]!;
    if (topic.source !== 'linuxdo') continue;
    const group = candidatesByLinuxDoId.get(topic.id);
    if (!group?.length) continue;
    let resolved = group[0]!;
    for (let groupIndex = 1; groupIndex < group.length; groupIndex++) {
      resolved = applyFeedTopicUpdate(resolved, group[groupIndex]!);
    }
    if (topic.duplicateSources?.length && !resolved.duplicateSources?.length) {
      const withDuplicateSources: Topic = { ...resolved, duplicateSources: topic.duplicateSources };
      setLinuxDoResponseReadingEvidence(withDuplicateSources, readingEvidenceForTopic(resolved));
      merged[index] = withDuplicateSources;
    } else {
      merged[index] = resolved;
    }
  }
  return merged;
}

function hasSufficientExplicitUnseenEvidence(raw: Record<string, unknown>, topic: Topic) {
  if (raw.unseen !== true || topic.source !== 'linuxdo' || topic.isPrivateMessage) return false;
  if (raw.last_read_post_number !== undefined && raw.last_read_post_number !== null) return false;
  if (topic.reading?.lastReadPostNumber !== undefined) return false;
  if (
    !hasValidHighestPostNumber(raw.highest_post_number) ||
    !hasValidHighestPostNumber(topic.reading?.highestPostNumber)
  ) {
    return false;
  }
  if (raw.unread !== undefined && raw.unread !== null && raw.unread !== false) return false;
  if (raw.unread_posts !== undefined && raw.unread_posts !== null && raw.unread_posts !== 0) return false;
  if (raw.new_posts !== undefined && raw.new_posts !== null && raw.new_posts !== 0) return false;
  if (topic.reading?.readPostNumbers?.length) return false;
  return true;
}

export function isExplicitlyUnseenLinuxDoTopic(value: unknown, expectedScope?: string): boolean {
  const evidence = readingEvidenceForTopic(value);
  if (!evidence || !evidence.trustworthyUnseen || evidence.requiresBackfillConfirmation || evidence.malformedReading) {
    return false;
  }
  return expectedScope === undefined || evidence.scope === expectedScope;
}

export function hasTrustedLinuxDoFeedReading(value: unknown, expectedScope: string | undefined): boolean {
  const evidence = readingEvidenceForTopic(value);
  return Boolean(
    evidence && evidence.scope === expectedScope && !evidence.requiresBackfillConfirmation && !evidence.malformedReading
  );
}

export function linuxDoTopicRequiresReadingConfirmation(value: unknown, expectedScope?: string): boolean {
  const evidence = readingEvidenceForTopic(value);
  if (!evidence || !evidence.requiresBackfillConfirmation) {
    return false;
  }
  return expectedScope === undefined || evidence.scope === expectedScope;
}

type LinuxDoEmojiCache = { kind: 'empty' } | { kind: 'ready'; urls: DiscourseEmojiUrlMap };
let emojiUrlCache: LinuxDoEmojiCache = { kind: 'empty' };
type LinuxDoCategoryMap = Map<
  string,
  { name: string; slug?: string; parentId?: string; accessRequirement?: Topic['accessRequirement'] }
>;
type LinuxDoCategoryCache =
  | { scope: null }
  | {
      scope: string;
      state:
        | { kind: 'empty' }
        | { kind: 'pending'; request: Promise<Record<string, unknown>> }
        | { kind: 'ready'; data: Record<string, unknown>; map: LinuxDoCategoryMap };
    };
let categoryCache: LinuxDoCategoryCache = { scope: null };

type LinuxDoFeedCursorBinding = {
  source: 'linuxdo';
  identity: string;
  session: string;
  filter: string;
};

type LinuxDoFeedCursorPosition = {
  page: number;
  offset: number;
  firstId?: string;
};

type LinuxDoFeedCursorState = {
  seenIds: Set<string>;
  pinIds: Set<string>;
  pinnedIds: Set<string>;
  accessById: Map<string, AccessRequirement>;
  pageHistory: string[];
  positionHistory: string[];
};

type LinuxDoFeedCursor = LinuxDoFeedCursorPosition &
  LinuxDoFeedCursorState & {
    fromCursor: boolean;
    restarted: boolean;
  };

type LinuxDoFeedScan =
  | {
      kind: 'reading';
      page: number;
      items: Topic[];
      droppedCount: number;
      categories: LinuxDoCategoryMap;
      overlapPages: number;
      invalidPages: number;
    }
  | {
      kind: 'ready';
      items: Topic[];
      droppedCount: number;
      manualContinuation?: true;
      nextPosition?: LinuxDoFeedCursorPosition;
    };

export type LinuxDoReadAuth = {
  authenticated?: boolean;
  categoryCacheScope?: string;
  identityKey?: string;
  sessionEpoch?: number;
  readingScope?: string;
  userAgent?: string;
  onAccountFailure?: (reason: 'http-401' | 'account-recheck-required') => void;
};

export interface LinuxDoOptions {
  browserFetchIntent?: BrowserFetchIntent;
  cursor?: string | null;
  fetcher?: Fetcher;
  linuxDoAccess?: LinuxDoReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
  trackVisit?: boolean;
  trackView?: boolean;
}

export function categoryMapFromData(data: unknown) {
  const map: LinuxDoCategoryMap = new Map();
  if (!isRecord(data)) {
    return map;
  }
  const lists = [
    data.categories,
    isRecord(data.category_list) ? data.category_list.categories : undefined,
    isRecord(data.topic_list) ? data.topic_list.categories : undefined
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const category of list) {
      if (!isRecord(category) || !category.id || !category.name) {
        continue;
      }
      map.set(String(category.id), {
        name: String(category.name),
        ...(typeof category.slug === 'string' ? { slug: category.slug } : {}),
        ...(category.parent_category_id ? { parentId: String(category.parent_category_id) } : {}),
        accessRequirement: accessRequirementFromObject(category)
      });
    }
  }
  return map;
}

function topicsNeedCategoryMap(topics: unknown[], categoryMap: LinuxDoCategoryMap) {
  return topics.some((topic) => isRecord(topic) && topic.category_id && !categoryMap.has(String(topic.category_id)));
}

function activateCategoryCacheScope(options: LinuxDoOptions) {
  const scope = options.linuxDoAccess?.categoryCacheScope?.trim() || null;
  if (scope !== categoryCache.scope) {
    categoryCache = scope === null ? { scope } : { scope, state: { kind: 'empty' } };
  }
  return categoryCache;
}

function fetchCategoryData(options: LinuxDoOptions) {
  const owner = activateCategoryCacheScope(options);
  if (owner.scope === null) {
    return fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, options);
  }
  if (owner.state.kind === 'ready') return Promise.resolve(owner.state.data);
  if (owner.state.kind === 'pending') return owner.state.request;
  const request = withAbortableTimeout(
    (signal) => fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, { ...options, signal }),
    // The shared catalog owns its deadline; canceling one reader must not cancel the others.
    { timeoutMs: AGGREGATE_SOURCE_BUDGET_MS }
  )
    .then((data) => {
      if (categoryCache === owner && owner.state.kind === 'pending' && owner.state.request === request) {
        owner.state = data ? { kind: 'ready', data, map: categoryMapFromData(data) } : { kind: 'empty' };
      }
      return data;
    })
    .finally(() => {
      if (categoryCache === owner && owner.state.kind === 'pending' && owner.state.request === request) {
        owner.state = { kind: 'empty' };
      }
    });
  owner.state = { kind: 'pending', request };
  return request;
}

function waitForCategoryData(options: LinuxDoOptions) {
  const request = fetchCategoryData(options);
  return options.signal ? withAbortableTimeout(() => request, { signal: options.signal }) : request;
}

export async function categoryMapForTopics(
  data: unknown,
  topics: unknown[],
  categoryMap: LinuxDoCategoryMap,
  options: LinuxDoOptions
) {
  const cache = activateCategoryCacheScope(options);
  const cachedMap = cache.scope !== null && cache.state.kind === 'ready' ? cache.state.map : [];
  let nextCategoryMap = new Map([...cachedMap, ...categoryMap, ...categoryMapFromData(data)]);
  if (!topicsNeedCategoryMap(topics, nextCategoryMap)) {
    return nextCategoryMap;
  }
  try {
    const siteData = await waitForCategoryData(options);
    nextCategoryMap = new Map([...nextCategoryMap, ...categoryMapFromData(siteData)]);
  } catch (error) {
    if (error instanceof LinuxDoCloudflareError) {
      throw error;
    }
    // A category request can outlive its first reader and serve another reader.
    const reason = sourceErrorFromUnknown('linuxdo', error).reason;
    if (reason === 'http-401' || reason === 'account-recheck-required') {
      options.linuxDoAccess?.onAccountFailure?.(reason);
    }
  }
  return nextCategoryMap;
}

export function linuxDoLevelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

export function normalizeTopic(
  raw: unknown,
  categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>(),
  authorData?: Record<string, unknown>
): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const fields = discourseTopicFields(raw);
  if (!fields) {
    return null;
  }
  const createdAt = fields.createdAt;
  const lastReplyAt = fields.lastReplyAt;
  const category = fields.categoryId ? categoryMap.get(fields.categoryId) : undefined;
  const accessRequirement = preferredLinuxDoAccessRequirement(
    accessRequirementFromObject(raw),
    category?.accessRequirement
  );
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const creatorUsername = recordText(createdBy, 'username');
  const username = (authorData && recordText(authorData, 'username')) || creatorUsername;
  const authorName =
    discourseDisplayName(authorData) ||
    (username.toLowerCase() === creatorUsername.toLowerCase() ? discourseDisplayName(createdBy) : '') ||
    username;
  const authorAvatar = avatarUrl(authorData?.avatar_template || createdBy.avatar_template);
  const authorLevelLabel = linuxDoLevelLabel(authorData) || linuxDoLevelLabel(createdBy);
  const reading = discourseReadingFromJson(raw);
  return {
    ...fields,
    source: 'linuxdo',
    ...(raw.archetype === 'private_message' ? { isPrivateMessage: true } : {}),
    ...(reading ? { reading } : {}),
    author: authorName,
    authorId: username || undefined,
    authorAvatar,
    authorUrl: username ? userUrl(username) : undefined,
    category: category?.name || UNCATEGORIZED_CATEGORY_NAME,
    url: `${BASE_URL}/t/${raw.slug || fields.id}/${fields.id}`,
    createdAt,
    lastReplyAt,
    viewCount: fields.viewCount ?? 0,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

export function linuxDoErrorText(data: unknown, fallback = '') {
  if (!isRecord(data)) {
    return fallback;
  }
  if (typeof data.error === 'string') {
    return data.error;
  }
  if (typeof data.message === 'string') {
    return data.message;
  }
  if (Array.isArray(data.errors)) {
    return data.errors
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return fallback;
}

function linuxDoAccessRequirementFromError(error: unknown): Topic['accessRequirement'] | undefined {
  return error && typeof error === 'object'
    ? (error as { accessRequirement?: Topic['accessRequirement'] }).accessRequirement
    : undefined;
}

export async function getLinuxDoEmojiUrls(options: LinuxDoOptions = {}) {
  options = withDefaultBrowserFetchIntent(options, 'topic', 'foreground');
  if (emojiUrlCache.kind === 'ready') {
    return emojiUrlCache.urls;
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>('/emojis.json', undefined, options);
  const urls = discourseEmojiUrlMapFromData(data, BASE_URL);
  emojiUrlCache = { kind: 'ready', urls };
  return urls;
}

function boostCount(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.length : undefined;
  }
  return positiveNumber(value);
}

function boostCountFromPost(value: Record<string, unknown>) {
  return boostCount(value.boosts) ?? boostCount(value.boost_count);
}

function normalizePost(raw: unknown, topicId?: string): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const polls = discoursePolls(raw);
  const preparedDeletedReply =
    raw.user_deleted === true && !raw.deleted_at
      ? prepareLinuxDoContent(raw.cooked, polls, { checkRenderability: true, role: 'reply', topicId })
      : undefined;
  const fields = discoursePostFields(raw, {
    allowUserDeletedPlaceholder: preparedDeletedReply?.hasRenderableContent
  });
  if (!fields) return null;
  const { cookedHtml, ...replyFields } = fields;
  const prepared = preparedDeletedReply || prepareLinuxDoContent(cookedHtml, polls, { role: 'reply', topicId });
  const rawBoostCount = boostCountFromPost(raw);
  const boostFields = linuxDoBoostFields(raw);
  const needsApproval = raw.needs_category_expert_approval === true;
  const authorLevelLabel = linuxDoLevelLabel(raw);
  return {
    ...replyFields,
    policy: discoursePostPolicy(raw),
    ...(typeof raw.read === 'boolean' ? { serverRead: raw.read } : {}),
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: fields.authorId ? userUrl(fields.authorId) : undefined,
    contentHtml: prepared.preparedContent.contentHtml,
    preparedContent: prepared.preparedContent,
    ...(prepared.quotedPosts.length ? { quotedPosts: prepared.quotedPosts } : {}),
    ...(rawBoostCount || needsApproval || Object.keys(boostFields).length
      ? {
          siteExtension: {
            ...boostFields,
            ...(rawBoostCount ? { boostCount: rawBoostCount } : {}),
            ...(needsApproval ? { needsApproval: true } : {})
          }
        }
      : {}),
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(polls ? { polls } : {})
  };
}

export function linuxDoEditedReplyFromAction(result: unknown, topicId: string, commentId: number): Reply | null {
  if (!isRecord(result) || !isRecord(result.post)) return null;
  const post = result.post;
  if (
    post.id !== commentId ||
    String(post.topic_id) !== topicId ||
    typeof post.post_number !== 'number' ||
    !Number.isSafeInteger(post.post_number) ||
    post.post_number <= 1 ||
    typeof post.cooked !== 'string' ||
    !post.cooked.trim()
  )
    return null;
  try {
    return normalizePost(post, topicId);
  } catch {
    // A body that cannot be rendered does not undo the confirmed write.
    return null;
  }
}

async function linuxDoHeaders(
  access: LinuxDoOptions['linuxDoAccess'],
  referer = `${BASE_URL}/latest`,
  csrfToken?: string,
  signal?: AbortSignal
) {
  const loggedIn = access?.authenticated === true;
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Referer: referer,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'User-Agent': await resolveWebViewUserAgent(access?.userAgent, signal),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    'X-Requested-With': 'XMLHttpRequest',
    ...(loggedIn ? { 'Discourse-Logged-In': 'true' } : {})
  };
}

export async function fetchLinuxDoJson<T>(
  path: string,
  params: Record<string, string | number | (string | number)[]> | undefined,
  options: LinuxDoOptions = {},
  requestOptions: { referer?: string; csrfToken?: string } = {}
) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(
    url.toString(),
    withBrowserFetchIntent(
      {
        headers: {
          ...(await linuxDoHeaders(
            options.linuxDoAccess,
            requestOptions.referer,
            requestOptions.csrfToken,
            options.signal
          )),
          ...(options.trackView && /^\/t\/\d+(?:\/\d+)?\.json$/.test(url.pathname)
            ? { 'Discourse-Track-View': '1', 'Discourse-Track-View-Topic-Id': url.pathname.match(/^\/t\/(\d+)/)![1] }
            : {})
        }
      },
      options.browserFetchIntent || { owner: 'feed', priority: 'foreground' }
    ),
    options
  );
  const text = await response.text();
  return proveForumReadResponse(response, () => {
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      throw new LinuxDoCloudflareError(response);
    }
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        const bodyMessage = textContentFromHtml(text);
        const accessRequirement = accessRequirementFromText(bodyMessage);
        if (!response.ok || accessRequirement) {
          const message = accessRequirement ? bodyMessage : `HTTP ${response.status}`;
          throw linuxDoRequestError(message, response.status);
        }
        throw new Error('linux.do 返回内容格式不正确');
      }
    }
    if (!response.ok) {
      const message = linuxDoErrorText(data, `HTTP ${response.status}`);
      throw linuxDoRequestError(message, response.status, data);
    }
    return data as T;
  });
}

function topicStreamState(data: unknown) {
  const postStream = isRecord(data) && isRecord(data.post_stream) ? data.post_stream : {};
  const stream = Array.isArray(postStream.stream) ? postStream.stream : [];
  const embeddedPosts = Array.isArray(postStream.posts) ? postStream.posts : [];
  return { stream, embeddedPosts };
}

function linuxDoFeedRows(data: Record<string, unknown> | undefined) {
  return isRecord(data?.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
}

function isLinuxDoFeedPin(raw: Record<string, unknown>, category?: string, sitePins = false) {
  if (raw.unpinned === true ? !sitePins : raw.pinned !== true) return false;
  if (!category) return raw.pinned_globally === true;
  return !/^\d+$/.test(category) || String(raw.category_id) === String(Number(category));
}

function normalizeLinuxDoFeedRows(
  rows: unknown[],
  data: Record<string, unknown> | undefined,
  categoryMap: LinuxDoCategoryMap,
  category?: string,
  sitePins = false,
  readingScope: string | null = null
) {
  const users = discourseUsersById(data?.users);
  return rows.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const topic = normalizeTopic(raw, categoryMap, discourseOriginalPoster(raw, users));
    if (!topic) return [];
    topic.pinned = isLinuxDoFeedPin(raw, category, sitePins) || undefined;
    if (readingScope && !topic.isPrivateMessage) {
      const malformedReading = hasMalformedLinuxDoReadingField(raw);
      const trustworthyUnseen = !malformedReading && hasSufficientExplicitUnseenEvidence(raw, topic);
      setLinuxDoResponseReadingEvidence(topic, {
        scope: readingScope,
        trustworthyUnseen,
        requiresBackfillConfirmation: false,
        malformedReading
      });
    }
    return [topic];
  });
}

function deduplicateSameResponseLinuxDoRows(rows: readonly Topic[]): Topic[] {
  const pageUnique: Topic[] = [];
  const pageIndexById = new Map<string, number>();
  for (const item of rows) {
    const existingIndex = pageIndexById.get(item.id);
    if (existingIndex !== undefined) {
      pageUnique[existingIndex] = mergeSameResponseDuplicateLinuxDoTopic(pageUnique[existingIndex]!, item);
      continue;
    }
    pageIndexById.set(item.id, pageUnique.length);
    pageUnique.push(item);
  }
  return pageUnique;
}

type LinuxDoUpstreamContinuation =
  | { kind: 'none' }
  | { kind: 'points-back'; targetUpstreamPage: number }
  | { kind: 'advances'; nextPage: number; explicitPage?: number };

function linuxDoFilterBaseSegment(filter: DiscourseFeedFilter) {
  return filter === 'hot' ? 'hot' : filter === 'latest' ? 'latest' : 'new';
}

function parseLinuxDoUpstreamContinuation(
  rawUrl: unknown,
  filter: DiscourseFeedFilter,
  category: string | undefined,
  currentUpstreamPage: number
): LinuxDoUpstreamContinuation {
  if (typeof rawUrl !== 'string') return { kind: 'none' };
  const trimmed = rawUrl.trim();
  if (!trimmed) return { kind: 'none' };
  let target: URL;
  try {
    target = new URL(trimmed, BASE_URL);
  } catch {
    return { kind: 'none' };
  }
  if (target.origin !== BASE_URL) return { kind: 'none' };
  const baseSegment = linuxDoFilterBaseSegment(filter);
  const pathPattern = new RegExp(`^\\/(?:c\\/[^/]+(?:\\/[^/]+)*\\/l\\/)?${baseSegment}(?:\\.json)?$`);
  if (!pathPattern.test(target.pathname)) return { kind: 'none' };
  if (filter === 'new-topics' && target.searchParams.has('subset') && target.searchParams.get('subset') !== 'topics') {
    return { kind: 'none' };
  }
  if (
    filter === 'new-replies' &&
    target.searchParams.has('subset') &&
    target.searchParams.get('subset') !== 'replies'
  ) {
    return { kind: 'none' };
  }
  if (category) {
    const expectedCategory = /^\d+$/.test(category) ? String(Number(category)) : category;
    if (target.searchParams.has('category') && target.searchParams.get('category') !== expectedCategory) {
      return { kind: 'none' };
    }
    const pathCategoryIdMatch = target.pathname.match(/^\/c\/(?:[^/]+\/)*(\d+)\/l\//);
    if (pathCategoryIdMatch && /^\d+$/.test(category) && pathCategoryIdMatch[1] !== expectedCategory) {
      return { kind: 'none' };
    }
  }
  const pages = target.searchParams.getAll('page');
  if (pages.length > 1) return { kind: 'none' };
  if (pages.length === 1) {
    const rawPage = pages[0]!.trim();
    if (!rawPage) return { kind: 'none' };
    if (/^\d+$/.test(rawPage)) {
      const targetUpstreamPage = Number(rawPage);
      if (!Number.isSafeInteger(targetUpstreamPage)) return { kind: 'none' };
      if (targetUpstreamPage <= currentUpstreamPage) {
        return { kind: 'points-back', targetUpstreamPage };
      }
      return { kind: 'advances', nextPage: targetUpstreamPage + 1, explicitPage: targetUpstreamPage };
    }
    return { kind: 'advances', nextPage: currentUpstreamPage + 2 };
  }
  const beforeValues = target.searchParams.getAll('before');
  if (beforeValues.length === 1 && beforeValues[0]!.trim()) {
    return { kind: 'advances', nextPage: currentUpstreamPage + 2 };
  }
  return { kind: 'none' };
}

function hasValidLinuxDoPinContinuation(rawUrl: unknown, currentFilterPage: number) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const target = new URL(rawUrl.trim(), BASE_URL);
    if (target.origin !== BASE_URL) return false;
    if (!/^\/filter(?:\.json)?$/.test(target.pathname)) return false;
    const pages = target.searchParams.getAll('page');
    if (pages.length === 1 && /^\d+$/.test(pages[0]!.trim())) {
      const nextPage = Number(pages[0]!.trim());
      return Number.isSafeInteger(nextPage) && nextPage > currentFilterPage;
    }
    return pages.length === 1 && Boolean(pages[0]!.trim());
  } catch {
    return false;
  }
}

async function latestLinuxDoPins(options: LinuxDoOptions, categoryMap: LinuxDoCategoryMap, category?: string) {
  const signedIn = options.linuxDoAccess?.authenticated === true;
  const readingScope = linuxDoResponseReadingScope(options.linuxDoAccess);
  let slug = category;
  if (signedIn && category && /^\d+$/.test(category)) {
    const path: string[] = [];
    const seen = new Set<string>();
    let id: string | undefined = String(Number(category));
    while (id) {
      const entry = categoryMap.get(id);
      if (!entry?.slug || seen.has(id)) return [];
      seen.add(id);
      path.unshift(entry.slug);
      id = entry.parentId;
    }
    slug = path.join(':');
  }
  const query = slug ? `in:pinned =category:${slug}` : 'in:pinned';
  let pins: Topic[] = [];
  await withAbortableTimeout(
    async (signal) => {
      const seen = new Set<string>();
      for (let page = 0; !signal.aborted; page++) {
        // The signed-in activity list omits read pins. The pin index retains them and checks permissions.
        const data = await fetchLinuxDoJson<Record<string, unknown>>(
          signedIn ? '/filter.json' : linuxDoFeedPath('latest'),
          signedIn ? { q: query, ...(page ? { page } : {}) } : category ? { category } : undefined,
          { ...options, signal }
        );
        if (signal.aborted) return;
        const rows = linuxDoFeedRows(data);
        const scoped = rows.filter((row) => isRecord(row) && isLinuxDoFeedPin(row, category, signedIn));
        const normalizedPins = deduplicateSameResponseLinuxDoRows(
          normalizeLinuxDoFeedRows(scoped, data, categoryMap, category, signedIn, readingScope)
        );
        pins = mergeTopicsWithLinuxDoMetadata(pins, normalizedPins);
        if (
          !signedIn ||
          !isRecord(data.topic_list) ||
          !hasValidLinuxDoPinContinuation(data.topic_list.more_topics_url, page)
        ) {
          return;
        }
        const previous = seen.size;
        for (const row of rows) {
          if (isRecord(row) && (typeof row.id === 'number' || typeof row.id === 'string')) seen.add(String(row.id));
        }
        if (seen.size === previous) return;
      }
    },
    { signal: options.signal, timeoutMs: LATEST_PINS_TIMEOUT_MS }
  ).catch(() => undefined);
  return pins;
}

function legacyLinuxDoFeedPosition(page: number, limit: number): LinuxDoFeedCursorPosition {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const start = (safePage - 1) * limit;
  return {
    page: Math.floor(start / LIST_PAGE_SIZE) + 1,
    offset: start % LIST_PAGE_SIZE
  };
}

function shouldUpdateAccessRequirement(current?: AccessRequirement, incoming?: AccessRequirement) {
  if (!incoming) return false;
  if (!current) return true;
  const currentSpecificity = accessRequirementSpecificity(current);
  const incomingSpecificity = accessRequirementSpecificity(incoming);
  if (incomingSpecificity !== currentSpecificity) return incomingSpecificity > currentSpecificity;
  if (current.type === 'level' && incoming.type === 'level') {
    const currentLevel = accessRequirementLevelValue(current);
    const incomingLevel = accessRequirementLevelValue(incoming);
    if (currentLevel !== incomingLevel) {
      if (!currentLevel) return Boolean(incomingLevel);
      if (!incomingLevel) return false;
      return incomingLevel > currentLevel;
    }
  }
  return current.label !== incoming.label || current.detail !== incoming.detail;
}

function parseCursorIdSet(value: unknown) {
  return new Set<string>(
    Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean) : []
  );
}

function parseCursorStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items.slice(-limit);
}

function parseCursorAccessMap(value: unknown) {
  const map = new Map<string, AccessRequirement>();
  if (!isRecord(value)) return map;
  for (const [rawId, rawAccess] of Object.entries(value)) {
    const id = rawId.trim();
    if (!id || !isRecord(rawAccess)) continue;
    const type = rawAccess.type;
    const label = rawAccess.label;
    if ((type !== 'login' && type !== 'level' && type !== 'permission') || typeof label !== 'string') continue;
    const detail = typeof rawAccess.detail === 'string' ? rawAccess.detail : undefined;
    map.set(id, detail === undefined ? { type, label } : { type, label, detail });
  }
  return map;
}

function emptyLinuxDoFeedCursorState(): LinuxDoFeedCursorState {
  return {
    seenIds: new Set<string>(),
    pinIds: new Set<string>(),
    pinnedIds: new Set<string>(),
    accessById: new Map<string, AccessRequirement>(),
    pageHistory: [],
    positionHistory: []
  };
}

function linuxDoFeedCursorBinding(
  access: LinuxDoReadAuth | undefined,
  filter: DiscourseFeedFilter,
  category?: string
): LinuxDoFeedCursorBinding {
  const authenticated = access?.authenticated === true;
  const identity = authenticated
    ? access.identityKey?.trim() || access.readingScope?.trim() || 'authenticated'
    : 'anonymous';
  const session =
    access?.sessionEpoch !== undefined && Number.isSafeInteger(access.sessionEpoch)
      ? String(access.sessionEpoch)
      : access?.categoryCacheScope?.trim() ||
        access?.readingScope?.trim() ||
        (authenticated ? 'authenticated' : 'public');
  return {
    source: 'linuxdo',
    identity,
    session,
    filter: `${filter}:${category?.trim() || ''}`
  };
}

function cursorBindingMatches(raw: unknown, expected: LinuxDoFeedCursorBinding) {
  return (
    isRecord(raw) &&
    raw.source === expected.source &&
    raw.identity === expected.identity &&
    raw.session === expected.session &&
    raw.filter === expected.filter
  );
}

function computeLinuxDoPageFingerprint(topics: readonly Topic[]) {
  const sorted = topics.map((item) => item.id).sort();
  const ids = sorted.join(',');
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < ids.length; index++) {
    const code = ids.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${sorted.length}:${sorted[0] ?? ''}:${sorted.at(-1) ?? ''}:${hashA.toString(36)}:${hashB.toString(36)}`;
}

function decodeLinuxDoFeedCursor(
  cursor: string | null | undefined,
  page: number,
  limit: number,
  binding: LinuxDoFeedCursorBinding
): LinuxDoFeedCursor {
  const fallback = (): LinuxDoFeedCursor => ({
    ...legacyLinuxDoFeedPosition(page, limit),
    ...emptyLinuxDoFeedCursorState(),
    fromCursor: false,
    restarted: false
  });
  const restartFromPageZero = (): LinuxDoFeedCursor => ({
    page: 1,
    offset: 0,
    ...emptyLinuxDoFeedCursorState(),
    fromCursor: false,
    restarted: true
  });
  const trimmed = typeof cursor === 'string' ? cursor.trim() : '';
  if (!trimmed) return fallback();
  if (/^[1-9]\d*$/.test(trimmed)) {
    const legacyPage = Number(trimmed);
    if (Number.isSafeInteger(legacyPage) && legacyPage >= 1) {
      return {
        ...legacyLinuxDoFeedPosition(legacyPage, limit),
        ...emptyLinuxDoFeedCursorState(),
        fromCursor: false,
        restarted: false
      };
    }
    return fallback();
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(trimmed));
    if (!isRecord(parsed)) return fallback();
    if ('bind' in parsed && !cursorBindingMatches(parsed.bind, binding)) {
      return restartFromPageZero();
    }
    const upstreamPage = parsed.page;
    if (typeof upstreamPage !== 'number' || !Number.isSafeInteger(upstreamPage) || upstreamPage < 1) {
      return fallback();
    }
    const offset =
      typeof parsed.offset === 'number' && Number.isSafeInteger(parsed.offset) && parsed.offset >= 0
        ? parsed.offset
        : 0;
    const firstId = typeof parsed.firstId === 'string' && parsed.firstId.trim() ? parsed.firstId.trim() : undefined;
    const seenIds = parseCursorIdSet(parsed.seenIds);
    const pinIds = parseCursorIdSet(parsed.pinIds);
    const pinnedIds = new Set<string>([...pinIds, ...parseCursorIdSet(parsed.pinnedIds)]);
    const accessById = parseCursorAccessMap(parsed.accessById);
    const pageHistory = parseCursorStringList(parsed.pageHistory, LINUXDO_FEED_HISTORY_LIMIT);
    const positionHistory = parseCursorStringList(parsed.positionHistory, LINUXDO_FEED_HISTORY_LIMIT);
    return {
      page: upstreamPage,
      offset,
      ...(firstId ? { firstId } : {}),
      seenIds,
      pinIds,
      pinnedIds,
      accessById,
      pageHistory,
      positionHistory,
      fromCursor: true,
      restarted: false
    };
  } catch {
    return fallback();
  }
}

function encodeLinuxDoFeedCursor(
  position: LinuxDoFeedCursorPosition,
  state: LinuxDoFeedCursorState,
  binding: LinuxDoFeedCursorBinding,
  limit: number
) {
  const maxSeen = Math.max(LINUXDO_FEED_CURSOR_SEEN_LIMIT, limit);
  const retainedSeenIds = Array.from(state.seenIds).slice(-maxSeen);
  const retainedPinIds = Array.from(state.pinIds).slice(-maxSeen);
  const retainedPinIdSet = new Set(retainedPinIds);
  const retainedIdSet = new Set([...retainedSeenIds, ...retainedPinIds]);
  const retainedPinnedIds = Array.from(state.pinnedIds).filter(
    (id) => retainedIdSet.has(id) && !retainedPinIdSet.has(id)
  );
  const retainedAccessEntries = Array.from(state.accessById.entries()).filter(([id]) => retainedIdSet.has(id));
  const retainedPageHistory = state.pageHistory.slice(-LINUXDO_FEED_HISTORY_LIMIT);
  const retainedPositionHistory = state.positionHistory.slice(-LINUXDO_FEED_HISTORY_LIMIT);
  return encodeURIComponent(
    JSON.stringify({
      v: 2,
      bind: binding,
      page: position.page,
      offset: position.offset,
      ...(position.firstId ? { firstId: position.firstId } : {}),
      seenIds: retainedSeenIds,
      ...(retainedPinIds.length ? { pinIds: retainedPinIds } : {}),
      ...(retainedPinnedIds.length ? { pinnedIds: retainedPinnedIds } : {}),
      ...(retainedAccessEntries.length ? { accessById: Object.fromEntries(retainedAccessEntries) } : {}),
      ...(retainedPageHistory.length ? { pageHistory: retainedPageHistory } : {}),
      ...(retainedPositionHistory.length ? { positionHistory: retainedPositionHistory } : {})
    })
  );
}

export async function getLinuxDoFeed(
  options: LinuxDoOptions & {
    aggregateHead?: boolean;
    page?: number;
    limit?: number;
    category?: string;
    linuxDoFilter?: DiscourseFeedFilter;
  } = {}
): Promise<FeedResponse> {
  options = withDefaultBrowserFetchIntent(options, 'feed', 'foreground');
  const page =
    typeof options.page === 'number' && Number.isSafeInteger(options.page) && options.page >= 1 ? options.page : 1;
  const limit = options.limit || 30;
  const linuxDoFilter = options.linuxDoFilter || 'latest';
  const authenticated = options.linuxDoAccess?.authenticated === true;
  const readingScope = linuxDoResponseReadingScope(options.linuxDoAccess);
  const cursorBinding = linuxDoFeedCursorBinding(options.linuxDoAccess, linuxDoFilter, options.category);
  const startCursor = decodeLinuxDoFeedCursor(options.cursor, page, limit, cursorBinding);
  const seenIds = new Set(startCursor.seenIds);
  const pinIds = new Set(startCursor.pinIds);
  const pinnedIds = new Set(startCursor.pinnedIds);
  const accessById = new Map(startCursor.accessById);
  const pageHistory = [...startCursor.pageHistory];
  const pageHistorySet = new Set(pageHistory);
  const positionHistory = [...startCursor.positionHistory];
  const positionHistorySet = new Set(positionHistory);
  const topicUpdatesById = new Map<string, Topic>();
  let pins: Topic[] = [];

  const appendHistory = (list: string[], set: Set<string>, entry: string) => {
    if (set.has(entry)) return;
    list.push(entry);
    set.add(entry);
    while (list.length > LINUXDO_FEED_HISTORY_LIMIT) {
      const evicted = list.shift();
      if (evicted !== undefined) set.delete(evicted);
    }
  };

  const recordTopicMetadata = (topic: Topic) => {
    if (topic.pinned === true) pinnedIds.add(topic.id);
    if (topic.accessRequirement && shouldUpdateAccessRequirement(accessById.get(topic.id), topic.accessRequirement)) {
      accessById.set(topic.id, topic.accessRequirement);
    }
  };

  const recordTopicUpdate = (candidate: Topic, currentItems: Topic[], isKnownCompletedPage: boolean) => {
    const wasPinned = pinnedIds.has(candidate.id);
    const previousAccess = accessById.get(candidate.id);
    const gainedPin = !wasPinned && candidate.pinned === true;
    const updatedAccess = shouldUpdateAccessRequirement(previousAccess, candidate.accessRequirement);
    const candidateEvidence = readingEvidenceForTopic(candidate);
    const hasExplicitReadingObservation =
      authenticated &&
      !candidate.isPrivateMessage &&
      (candidate.reading?.lastReadPostNumber !== undefined ||
        Boolean(candidateEvidence?.requiresBackfillConfirmation) ||
        Boolean(candidateEvidence?.malformedReading) ||
        (!isKnownCompletedPage && Boolean(candidate.reading || candidateEvidence)));

    if (!gainedPin && !updatedAccess && !hasExplicitReadingObservation) return;
    if (gainedPin) pinnedIds.add(candidate.id);
    const nextAccess = updatedAccess ? candidate.accessRequirement : previousAccess;
    if (updatedAccess && candidate.accessRequirement) {
      accessById.set(candidate.id, candidate.accessRequirement);
    }
    const inCurrentIndex = currentItems.findIndex((item) => item.id === candidate.id);
    if (inCurrentIndex >= 0) {
      currentItems[inCurrentIndex] = applyFeedTopicUpdate(currentItems[inCurrentIndex]!, candidate);
      return;
    }
    const existingUpdate = topicUpdatesById.get(candidate.id);
    if (existingUpdate) {
      topicUpdatesById.set(candidate.id, applyFeedTopicUpdate(existingUpdate, candidate));
      return;
    }
    const updateTopic: Topic = {
      ...candidate,
      ...(wasPinned || candidate.pinned ? { pinned: true } : {}),
      ...(nextAccess ? { accessRequirement: nextAccess } : {})
    };
    setLinuxDoResponseReadingEvidence(updateTopic, candidateEvidence);
    topicUpdatesById.set(candidate.id, updateTopic);
  };

  let scan: LinuxDoFeedScan =
    0 < limit
      ? {
          kind: 'reading',
          page: startCursor.page,
          items: [],
          droppedCount: 0,
          categories: new Map(),
          overlapPages: 0,
          invalidPages: 0
        }
      : { kind: 'ready', items: [], droppedCount: 0 };

  while (scan.kind === 'reading') {
    if (options.signal?.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    const currentUpstreamPage = scan.page - 1;
    const data = await fetchLinuxDoJson<Record<string, unknown>>(
      linuxDoFeedPath(linuxDoFilter),
      linuxDoFeedParams(scan.page, options.category, linuxDoFilter),
      options
    );
    const topics = linuxDoFeedRows(data);
    const firstLatest =
      (page === 1 || startCursor.restarted) &&
      !startCursor.fromCursor &&
      scan.page === 1 &&
      linuxDoFilter === 'latest' &&
      !options.signal?.aborted;
    const showSitePins = linuxDoFilter === 'latest' && authenticated;
    const categoryMap = await categoryMapForTopics(data, topics, scan.categories, options);
    const normalized = normalizeLinuxDoFeedRows(
      topics,
      data,
      categoryMap,
      options.category,
      showSitePins,
      readingScope
    );
    const pageUnique = deduplicateSameResponseLinuxDoRows(normalized);
    if (firstLatest && pageUnique.length && !options.signal?.aborted) {
      const indexed = await latestLinuxDoPins(options, categoryMap, options.category);
      const latestById = new Map(pageUnique.map((topic) => [topic.id, topic]));
      pins = indexed.map((pin) => {
        const latest = latestById.get(pin.id);
        return latest ? applyFeedTopicUpdate(latest, pin) : pin;
      });
      for (const pin of pins) {
        pinIds.add(pin.id);
        recordTopicMetadata(pin);
      }
    }
    const droppedCount = scan.droppedCount + Math.max(0, topics.length - normalized.length);

    // Judgment 1: whether upstream provides a verifiable same-site advancing next page.
    const rawMoreTopicsUrl = isRecord(data.topic_list) ? data.topic_list.more_topics_url : undefined;
    const upstreamContinuation: LinuxDoUpstreamContinuation =
      topics.length > 0
        ? parseLinuxDoUpstreamContinuation(rawMoreTopicsUrl, linuxDoFilter, options.category, currentUpstreamPage)
        : { kind: 'none' };
    const continuationPointsBack =
      upstreamContinuation.kind === 'points-back' ||
      (upstreamContinuation.kind === 'advances' &&
        upstreamContinuation.explicitPage !== undefined &&
        positionHistorySet.has(`p:${upstreamContinuation.explicitPage}`));
    const upstreamHasNext = upstreamContinuation.kind === 'advances' && !continuationPointsBack;

    // Judgment 2: whether displayable new items exist on this page (independent of 200-ID cache for known full pages).
    const isResumingPartialStartPage = scan.page === startCursor.page && startCursor.offset > 0;
    const fullPageFingerprint = pageUnique.length > 0 ? computeLinuxDoPageFingerprint(pageUnique) : null;
    const isKnownCompletedPage =
      !isResumingPartialStartPage && fullPageFingerprint !== null && pageHistorySet.has(fullPageFingerprint);

    const anchorIndex = startCursor.firstId ? pageUnique.findIndex((item) => item.id === startCursor.firstId) : -1;
    let sliceStart: number;
    if (scan.page !== startCursor.page || startCursor.offset === 0) {
      sliceStart = 0;
    } else if (startCursor.seenIds.size > 0 || startCursor.pinIds.size > 0) {
      if (startCursor.offset <= startCursor.seenIds.size + startCursor.pinIds.size) {
        sliceStart = 0;
      } else {
        const searchLimit = anchorIndex >= 0 ? anchorIndex : pageUnique.length;
        const knownBoundary = pageUnique
          .slice(0, searchLimit)
          .findIndex((item) => seenIds.has(item.id) || pinIds.has(item.id));
        sliceStart = knownBoundary >= 0 ? knownBoundary : anchorIndex >= 0 ? anchorIndex : startCursor.offset;
      }
    } else {
      sliceStart = anchorIndex >= 0 ? anchorIndex : startCursor.offset;
    }

    const freshEntries: { topic: Topic; pageIndex: number }[] = [];
    const seenEntries: { topic: Topic; pageIndex: number }[] = [];
    if (isKnownCompletedPage) {
      for (let index = 0; index < pageUnique.length; index++) {
        seenEntries.push({ topic: pageUnique[index]!, pageIndex: index });
      }
    } else {
      for (let index = 0; index < Math.min(sliceStart, pageUnique.length); index++) {
        const candidate = pageUnique[index]!;
        if (seenIds.has(candidate.id) || pinIds.has(candidate.id)) {
          seenEntries.push({ topic: candidate, pageIndex: index });
        }
      }
      for (let index = sliceStart; index < pageUnique.length; index++) {
        const candidate = pageUnique[index]!;
        if (seenIds.has(candidate.id) || pinIds.has(candidate.id) || (options.aggregateHead && candidate.pinned)) {
          seenEntries.push({ topic: candidate, pageIndex: index });
          continue;
        }
        freshEntries.push({ topic: candidate, pageIndex: index });
      }
    }

    const hasDisplayableNewItems = freshEntries.length > 0;
    const remaining = limit - scan.items.length;
    const takeCount = Math.min(remaining, freshEntries.length);
    const overflow = freshEntries[takeCount];
    const consumedEnd = overflow ? overflow.pageIndex : pageUnique.length;

    for (const entry of seenEntries) {
      if (entry.pageIndex < consumedEnd) {
        const topic = entry.topic;
        if (firstLatest && pinIds.has(topic.id)) continue;
        const hiddenPin = options.aggregateHead && (topic.pinned || pinnedIds.has(topic.id));
        recordTopicUpdate(hiddenPin ? stripLinuxDoTopicReading(topic) : topic, scan.items, isKnownCompletedPage);
      }
    }
    for (let index = 0; index < takeCount; index++) {
      const entry = freshEntries[index]!;
      scan.items.push(entry.topic);
      seenIds.add(entry.topic.id);
      recordTopicMetadata(entry.topic);
    }
    for (let index = sliceStart; index < consumedEnd; index++) {
      seenIds.add(pageUnique[index]!.id);
    }

    if (!overflow) {
      appendHistory(positionHistory, positionHistorySet, `p:${currentUpstreamPage}`);
      if (fullPageFingerprint && !isKnownCompletedPage) {
        appendHistory(pageHistory, pageHistorySet, fullPageFingerprint);
      }
    }

    const nextInvalidPages = !hasDisplayableNewItems && pageUnique.length === 0 ? scan.invalidPages + 1 : 0;
    const nextOverlapPages = hasDisplayableNewItems ? 0 : scan.overlapPages + 1;

    // Aggregate head returns the first usable upstream page after removing pins and duplicates.
    if (scan.items.length >= limit || (options.aggregateHead && hasDisplayableNewItems)) {
      const nextPosition = overflow
        ? { page: scan.page, offset: overflow.pageIndex, firstId: overflow.topic.id }
        : upstreamHasNext
          ? { page: upstreamContinuation.nextPage, offset: 0 }
          : undefined;
      scan = {
        kind: 'ready',
        items: scan.items,
        droppedCount,
        nextPosition
      };
    } else if (
      !upstreamHasNext ||
      (upstreamContinuation.explicitPage === undefined && nextInvalidPages >= LINUXDO_FEED_MAX_STALLED_PAGES)
    ) {
      scan = { kind: 'ready', items: scan.items, droppedCount };
    } else if (nextOverlapPages >= LINUXDO_FEED_MAX_OVERLAP_PAGES) {
      scan = {
        kind: 'ready',
        items: scan.items,
        droppedCount,
        manualContinuation: true,
        nextPosition: { page: upstreamContinuation.nextPage, offset: 0 }
      };
    } else {
      scan = {
        kind: 'reading',
        page: upstreamContinuation.nextPage,
        items: scan.items,
        droppedCount,
        categories: categoryMap,
        overlapPages: nextOverlapPages,
        invalidPages: nextInvalidPages
      };
    }
  }

  let items = pins.length ? [...pins, ...scan.items] : scan.items;
  if (topicUpdatesById.size) {
    items = items.map((item) => {
      const update = topicUpdatesById.get(item.id);
      if (!update) return item;
      topicUpdatesById.delete(item.id);
      return applyFeedTopicUpdate(item, update);
    });
  }
  const topicUpdates = topicUpdatesById.size ? [...topicUpdatesById.values()] : undefined;
  const hasMore = Boolean(scan.nextPosition);
  const nextCursor = scan.nextPosition
    ? encodeLinuxDoFeedCursor(
        scan.nextPosition,
        {
          seenIds,
          pinIds,
          pinnedIds,
          accessById,
          pageHistory,
          positionHistory
        },
        cursorBinding,
        limit
      )
    : null;
  const result: FeedResponse = {
    items,
    ...(topicUpdates ? { topicUpdates } : {}),
    errors: {},
    hasMore,
    ...(scan.manualContinuation ? { manualContinuation: true } : {}),
    nextPage: hasMore ? page + 1 : null,
    nextCursor
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-feed',
    candidateCount: result.items.length + scan.droppedCount,
    validCount: result.items.length,
    droppedCount: scan.droppedCount,
    isExpectedEmpty:
      result.items.length === 0 && scan.droppedCount === 0 && (page > 1 || Boolean(options.category) || hasMore),
    isParseEmpty: page === 1 && !options.category && !hasMore && result.items.length === 0 && scan.droppedCount === 0,
    hasRepeatedCursor: result.nextPage === page || Boolean(nextCursor && nextCursor === options.cursor)
  });
}

export async function getLinuxDoCategories(options: LinuxDoOptions = {}): Promise<CategoriesResponse> {
  options = withDefaultBrowserFetchIntent(options, 'feed', 'foreground');
  const data = await waitForCategoryData(options);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories)
      ? data.category_list.categories
      : [];
  const result = {
    items: discourseCategories(data, 'linuxdo', { includeParentSlug: true }),
    errors: {}
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-categories',
    candidateCount: categories.length,
    validCount: result.items.length,
    droppedCount: Math.max(0, categories.length - result.items.length),
    isParseEmpty: categories.length === 0
  });
}

async function topicData(id: string, options: LinuxDoOptions, targetFloor?: number) {
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}${targetFloor ? `/${targetFloor}` : ''}.json`,
    {
      ...(options.trackVisit ? { track_visit: 'true', forceLoad: 'true' } : {}),
      ...(targetFloor || options.linuxDoAccess?.authenticated ? { include_raw: 'true' } : {})
    },
    options
  );
  assertDiscourseTopicIdentity(data, id);
  return data;
}

export async function getLinuxDoTopic(
  id: string,
  options: LinuxDoOptions & { replyLimit?: number } = {}
): Promise<TopicDetail> {
  options = withDefaultBrowserFetchIntent(options, 'topic', 'foreground');
  let data: Record<string, unknown>;
  try {
    data = await topicData(id, options);
  } catch (error) {
    const accessRequirement = linuxDoAccessRequirementFromError(error);
    if (!accessRequirement) {
      throw error;
    }
    const contentHtml = accessRequirement.detail || (error instanceof Error ? error.message : accessRequirement.label);
    return annotateSourceDiagnosticSummary(
      {
        source: 'linuxdo',
        id,
        title: '受限帖子',
        author: '',
        url: `${BASE_URL}/t/${id}`,
        createdAt: '',
        replyCount: 0,
        contentHtml,
        replies: [],
        replyCompleteness: 'complete',
        replyHasMore: false,
        replyNextPage: null,
        accessRequirement
      },
      {
        parserVariant: 'access-restricted-topic',
        candidateCount: 1,
        validCount: 1,
        droppedCount: 0
      }
    );
  }
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const [firstPost, ...replyPosts] = posts;
  const firstPostRecord = isRecord(firstPost) ? firstPost : undefined;
  const polls = discoursePolls(firstPost);
  const preparedDeletedOpening =
    firstPostRecord?.user_deleted === true && !firstPostRecord.deleted_at
      ? prepareLinuxDoContent(firstPostRecord.cooked, polls, {
          checkRenderability: true,
          role: 'opening',
          topicId: id
        })
      : undefined;
  const firstPostFields = discoursePostFields(firstPost, {
    allowUserDeletedPlaceholder: preparedDeletedOpening?.hasRenderableContent
  });
  if (!firstPostFields) {
    throw new Error('linux.do 主题正文解析失败');
  }
  const categoryMap = await categoryMapForTopics(data, [data], categoryMapFromData(data), options);
  const topic = normalizeTopic(data, categoryMap, firstPostRecord);
  if (!topic) {
    throw new Error('linux.do 主题不存在');
  }
  const replyLimit = options.replyLimit || 30;
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const initialReplyPosts = replyPosts.slice(0, replyLimit);
  const replies = initialReplyPosts.map((post) => normalizePost(post, topic.id)).filter((reply) => reply !== null);
  const totalPosts = stream.length || (topic.replyCount || 0) + 1;
  const replyHasMore = totalPosts > initialReplyPosts.length + 1;
  const firstPostBoostCount = isRecord(firstPost) ? boostCountFromPost(firstPost) : undefined;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (options.signal?.aborted) {
    throw new Error(REQUEST_CANCELED_MESSAGE);
  }
  const preparedContent =
    preparedDeletedOpening?.preparedContent ||
    prepareLinuxDoContent(firstPostFields.cookedHtml, polls, {
      role: 'opening',
      topicId: topic.id
    }).preparedContent;
  const result = {
    ...topic,
    policy: discoursePostPolicy(firstPost),
    accessRequirement: undefined,
    mediaReferrer: { documentUrl: topic.url },
    contentHtml: preparedContent.contentHtml,
    preparedContent,
    replies,
    replyCompleteness: replies.length === initialReplyPosts.length ? ('complete' as const) : ('partial' as const),
    replyHasMore,
    replyNextPage: replyHasMore ? 2 : null,
    replyNextOffset: replyHasMore ? initialReplyPosts.length : null,
    ...(firstPostFields?.commentId ? { commentId: firstPostFields.commentId } : {}),
    canEdit:
      firstPostFields.canEdit === true ||
      (isRecord(data.details) && (data.details.can_edit === true || data.details.can_edit_tags === true)),
    ...(firstPostFields?.likeCount === undefined ? {} : { likeCount: firstPostFields.likeCount }),
    ...(firstPostFields?.liked === undefined ? {} : { liked: firstPostFields.liked }),
    ...(firstPostFields?.canLike === undefined ? {} : { canLike: firstPostFields.canLike }),
    ...(polls ? { polls } : {}),
    ...(firstPostFields?.reactionSummary ? { reactionSummary: firstPostFields.reactionSummary } : {}),
    ...('currentUserReaction' in firstPostFields ? { currentUserReaction: firstPostFields.currentUserReaction } : {}),
    ...(firstPostRecord && (firstPostBoostCount || 'boosts' in firstPostRecord || 'can_boost' in firstPostRecord)
      ? {
          siteExtension: {
            ...linuxDoBoostFields(firstPostRecord),
            ...(firstPostBoostCount ? { boostCount: firstPostBoostCount } : {})
          }
        }
      : {}),
    ...(positiveNumber(data.bookmark_id)
      ? { bookmarkId: positiveNumber(data.bookmark_id), bookmarked: true }
      : typeof data.bookmarked === 'boolean'
        ? { bookmarked: data.bookmarked }
        : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-topic',
    candidateCount: 1 + Math.max(0, posts.length - 1),
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, posts.length - 1 - replies.length),
    missingFloorCount: replyPosts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
  });
}

async function fetchPosts(id: string, postIds: unknown[], options: LinuxDoOptions) {
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}/posts.json`,
    { 'post_ids[]': postIds.map(String), ...(options.linuxDoAccess?.authenticated ? { include_raw: 'true' } : {}) },
    options
  );
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getLinuxDoConversationPage(
  id: string,
  options: LinuxDoOptions & { beforePostId?: string } = {}
): Promise<{ topic: Topic; items: Reply[]; olderCursor: string | null }> {
  const beforePostId = options.beforePostId;
  if (beforePostId !== undefined && (!/^[1-9]\d*$/.test(beforePostId) || !Number.isSafeInteger(Number(beforePostId)))) {
    throw new Error('私信历史游标不正确');
  }
  options = withDefaultBrowserFetchIntent(options, 'topic', 'foreground');
  const data = await topicData(id, options);
  const rawStream = topicStreamState(data).stream;
  const stream = rawStream.map(String);
  if (
    !stream.length ||
    stream.some((postId) => !/^[1-9]\d*$/.test(postId) || !Number.isSafeInteger(Number(postId))) ||
    new Set(stream).size !== stream.length
  )
    throw new Error('私信历史列表不完整，请刷新会话后重试');
  const end = beforePostId === undefined ? stream.length : stream.indexOf(beforePostId);
  if (end < 0) throw new Error('私信历史游标已变化，请刷新会话后重试');
  const start = Math.max(0, end - 30);
  const ids = stream.slice(start, end);
  const embeddedPosts =
    isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const byId = new Map<string, unknown>();
  for (const post of embeddedPosts) {
    if (!isRecord(post) || !ids.includes(String(post.id))) continue;
    if (byId.has(String(post.id))) throw new Error('私信历史内容不完整，请重试');
    byId.set(String(post.id), post);
  }
  const missingIds = ids.filter((postId) => !byId.has(postId));
  if (missingIds.length) {
    const fetched = await fetchPosts(id, missingIds, options);
    for (const post of fetched) {
      if (!isRecord(post) || !missingIds.includes(String(post.id)) || byId.has(String(post.id))) {
        throw new Error('私信历史内容不完整，请重试');
      }
      byId.set(String(post.id), post);
    }
  }
  const items = ids.flatMap((postId) => {
    const raw = byId.get(postId);
    if (!isRecord(raw)) throw new Error('私信历史内容不完整，请重试');
    if (raw.deleted_at) return [];
    const reply = normalizePost(raw, id);
    if (!reply || String(reply.commentId) !== postId) throw new Error('私信历史内容不完整，请重试');
    return [reply];
  });
  const topic = normalizeTopic(data, categoryMapFromData(data));
  if (!topic) throw new Error('私信会话信息不完整');
  return { topic: { ...topic, isPrivateMessage: true }, items, olderCursor: start > 0 ? stream[start]! : null };
}

export async function getLinuxDoReplies(
  id: string,
  options: LinuxDoOptions & {
    order: ReplyOrder;
    position: ReplyWindowPosition;
    limit?: number;
  }
): Promise<RepliesResponse> {
  options = withDefaultBrowserFetchIntent(options, 'topic', 'foreground');
  const limit = options.limit || 30;
  if (options.position.kind === 'target') {
    let targetFloor = options.position.target.floor;
    const targetCommentId = options.position.target.commentId;
    if (targetCommentId !== undefined) {
      if (!Number.isSafeInteger(targetCommentId) || targetCommentId <= 0) throw new Error('linux.do 目标评论不正确');
      const posts = await fetchPosts(id, [targetCommentId], options);
      const matches = posts.filter(
        (post) =>
          isRecord(post) && post.id === targetCommentId && (post.topic_id === undefined || String(post.topic_id) === id)
      );
      if (matches.length !== 1) throw new Error('linux.do 目标楼层未找到');
      targetFloor = parsePositiveInteger((matches[0] as Record<string, unknown>).post_number);
    }
    if (!Number.isSafeInteger(targetFloor) || targetFloor! <= 0) {
      throw new Error('linux.do 目标楼层不正确');
    }
    const data = await topicData(id, options, targetFloor);
    const reading = discourseReadingFromJson(data);
    const window = discourseReplyWindow(data, limit);
    const items = window.posts.map((post) => normalizePost(post, id)).filter((reply) => reply !== null);
    const hasTarget = items.some((reply) =>
      targetCommentId === undefined ? reply.floor === targetFloor : reply.commentId === targetCommentId
    );
    if (!hasTarget && !options.position.target.readingResume) {
      throw new Error('linux.do 目标楼层未找到');
    }
    const { posts, ...windowState } = window;
    const chronological = annotateSourceDiagnosticSummary(
      {
        items,
        ...windowState,
        ...(data.archetype === 'private_message' ? { isPrivateMessage: true } : {}),
        ...(reading ? { reading } : {}),
        completeness: items.length === posts.length ? ('complete' as const) : ('partial' as const)
      },
      {
        parserVariant: 'discourse-near-replies',
        candidateCount: posts.length,
        validCount: items.length,
        droppedCount: Math.max(0, posts.length - items.length),
        missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
      }
    );
    return orientReplyWindow(chronological, options.order);
  }
  const data = await topicData(id, options);
  const reading = discourseReadingFromJson(data);
  const metadata = {
    ...(data.archetype === 'private_message' ? { isPrivateMessage: true } : {}),
    ...(reading ? { reading } : {})
  };
  const streamState = topicStreamState(data);
  const stream = streamState.stream;
  const { postIds, ...windowState } = discourseStreamReplyWindow(stream, {
    limit,
    order: options.order,
    position: options.position
  });
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary(
      { items: [], ...windowState, ...metadata },
      {
        parserVariant: 'discourse-replies',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }
  const wanted = new Set(postIds.map(String));
  const posts = streamState.embeddedPosts.filter(
    (post: unknown) =>
      isRecord(post) &&
      wanted.has(String(post.id)) &&
      (post.topic_id === undefined || String(post.topic_id) === id) &&
      (Boolean(post.deleted_at) ||
        (typeof post.cooked === 'string' && (parsePositiveInteger(post.post_number) ?? 0) > 1))
  );
  const known = new Set(posts.map((post) => String(post.id)));
  const missing = postIds.filter((postId) => !known.has(String(postId)));
  if (missing.length) posts.push(...(await fetchPosts(id, missing, options)));
  const visiblePostIds = discourseVisiblePostIds(posts, postIds);
  const normalizedItems = posts.map((post) => normalizePost(post, id)).filter((reply) => reply !== null);
  const items = discourseRepliesInStreamOrder(normalizedItems, visiblePostIds, options.order);
  const result = {
    items,
    ...windowState,
    ...metadata,
    completeness:
      posts.length === postIds.length && items.length === postIds.length ? ('complete' as const) : ('partial' as const)
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-replies',
    candidateCount: postIds.length,
    validCount: items.length,
    droppedCount: Math.max(0, postIds.length - items.length),
    missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length,
    hasRepeatedCursor:
      options.position.kind === 'cursor' &&
      result.nextPage === options.position.page &&
      result.nextOffset === options.position.offset
  });
}

export async function getLinuxDoReply(id: string, floor: number, options: LinuxDoOptions = {}): Promise<Reply> {
  options = withDefaultBrowserFetchIntent(options, 'topic', 'foreground');
  if (!Number.isSafeInteger(floor) || floor < 1) throw new Error('引用楼层不正确');
  const data = await topicData(id, options, floor);
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const matches = posts.filter((post) => isRecord(post) && post.post_number === floor);
  const reply = matches.length === 1 ? normalizePost(matches[0], id) : null;
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return annotateSourceDiagnosticSummary(reply, {
    parserVariant: 'fetched-reply',
    candidateCount: posts.length,
    validCount: 1,
    droppedCount: Math.max(0, posts.length - 1),
    missingFloorCount: posts.filter((item) => isRecord(item) && !parsePositiveInteger(item.post_number)).length
  });
}
