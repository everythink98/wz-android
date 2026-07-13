import { appendReplyImageMarkup } from '../../replyImageUpload';
import type { ReplyEditTarget, ReplyTarget } from '../../appTypes';

export function replyComposerDraftWithUploadedMarkup(currentDraft: string, markup: string) {
  return appendReplyImageMarkup(currentDraft, markup);
}

export function replyComposerDraftSessionKey(replyTarget: ReplyTarget | null, replyEditTarget?: ReplyEditTarget | null) {
  if (replyEditTarget) {
    return `edit:${replyEditTarget.commentId}`;
  }
  if (replyTarget) {
    return `reply:${replyTarget.commentId || ''}:${replyTarget.floor}:${replyTarget.authorId || replyTarget.author || ''}`;
  }
  return 'new';
}
