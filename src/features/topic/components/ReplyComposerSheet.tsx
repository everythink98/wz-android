import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TopicStyles } from '../styles';
import type { ReplyComposerIntent } from '../useTopicSessionController';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { type ReaderTheme } from '@/ui/theme/tokens';
import type { Source } from '@/domain/forum/models';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';
import { StructuredReplyComposer, type StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import type {
  ComposerIntent,
  ComposerPresentation,
  ComposerSnapshot,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import type { LinuxDoTemplate } from '@/sources/linuxdo/templates';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';

export function ReplyComposerSheet({
  actionBusy,
  discourseEmojiUrls = {},
  intent,
  nodeSeekMemberId,
  pendingNodeSeekPolls,
  replyContent,
  replyFace,
  routeActive = true,
  source,
  styles,
  theme,
  topicId = '',
  visible,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onReplySnapshot,
  onSubmitReply,
  onLoadLinuxDoPollCapabilities,
  onLoadLinuxDoTemplates,
  onUseLinuxDoTemplate,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  intent: ReplyComposerIntent;
  nodeSeekMemberId?: string;
  pendingNodeSeekPolls?: PendingNodeSeekPoll[];
  replyContent: string;
  replyFace: string;
  routeActive?: boolean;
  source?: Source;
  styles: TopicStyles;
  theme: ReaderTheme;
  topicId?: string;
  visible: boolean;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onReplySnapshot?: (snapshot: ComposerSnapshot) => void;
  onSubmitReply: (snapshot?: ComposerSnapshot) => unknown;
  onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
  onLoadLinuxDoTemplates?: () => Promise<LinuxDoTemplate[]>;
  onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  onUploadReplyImage?: () => unknown;
}) {
  const structured = source === 'linuxdo' || source === 'nodeseek';
  const structuredRef = useRef<StructuredReplyComposerHandle>(null);
  const lastVisibleIntentRef = useRef(intent);
  const snapshotAllowedAfterCloseRef = useRef(true);
  const [presentation, setPresentation] = useState<ComposerPresentation>('sheet');
  if (visible) lastVisibleIntentRef.current = intent;
  useEffect(() => {
    if (visible) {
      snapshotAllowedAfterCloseRef.current = true;
      return;
    }
    snapshotAllowedAfterCloseRef.current = lastVisibleIntentRef.current.kind !== 'edit';
  }, [visible]);
  let closeLabel = '收起回复';
  let placeholder = '输入回复内容';
  let submitLabel = '发送回复';
  let title = '回复';
  if (intent.kind === 'floor') {
    const author = intent.target.author?.trim().replace(/^@+/, '');
    closeLabel = '取消楼层回复';
    placeholder = '输入楼层回复内容';
    title = `回复 ${author ? `@${author} · ` : ''}#${intent.target.floor}`;
  } else if (intent.kind === 'edit') {
    closeLabel = '取消编辑';
    placeholder = '编辑回复内容';
    submitLabel = '保存编辑';
    title = intent.target.floor ? `编辑 #${intent.target.floor}` : '编辑回复';
  }
  const structuredIntent = useMemo<ComposerIntent | null>(() => {
    if (!structured || !source) return null;
    if (intent.kind === 'edit') {
      return {
        kind: 'edit-reply',
        site: source,
        topicId,
        commentId: String(intent.target.commentId),
        sourceMarkdown: intent.target.contentMarkdown
      };
    }
    return {
      kind: 'reply',
      site: source,
      topicId,
      ...(intent.kind === 'floor' ? { replyTo: intent.target } : {})
    };
  }, [intent, source, structured, topicId]);
  const handleSnapshot = useCallback(
    (snapshot: ComposerSnapshot) => {
      if (!visible && !snapshotAllowedAfterCloseRef.current) return;
      onReplySnapshot?.(snapshot);
    },
    [onReplySnapshot, visible]
  );
  useEffect(() => {
    if (routeActive || !visible || !structuredRef.current) return;
    void structuredRef.current.requestSnapshot().catch(() => undefined);
  }, [routeActive, visible]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open || !structured || !structuredRef.current) {
        onReplyComposerOpenChange(open);
        return;
      }
      void structuredRef.current
        .requestSnapshot()
        .catch(() => undefined)
        .finally(() => onReplyComposerOpenChange(false));
    },
    [onReplyComposerOpenChange, structured]
  );
  return (
    <ComposerBottomSheet
      backgroundStyle={styles.replyComposerBottomSheetBackground}
      containerStyle={styles.replyComposerBottomSheetContainer}
      contentStyle={styles.replyComposerBottomSheetContent}
      dark={theme.dark}
      fixedContent={structured}
      presentation={presentation}
      visible={visible}
      onOpenChange={handleOpenChange}
      onPresentationChange={setPresentation}
    >
      {(focusSignal) =>
        structuredIntent ? (
          <StructuredReplyComposer
            ref={structuredRef}
            actionBusy={actionBusy}
            closeLabel={closeLabel}
            content={replyContent}
            discourseEmojiUrls={discourseEmojiUrls}
            focusSignal={focusSignal}
            intent={structuredIntent}
            nodeSeekMemberId={nodeSeekMemberId}
            pendingNodeSeekPolls={pendingNodeSeekPolls || []}
            presentation={presentation}
            submitLabel={submitLabel}
            title={title}
            visible={visible}
            onLoadLinuxDoPollCapabilities={onLoadLinuxDoPollCapabilities}
            onLoadLinuxDoTemplates={onLoadLinuxDoTemplates}
            onOpenChange={handleOpenChange}
            onPresentationChange={setPresentation}
            onSnapshot={handleSnapshot}
            onSubmit={onSubmitReply}
            onUploadImage={onUploadReplyImage}
            onUseLinuxDoTemplate={onUseLinuxDoTemplate}
          />
        ) : source === 'yaohuo' ? (
          <YaohuoReplyComposer
            actionBusy={actionBusy}
            closeLabel={closeLabel}
            content={replyContent}
            focusSignal={focusSignal}
            face={replyFace}
            placeholder={placeholder}
            submitLabel={submitLabel}
            title={title}
            onContentChange={onReplyContentChange}
            onFaceChange={onReplyFaceChange}
            onOpenChange={handleOpenChange}
            onSubmit={() => onSubmitReply()}
            onUploadImage={onUploadReplyImage}
          />
        ) : null
      }
    </ComposerBottomSheet>
  );
}
