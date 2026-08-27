import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { Source } from '@/domain/forum/models';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { StructuredReplyComposer, type StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import type { ComposerPresentation, ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import type { LinuxDoTemplate } from '@/sources/linuxdo/templates';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';

function createStyles(theme: ReaderTheme, _settings: ReaderSettings) {
  return StyleSheet.create({
    background: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18
    },
    container: { zIndex: 30, elevation: 30 },
    content: { alignItems: 'stretch', paddingHorizontal: 0, paddingTop: 0 }
  });
}

export function MessageReplyComposerSheet({
  busy,
  content,
  conversationId,
  disabledReason,
  discourseEmojiUrls,
  error,
  format,
  nodeSeekMemberId,
  pendingNodeSeekPolls = [],
  routeActive = true,
  source,
  status,
  visible,
  onChangeContent,
  onClose,
  onLoadLinuxDoPollCapabilities,
  onLoadLinuxDoTemplates,
  onSnapshot,
  onSubmit,
  onUploadImage,
  onUseLinuxDoTemplate
}: {
  busy: boolean;
  content: string;
  conversationId: string;
  disabledReason?: string;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  error?: string;
  format: 'markdown' | 'plain-text';
  nodeSeekMemberId?: string;
  pendingNodeSeekPolls?: PendingNodeSeekPoll[];
  routeActive?: boolean;
  source: Source;
  status?: string;
  visible: boolean;
  onChangeContent: (content: string) => void;
  onClose: () => void;
  onSubmit: (snapshot?: ComposerSnapshot) => unknown;
  onSnapshot?: (snapshot: ComposerSnapshot) => void;
  onUploadImage?: () => unknown;
  onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
  onLoadLinuxDoTemplates?: () => Promise<LinuxDoTemplate[]>;
  onUseLinuxDoTemplate?: (id: string) => Promise<void>;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const structured = format === 'markdown' && (source === 'linuxdo' || source === 'nodeseek');
  const structuredRef = useRef<StructuredReplyComposerHandle>(null);
  const closePendingRef = useRef(false);
  const [presentation, setPresentation] = useState<ComposerPresentation>('sheet');
  useEffect(() => {
    if (visible) closePendingRef.current = false;
  }, [visible]);
  const handleClose = useCallback(() => {
    if (closePendingRef.current) return;
    closePendingRef.current = true;
    if (!structured || !structuredRef.current) {
      onClose();
      return;
    }
    void structuredRef.current
      .requestSnapshot()
      .catch(() => undefined)
      .finally(onClose);
  }, [onClose, structured]);
  useEffect(() => {
    if (!routeActive && visible) handleClose();
  }, [handleClose, routeActive, visible]);
  return (
    <ComposerBottomSheet
      backgroundStyle={styles.background}
      containerStyle={styles.container}
      contentStyle={styles.content}
      dark={theme.dark}
      fixedContent={structured}
      presentation={presentation}
      visible={visible}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      onPresentationChange={setPresentation}
    >
      {(focusSignal) =>
        structured ? (
          <StructuredReplyComposer
            ref={structuredRef}
            actionBusy={busy}
            closeLabel="取消"
            content={content}
            disabledReason={disabledReason}
            discourseEmojiUrls={discourseEmojiUrls}
            error={error}
            focusSignal={focusSignal}
            intent={{ kind: 'private-message', site: source, conversationId }}
            nodeSeekMemberId={nodeSeekMemberId}
            pendingNodeSeekPolls={pendingNodeSeekPolls}
            presentation={presentation}
            status={status}
            submitLabel="发送回复"
            title="回复私信"
            visible={visible}
            onLoadLinuxDoPollCapabilities={onLoadLinuxDoPollCapabilities}
            onLoadLinuxDoTemplates={onLoadLinuxDoTemplates}
            onOpenChange={(open) => {
              if (!open) handleClose();
            }}
            onPresentationChange={setPresentation}
            onSnapshot={(snapshot) => {
              onChangeContent(snapshot.markdown);
              onSnapshot?.(snapshot);
            }}
            onSubmit={onSubmit}
            onUploadImage={onUploadImage}
            onUseLinuxDoTemplate={onUseLinuxDoTemplate}
          />
        ) : source === 'yaohuo' && format === 'plain-text' ? (
          <YaohuoReplyComposer
            actionBusy={busy}
            closeLabel="取消"
            content={content}
            disabledReason={disabledReason}
            error={error}
            focusSignal={focusSignal}
            format="plain-text"
            inputAccessibilityLabel="私信回复内容"
            placeholder="输入回复内容"
            status={status}
            submitLabel="发送回复"
            title="回复私信"
            onContentChange={onChangeContent}
            onOpenChange={(open) => {
              if (!open) onClose();
            }}
            onSubmit={() => onSubmit()}
            onUploadImage={onUploadImage}
          />
        ) : null
      }
    </ComposerBottomSheet>
  );
}
