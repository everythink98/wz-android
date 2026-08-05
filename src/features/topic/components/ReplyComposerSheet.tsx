import type { TopicStyles } from '../styles';
import type { ReplyEditTarget, ReplyTarget } from '../model/types';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { type ReaderTheme } from '@/ui/theme/tokens';
import type { Source } from '@/domain/forum/models';
import { ReplyComposer } from '@/ui/composer/ReplyComposer';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';

export function ReplyComposerSheet({
  actionBusy,
  discourseEmojiUrls = {},
  replyContent,
  replyEditTarget,
  replyFace,
  replyTarget,
  source,
  styles,
  theme,
  visible,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onSubmitReply,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  replyContent: string;
  replyFace: string;
  replyEditTarget?: ReplyEditTarget | null;
  replyTarget: ReplyTarget | null;
  source?: Source;
  styles: TopicStyles;
  theme: ReaderTheme;
  visible: boolean;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onSubmitReply: () => void;
  onUploadReplyImage?: () => void;
}) {
  const replyTargetAuthor = replyTarget?.author?.trim().replace(/^@+/, '');
  const title = replyTarget
    ? `回复 ${replyTargetAuthor ? `@${replyTargetAuthor} · ` : ''}#${replyTarget.floor}`
    : replyEditTarget
      ? replyEditTarget.floor
        ? `编辑 #${replyEditTarget.floor}`
        : '编辑回复'
      : '回复';
  return (
    <ComposerBottomSheet
      backgroundStyle={styles.replyComposerBottomSheetBackground}
      containerStyle={styles.replyComposerBottomSheetContainer}
      contentStyle={styles.replyComposerBottomSheetContent}
      dark={theme.dark}
      visible={visible}
      onOpenChange={onReplyComposerOpenChange}
    >
      {(focusSignal) => (
        <ReplyComposer
          actionBusy={actionBusy}
          closeLabel={replyEditTarget ? '取消编辑' : replyTarget ? '取消楼层回复' : '收起回复'}
          content={replyContent}
          focusSignal={focusSignal}
          discourseEmojiUrls={discourseEmojiUrls}
          face={replyFace}
          placeholder={replyEditTarget ? '编辑回复内容' : replyTarget ? '输入楼层回复内容' : '输入回复内容'}
          source={source}
          submitLabel={replyEditTarget ? '保存编辑' : '发送回复'}
          title={title}
          onContentChange={onReplyContentChange}
          onFaceChange={onReplyFaceChange}
          onOpenChange={onReplyComposerOpenChange}
          onSubmit={onSubmitReply}
          onUploadImage={onUploadReplyImage}
        />
      )}
    </ComposerBottomSheet>
  );
}
