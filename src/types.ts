export type Source = 'v2ex' | 'linuxdo' | 'nodeseek';
export type FeedSource = Source | 'all';

export interface Topic {
  source: Source;
  id: string;
  title: string;
  author: string;
  authorAvatar?: string;
  category?: string;
  url: string;
  createdAt: string;
  lastReplyAt?: string;
  replyCount: number;
  viewCount?: number;
  excerpt?: string;
}

export interface Reply {
  author: string;
  authorAvatar?: string;
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
  replyHasMore?: boolean;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
  commentId?: number;
  upvoteCount?: number;
  likeCount?: number;
  upvoted?: boolean;
  liked?: boolean;
}

export interface FeedResponse {
  items: Topic[];
  errors: Partial<Record<Source, string>>;
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
  errors: Partial<Record<Source, string>>;
}

export interface SearchResponse {
  items: Topic[];
  errors: Partial<Record<Source, string>>;
}
