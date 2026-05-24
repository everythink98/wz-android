export type Screen = 'feed' | 'search' | 'library' | 'more' | 'topic';
export type ReplyFilter = 'all' | 'author' | 'images' | 'newest';
export type HealthDetail = {
  label: string;
  ok: boolean;
  message: string;
};
export type LoginNavigationRequest = { url: string };
export interface YaohuoReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
}
