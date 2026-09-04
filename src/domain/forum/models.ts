import type { DiscourseSource, FeedFilterSource, Source } from './sourceCatalog';
import type { MediaReferrerContext } from './mediaReferrer';

export type { FeedFilterSource, Source } from './sourceCatalog';
export type { MediaReferrerContext, MediaReferrerPolicy } from './mediaReferrer';
export type FeedSource = Source | 'all';
export type DiscourseFeedFilter = 'latest' | 'hot' | 'new-all' | 'new-topics' | 'new-replies';
export type NodeSeekFeedFilter = 'postTime' | 'replyTime';
export type V2exFeedFilter = 'all' | 'latest' | 'hot';
export type SourceFeedFilter = DiscourseFeedFilter | NodeSeekFeedFilter | V2exFeedFilter;
export type FeedFilterState = {
  [Site in FeedFilterSource]: Site extends DiscourseSource
    ? DiscourseFeedFilter
    : Site extends 'nodeseek'
      ? NodeSeekFeedFilter
      : Site extends 'v2ex'
        ? V2exFeedFilter
        : never;
};
export type SourceErrorKind =
  'login-required' | 'login-expired' | 'verification-required' | 'permission-denied' | 'ordinary';

export type SourceErrorInfo = {
  message: string;
  kind: SourceErrorKind;
  reason?: string;
  loginRequired?: boolean;
  retryable?: boolean;
  verificationRequired?: boolean;
};

export type SourceErrors = Partial<Record<FeedSource, SourceErrorInfo>>;
export type SourceLoadOutcomeKind = 'data' | 'empty' | 'partial' | 'error' | 'auth';

type SiteExtension = {
  boostCount?: number;
  needsApproval?: boolean;
};

export interface AccessRequirement {
  type: 'login' | 'level' | 'permission';
  label: string;
  detail?: string;
}

export interface Topic {
  source: Source;
  id: string;
  title: string;
  author: string;
  authorId?: string;
  authorAvatar?: string;
  authorLevelLabel?: string;
  authorUrl?: string;
  categoryId?: string;
  category?: string;
  url: string;
  createdAt: string;
  lastReplyAt?: string;
  displayTimeText?: string;
  replyCount?: number;
  viewCount?: number;
  excerpt?: string;
  accessRequirement?: AccessRequirement;
  duplicateSources?: string[];
  tags?: string[];
  canCreatePost?: boolean;
  closed?: boolean;
  archived?: boolean;
  pinned?: boolean;
  solved?: boolean;
  acceptedAnswerFloor?: number;
  slowModeSeconds?: number;
  isAiGenerated?: boolean;
  siteExtension?: SiteExtension;
}

export interface ReactionSummary {
  id: string;
  count: number;
}

export interface QuotedAuthorReference {
  label: string;
  username?: string;
}

export interface QuotedPostReference {
  source: Source;
  topicId: string;
  postNumber: number;
}

export interface QuotedPostMetadata {
  reference: QuotedPostReference;
  author?: QuotedAuthorReference;
  preview?: string;
  topicTitle?: string;
  topicUrl?: string;
}

export interface ReplyTargetAuthor {
  name: string;
  id?: string;
  username?: string;
  url?: string;
}

export interface ReplyTarget {
  floor?: number;
  author?: ReplyTargetAuthor;
}

export interface ReplyLocationTarget {
  commentId?: number;
  floor?: number;
  pageHint?: number;
  expectedAuthorUsername?: string;
}

export type ReplyOrder = 'oldest' | 'newest';

export type ReplyCompleteness = 'complete' | 'partial';

export type PreparedForumContent<ContentPlan = unknown> = {
  contentHtml: string;
  contentPlan: ContentPlan;
  contentPlanKey: string;
  topicId?: string;
};

export type ReplyWindowPosition =
  | { kind: 'start' }
  | { kind: 'cursor'; page: number; offset: number | null }
  | { kind: 'target'; target: ReplyLocationTarget };

