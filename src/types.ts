export type Source = 'v2ex' | 'linuxdo' | 'nodeseek' | 'yaohuo';
export type FeedSource = Source | 'all';

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
  authorUrl?: string;
  categoryId?: string;
  category?: string;
  url: string;
  createdAt: string;
  lastReplyAt?: string;
  replyCount: number;
  viewCount?: number;
  excerpt?: string;
  accessRequirement?: AccessRequirement;
  duplicateSources?: string[];
}

export interface Reply {
  author: string;
  authorId?: string;
  authorAvatar?: string;
  authorUrl?: string;
  contentHtml: string;
  createdAt: string;
  floor?: number;
  quotedFloors?: number[];
  commentId?: number;
  upvoteCount?: number;
  likeCount?: number;
  upvoted?: boolean;
  liked?: boolean;
}

export interface Category {
  source: Source;
  id: string;
  name: string;
  slug?: string;
  description?: string;
  parentCategoryId?: string;
  topicCount?: number;
}

export interface TopicDetail extends Topic {
  contentHtml: string;
  replies: Reply[];
  voteOptions?: Array<{
    id: string;
    label: string;
    count?: number;
  }>;
  replyHasMore?: boolean;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
  commentId?: number;
  upvoteCount?: number;
  likeCount?: number;
  upvoted?: boolean;
  liked?: boolean;
}

export interface UserProfile {
  source: Source;
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  url: string;
  bio?: string;
  joinedAt?: string;
  topicCount?: number;
  replyCount?: number;
  postCount?: number;
  topics: Topic[];
}

export interface FeedResponse {
  items: Topic[];
  errors: Partial<Record<FeedSource, string>>;
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
  errors: Partial<Record<FeedSource, string>>;
}

export interface SearchResponse {
  items: Topic[];
  errors: Partial<Record<FeedSource, string>>;
  hasMore?: boolean;
  nextPage?: number | null;
}
