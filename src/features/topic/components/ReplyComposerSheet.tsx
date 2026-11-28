import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref
} from 'react';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, Text, ToastAndroid, View } from 'react-native';
import { AppButton } from '@/ui/controls/ButtonControls';
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
  ComposerSubmissionSettlement,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import type { LinuxDoTemplate } from '@/sources/linuxdo/templates';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';

export function ReplyComposerSheet({
  actionBusy,
  closeRequestRef,
  uploadingImage = false,
  discourseEmojiUrls = {},
  editRecoveryRef,
  intent,
  nodeSeekMemberId,
  pendingNodeSeekPolls,
  replyContent,
  replyFace,
  recoveryContent = null,
  routeActive = true,
  source,
  styles,
  theme,
  topicId = '',
  visible,
  onBackAfterClose,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFaceChange,
  onReplySnapshot,
  onSubmitReply,
  onLoadLinuxDoPollCapabilities,
  onResolveLinuxDoUpload,
  onLoadLinuxDoTemplates,
  onUseLinuxDoTemplate,
  onUploadReplyImage
}: {
  actionBusy: boolean;
  closeRequestRef?: Ref<() => void>;
  uploadingImage?: boolean;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  editRecoveryRef?: Ref<() => Promise<string>>;
  intent: ReplyComposerIntent;
  nodeSeekMemberId?: string;
  pendingNodeSeekPolls?: PendingNodeSeekPoll[];
  replyContent: string;
  replyFace: string;
  recoveryContent?: string | null;
  routeActive?: boolean;
  source?: Source;
  styles: TopicStyles;
  theme: ReaderTheme;
  topicId?: string;
  visible: boolean;
  onBackAfterClose?: () => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFaceChange: (value: string) => void;
  onReplySnapshot?: (snapshot: ComposerSnapshot) => void;
  onSubmitReply: (snapshot?: ComposerSnapshot, settleSubmission?: ComposerSubmissionSettlement) => unknown;
  onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
  onResolveLinuxDoUpload?: (shortUrl: string) => Promise<string>;
  onLoadLinuxDoTemplates?: () => Promise<LinuxDoTemplate[]>;
  onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  onUploadReplyImage?: () => unknown;
}) {
  const structured = source === 'linuxdo' || source === 'nodeseek';
  const structuredRef = useRef<StructuredReplyComposerHandle>(null);
  const pendingClose = useRef<{ intent: ReplyComposerIntent; backRequested: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!routeActive || (visible && pendingClose.current?.intent !== intent)) pendingClose.current = null;
  }, [intent, routeActive, visible]);
  useLayoutEffect(
    () => () => {
      pendingClose.current = null;
    },
    []
  );
  const lastVisibleWasEditRef = useRef(intent.kind === 'edit');
  const [presentation, setPresentation] = useState<ComposerPresentation>('sheet');
  useEffect(() => {
    if (visible) lastVisibleWasEditRef.current = intent.kind === 'edit';
  }, [intent, visible]);
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
    if (!structured || !source || recoveryContent !== null) return null;
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
  }, [intent, recoveryContent, source, structured, topicId]);
  const handleSnapshot = useCallback(
    (snapshot: ComposerSnapshot) => {
      if (recoveryContent !== null || (!visible && lastVisibleWasEditRef.current)) return;
      onReplySnapshot?.(snapshot);
    },
    [onReplySnapshot, recoveryContent, visible]
  );
  useEffect(() => {
    if (routeActive || !visible || !structuredRef.current) return;
    void structuredRef.current.requestSnapshot().catch(() => undefined);
  }, [routeActive, visible]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        pendingClose.current = null;
        onReplyComposerOpenChange(true);
        return;
      }
      if (pendingClose.current) return;
      const request = { intent, backRequested: false };
      pendingClose.current = request;
      if (!structuredRef.current) {
        onReplyComposerOpenChange(false);
        return;
      }
      void structuredRef.current
        .requestSnapshot()
        .catch(() => undefined)
        .finally(() => {
          if (pendingClose.current === request) onReplyComposerOpenChange(false);
        });
    },
    [intent, onReplyComposerOpenChange]
  );
  const returnAfterClose = useLatestCallback(() => {
    if (visible || !routeActive || !pendingClose.current?.backRequested) return;
    pendingClose.current = null;
    onBackAfterClose?.();
  });
  useEffect(() => {
    // The navigation guard can accept Back once this route has committed the saved draft and closed reply state.
    if (!visible) returnAfterClose();
  }, [returnAfterClose, visible]);
  const requestBackDuringClose = useLatestCallback(() => {
    const request = pendingClose.current;
    if (!request || !routeActive || !onBackAfterClose) return false;
    request.backRequested = true;
    returnAfterClose();
    return true;
  });
  const handleClosed = useCallback(() => {
    returnAfterClose();
    pendingClose.current = null;
  }, [returnAfterClose]);
  useImperativeHandle(
    closeRequestRef,
    () => () => {
      if (!requestBackDuringClose()) handleOpenChange(false);
    },
    [handleOpenChange, requestBackDuringClose]
  );
  return (
    <ComposerBottomSheet
      active={routeActive}
      backgroundStyle={styles.replyComposerBottomSheetBackground}
      containerStyle={styles.replyComposerBottomSheetContainer}
      contentStyle={styles.replyComposerBottomSheetContent}
      dark={theme.dark}
      fixedContent={structured && recoveryContent === null}
      presentation={presentation}
      releaseAfterClose
      visible={visible}
      onBackDuringClose={onBackAfterClose ? requestBackDuringClose : undefined}
      onClosed={handleClosed}
      onOpenChange={handleOpenChange}
      onPresentationChange={setPresentation}
    >
      {(focusSignal, awaitKeyboardSettled) =>
        recoveryContent !== null ? (
          <View style={{ gap: 8, padding: 16, flexShrink: 1 }}>
            <Text accessibilityRole="header" style={styles.panelTitle}>
              {'保留的编辑内容'}
            </Text>
            <ScrollView overScrollMode="never">
              <Text selectable style={{ color: theme.ink }}>
                {recoveryContent}
              </Text>
            </ScrollView>
            <AppButton
              label={'复制编辑内容'}
              onPress={() =>
                void Clipboard.setStringAsync(recoveryContent)
                  .then(() => ToastAndroid.show('已复制', ToastAndroid.SHORT))
                  .catch(() => ToastAndroid.show('复制失败', ToastAndroid.SHORT))
              }
            />
            <AppButton label={'关闭'} onPress={() => handleOpenChange(false)} />
          </View>
        ) : structuredIntent ? (
          <StructuredReplyComposer
            ref={structuredRef}
            actionBusy={actionBusy}
            closeLabel={closeLabel}
            content={replyContent}
            discourseEmojiUrls={discourseEmojiUrls}
            editRecoveryRef={structuredIntent.kind === 'edit-reply' ? editRecoveryRef : undefined}
            focusSignal={focusSignal}
            intent={structuredIntent}
            nodeSeekMemberId={nodeSeekMemberId}
            pendingNodeSeekPolls={pendingNodeSeekPolls || []}
            presentation={presentation}
            submitLabel={submitLabel}
            title={title}
            visible={visible && routeActive}
            onLoadLinuxDoPollCapabilities={onLoadLinuxDoPollCapabilities}
            onResolveLinuxDoUpload={onResolveLinuxDoUpload}
            onLoadLinuxDoTemplates={onLoadLinuxDoTemplates}
            onOpenChange={handleOpenChange}
            onPresentationChange={setPresentation}
            onSnapshot={handleSnapshot}
            onSubmit={onSubmitReply}
            onUploadImage={onUploadReplyImage}
            awaitKeyboardSettled={awaitKeyboardSettled}
            onUseLinuxDoTemplate={onUseLinuxDoTemplate}
          />
        ) : source === 'yaohuo' ? (
          <YaohuoReplyComposer
            actionBusy={actionBusy}
            uploadingImage={uploadingImage}
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
            awaitKeyboardSettled={awaitKeyboardSettled}
          />
        ) : null
      }
    </ComposerBottomSheet>
  );
}