export interface Reply {
  author: string;
  authorId?: string;
  authorAvatar?: string;
  authorLevelLabel?: string;
  authorUrl?: string;
  contentHtml: string;
  preparedContent?: PreparedForumContent;
  createdAt: string;
  floor?: number;
  quotedPosts?: QuotedPostMetadata[];
  commentId?: number;
  /** Source conflict remains readable; a floor conflict does not invalidate a unique comment ID. */
  replyLocationConflict?: 'identity' | 'floor';
  upvoteCount?: number;
  likeCount?: number;
  dislikeCount?: number;
  upvoted?: boolean;
  liked?: boolean;
  canLike?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  deletePath?: string;
  disliked?: boolean;
  isOp?: boolean;
  hot?: boolean;
  pinned?: boolean;
  signatureHtml?: string;
  preparedSignature?: PreparedForumContent;
  contentMarkdown?: string;
  bookmarkId?: number;
  bookmarked?: boolean;
  replyTarget?: ReplyTarget;
  thanksCount?: number;
  acceptedAnswer?: boolean;
  wiki?: boolean;
  hidden?: boolean;
  folded?: boolean;
  systemAction?: boolean;
  actionCode?: string;
  reactionSummary?: ReactionSummary[];
  siteExtension?: SiteExtension;
  polls?: TopicPoll[];
}

export interface UserReplyActivity {
  source: Source;
  id: string;
  topicId: string;
  topicTitle: string;
  topicUrl: string;
  url: string;
  categoryId?: string;
  category?: string;
  author?: string;
  authorId?: string;
  authorAvatar?: string;
  authorUrl?: string;
  createdAt?: string;
  displayTimeText?: string;
  floor?: number;
  excerpt?: string;
}

export interface Category {
  source: Source;
  id: string;
  name: string;
  slug?: string;
  parentId?: string;
  parentSlug?: string;
  topicCount?: number;
  readRestricted?: boolean;
}

export interface DiscourseTagOption {
  name: string;
  topicCount?: number;
}

export interface DiscourseUserOption {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

export interface TopicPollOption {
  id: string;
  label: string;
  count?: number;
  selected?: boolean;
}

export interface TopicPoll {
  id?: string;
  ownerId?: string;
  name?: string;
  postId?: string;
  type?: string;
  title?: string;
  multiple?: boolean;
  voted?: boolean;
  closed?: boolean;
  public?: boolean;
  readonly?: boolean;
  participantCount?: number;
  min?: number;
  max?: number;
  options: TopicPollOption[];
}

export interface TopicDetail extends Topic {
  contentHtml: string;
  preparedContent?: PreparedForumContent;
  mediaReferrer?: MediaReferrerContext;
  replies: Reply[];
  replyCompleteness?: ReplyCompleteness;
  currentUser?: UserProfile;
  polls?: TopicPoll[];
  replyHasMore?: boolean;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
  commentId?: number;
  upvoteCount?: number;
  likeCount?: number;
  dislikeCount?: number;
  upvoted?: boolean;
  liked?: boolean;
  canLike?: boolean;
  disliked?: boolean;
  bookmarkId?: number;
  bookmarked?: boolean;
  collectionCount?: number;
  collected?: boolean;
  locked?: boolean;
  reactionSummary?: ReactionSummary[];
}

interface UserReferenceBase {
  source: Source;
  displayName?: string;
  avatar?: string;
  url: string;
}

export type UserReference = UserReferenceBase & ({ id: string; username?: string } | { id?: string; username: string });

export interface UserProfile extends UserReferenceBase {
  id: string;
  username: string;
  levelLabel?: string;
  bio?: string;
  joinedAt?: string;
  topicCount?: number;
  replyCount?: number;
  postCount?: number;
  topics: Topic[];
  hasMoreTopics?: boolean;
  nextTopicsCursor?: string | null;
  replies?: UserReplyActivity[];
  hasMoreReplies?: boolean;
  nextRepliesCursor?: string | null;
}

export interface FeedResponse {
  items: Topic[];
  errors: SourceErrors;
  hasMore?: boolean;
  nextPage?: number | null;
  nextCursor?: string | null;
}

export interface RepliesResponse {
  items: Reply[];
  completeness?: ReplyCompleteness;
  currentPage?: number;
  currentOffset?: number | null;
  previousPage?: number | null;
  previousOffset?: number | null;
  hasMore: boolean;
  nextPage: number | null;
  nextOffset?: number | null;
  totalCount?: number;
}

export interface CategoriesResponse {
  items: Category[];
  errors: SourceErrors;
}

export interface SearchResponse {
  items: Topic[];
  errors: SourceErrors;
  hasMore?: boolean;
  nextPage?: number | null;
}
