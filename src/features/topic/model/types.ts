import type { DiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import type { Reply } from '@/domain/forum/models';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';

export type ReplyFilter = 'all' | 'author' | 'images' | 'newest';

export interface ReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
  commentId?: number;
}

export interface ReplyEditTarget {
  commentId: number;
  floor?: number;
  contentMarkdown: string;
  topicId: string;
  ticket: WritableSessionTicket;
}

export type ReplyRefreshTarget = Pick<Reply, 'commentId' | 'floor' | 'deletePath'>;

export interface TopicRepliesRefreshOptions {
  diagnosticTrace?: DiagnosticTrace;
  silent?: boolean;
  afterSubmit?: boolean;
  editedReplyContent?: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>;
  targetReply?: ReplyRefreshTarget | null;
  excludeReply?: ReplyRefreshTarget | null;
}
