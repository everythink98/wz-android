export type Source = 'v2ex' | 'linuxdo' | 'nodeseek' | 'yaohuo';
export type FeedSource = Source | 'all';
export type LinuxDoFeedFilter = 'latest' | 'hot' | 'new-all' | 'new-topics' | 'new-replies';
export type NodeSeekFeedFilter = 'postTime' | 'replyTime';
export type V2exFeedFilter = 'all' | 'latest' | 'hot';
export type FeedFilterSource = 'linuxdo' | 'nodeseek' | 'v2ex';
export type SourceFeedFilter = LinuxDoFeedFilter | NodeSeekFeedFilter | V2exFeedFilter;
export type FeedFilterState = {
  linuxdo: LinuxDoFeedFilter;
  nodeseek: NodeSeekFeedFilter;
  v2ex: V2exFeedFilter;
};
export type SourceErrorKind = 'login-required' | 'login-expired' | 'verification-required' | 'permission-denied' | 'ordinary';

export type SourceErrorInfo = {
  message: string;
  kind: SourceErrorKind;
  reason?: string;
  loginRequired?: boolean;
  retryable?: boolean;
  verificationRequired?: boolean;
};

export type SourceErrors = Partial<Record<FeedSource, SourceErrorInfo>>;

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
  replyCount: number;
  viewCount?: number;
  excerpt?: string;
  accessRequirement?: AccessRequirement;
  duplicateSources?: string[];
  tags?: string[];
  closed?: boolean;
  archived?: boolean;
  pinned?: boolean;
  solved?: boolean;
  acceptedAnswerFloor?: number;
  slowModeSeconds?: number;
}

export interface ReactionSummary {
  id: string;
  count: number;
}

export interface Reply {
  author: string;
  authorId?: string;
  authorAvatar?: string;
  authorLevelLabel?: string;
  authorUrl?: string;
  contentHtml: string;
  createdAt: string;
  floor?: number;
  quotedFloors?: number[];
  quotedAuthors?: Record<number, string>;
  commentId?: number;
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
  contentMarkdown?: string;
  bookmarkId?: number;
  bookmarked?: boolean;
  replyTargetAuthor?: string;
  thanksCount?: number;
  acceptedAnswer?: boolean;
  wiki?: boolean;
  hidden?: boolean;
  folded?: boolean;
  needsApproval?: boolean;
  systemAction?: boolean;
  actionCode?: string;
  reactionSummary?: ReactionSummary[];
  boostCount?: number;
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
}

export interface TopicPollOption {
  id: string;
  label: string;
  count?: number;
  selected?: boolean;
}

export interface TopicPoll {
  id?: string;
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
  replies: Reply[];
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
  boostCount?: number;
}

export interface UserProfile {
  source: Source;
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  levelLabel?: string;
  url: string;
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
  hasMore: boolean;
  nextPage: number | null;
  nextOffset?: number | null;
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
