import { createComposerWriteOperations } from './composerWriteOperations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PortalHost } from '@gorhom/portal';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { ChevronDown, CodeXml, Maximize2, Minimize2, Redo2, TextCursorInput, Undo2, X } from 'lucide-react-native';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import type {
  ComposerIntent,
  ComposerMode,
  ComposerPresentation,
  ComposerSnapshot,
  ComposerSubmissionSettlement,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { recordUserInteraction } from '@/platform/network/userPresence';
import {
  composerEditorMessageSchema,
  MAX_COMPOSER_EMOJI_COUNT,
  type ComposerHostMessage,
  type ComposerToolbarAction,
  type ComposerToolbarState
} from './structuredComposerBridge';
import { ComposerToolbar } from './ComposerToolbar';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  readerRadii,
  type ReaderStyleSettings,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { createComposerDocumentLifecycle, type ComposerDocumentEvent } from './composerDocumentLifecycle';
import { createComposerHandoffs, type ComposerImageHandoff } from './composerHandoffs';

type TemplateSummary = { id: string; title: string; content: string };
type EmojiUrlMap = Record<string, string>;
const EMPTY_EMOJI_URLS: EmojiUrlMap = {};
type EditorDraft = Pick<ComposerSnapshot, 'markdown' | 'pendingNodeSeekPolls'>;

export type StructuredReplyComposerHandle = {
  requestSnapshot: () => Promise<ComposerSnapshot>;
  insertMarkup: (markup: string) => Promise<void>;
  beginImageUpload: () => Promise<string>;
  finishImageUpload: (uploadId: string, markup?: string) => Promise<void>;
};

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = (size: number) => Math.round(size * settings.uiFontScale);
  return StyleSheet.create({
    root: { alignSelf: 'stretch', backgroundColor: theme.surface, flex: 1, minHeight: 0, overflow: 'hidden' },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      minHeight: 56,
      paddingHorizontal: 0,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    headerBody: { flex: 1, minWidth: 0 },
    title: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(15)),
      fontWeight: '600'
    },
    modeSwitch: {
      alignItems: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      padding: 2
    },
    modeButton: {
      alignItems: 'center',
      borderRadius: readerRadii.control,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 48
    },
    modeButtonActive: { backgroundColor: theme.surface },
    editorFrame: { alignSelf: 'stretch', flex: 1, minHeight: 0, overflow: 'hidden' },
    webView: { flex: 1, backgroundColor: theme.surface },
    message: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(12)),
      paddingHorizontal: 12,
      paddingTop: 7
    },
    error: { color: theme.danger },
    footer: {
      alignItems: 'center',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 4,
      height: 60,
      justifyContent: 'flex-end',
      flexShrink: 0,
      paddingHorizontal: 12,
      paddingVertical: 6
    },
    footerBody: { flex: 1, minWidth: 0 },
    metaText: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(11))
    },
    rendererGone: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 }
  });
}

function modePreferenceKey(site: ComposerIntent['site']) {
  return `wz:composer:mode:${site}`;
}

function requestId() {
  return `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export const StructuredReplyComposer = forwardRef<
  StructuredReplyComposerHandle,
  {
    actionBusy: boolean;
    awaitKeyboardSettled?: () => Promise<void>;
    closeLabel?: string;
    content: string;
    disabledReason?: string;
    discourseEmojiUrls?: EmojiUrlMap;
    error?: string;
    focusSignal?: number;
    footerActions?: ReactNode;
    initialMode?: ComposerMode;
    readOnly?: boolean;
    intent: ComposerIntent;
    nodeSeekMemberId?: string;
    pendingNodeSeekPolls: PendingNodeSeekPoll[];
    presentation: ComposerPresentation | 'embedded';
    status?: string;
    submitLabel?: string;
    title?: string;
    visible: boolean;
    onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
    onResolveLinuxDoUpload?: (shortUrl: string) => Promise<string>;
    onLoadLinuxDoTemplates?: () => Promise<TemplateSummary[]>;
    onOpenChange?: (open: boolean) => void;
    onTogglePreview?: () => void;
    dismissPanels?: boolean;
    onPanelChange?: (open: boolean) => void;
    onReturnToEditor?: () => void;
    onPresentationChange?: (presentation: ComposerPresentation) => void;
    onSnapshot: (snapshot: ComposerSnapshot) => void;
    onSubmit?: (snapshot: ComposerSnapshot, settleSubmission: ComposerSubmissionSettlement) => unknown;
    onUploadImage?: () => unknown;
    onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  }
>(
  (
    {
      actionBusy,
      awaitKeyboardSettled,
      closeLabel = '收起回复',
      content,
      disabledReason,
      discourseEmojiUrls = EMPTY_EMOJI_URLS,
      error,
      focusSignal = 0,
      footerActions,
      initialMode,
      readOnly = false,
      intent,
      nodeSeekMemberId,
      pendingNodeSeekPolls,
      presentation,
      status,
      submitLabel = '发送回复',
      title = '回复',
      visible,
      onLoadLinuxDoPollCapabilities,
      onResolveLinuxDoUpload,
      onLoadLinuxDoTemplates,
      onOpenChange,
      onTogglePreview,
      onPanelChange,
      onReturnToEditor,
      dismissPanels = false,
      onPresentationChange,
      onSnapshot,
      onSubmit,
      onUploadImage,
      onUseLinuxDoTemplate
    },
    ref
  ) => {
    const { settings, styles, theme } = useReaderThemeStyles(createStyles);
    const uploadAvailable = useCommittedRef(visible && !readOnly && !actionBusy);
    const currentReadOnly = useCommittedRef(readOnly);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    const editorTheme = useMemo(
      () => ({
        dark: theme.dark,
        ink: theme.ink,
        muted: theme.muted,
        surface: theme.surface,
        surface2: theme.surface2,
        line: theme.line,
        primary: theme.primary,
        primarySoft: theme.primarySoft,
        danger: theme.danger,
        fontScale: settings.fontScale,
        uiFontScale: settings.uiFontScale
      }),
      [
        settings.fontScale,
        settings.uiFontScale,
        theme.danger,
        theme.dark,
        theme.ink,
        theme.line,
        theme.muted,
        theme.primary,
        theme.primarySoft,
        theme.surface,
        theme.surface2
      ]
    );
    const intentKey =
      intent.kind === 'private-message'
        ? `${intent.site}:pm:${intent.conversationId}`
        : intent.kind === 'create-topic' || intent.kind === 'edit-topic'
          ? `${intent.site}:${intent.kind}:${intent.draftId}`
          : `${intent.site}:${intent.kind}:${intent.topicId}:${intent.kind === 'edit-reply' ? intent.commentId : ''}`;
    const currentIntentKey = useCommittedRef(intentKey);
    const webViewRef = useRef<WebView>(null);
    const editorFrameRef = useRef<View>(null);
    const toolbarHostRef = useRef<View>(null);
    const toolbarMenuHost = `composer-tools-${useId()}`;
    const consumedFocusSignalRef = useRef(0);
    const snapshotResolversRef = useRef(
      new Map<
        string,
        {
          resolve: (snapshot: ComposerSnapshot) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
          trace: DiagnosticTrace;
        }
      >()
    );
    const [mode, setMode] = useState<ComposerMode>(initialMode ?? 'rich');
    const [documentLifecycle] = useState(() => createComposerDocumentLifecycle(Boolean(initialMode)));
    const [documentView, setDocumentView] = useState(documentLifecycle.snapshot);
    const { modeLoaded, webLoaded, ready, rendererGone, initializationTimedOut } = documentView;
    const transitionDocument = useCallback(
      (event: ComposerDocumentEvent) => setDocumentView(documentLifecycle.apply(event)),
      [documentLifecycle]
    );
    const [localError, setLocalError] = useState('');

    const [handoffs] = useState(createComposerHandoffs);
    const [handoffView, setHandoffView] = useState(handoffs.snapshot);
    const { imagePending: imageHandoffPending, panelPending: panelHandoffPending } = handoffView;
    const publishHandoffs = useCallback(() => setHandoffView(handoffs.snapshot), [handoffs]);
    const [panelLayout, setPanelLayout] = useState<'compact' | 'form' | 'expression'>('compact');
    const expandedPanel = panelLayout === 'form';
    const expressionPanel = panelLayout === 'expression';
    const [toolbarState, setToolbarState] = useState<ComposerToolbarState | null>(null);
    const panelPresentationRef = useRef<ComposerPresentation | null>(null);
    const previousPresentationRef = useRef(presentation);
    const [editorState, setEditorState] = useState(() => ({
      isEmpty: !content.trim(),
      canUndo: false,
      canRedo: false,
      markdownLength: content.length
    }));
    const lastConfirmedDraft = useRef<EditorDraft>({ markdown: content, pendingNodeSeekPolls });
    const lastExternalSentRef = useRef(content);
    const lastContentPropRef = useRef(content);
    const lastRevisionRef = useRef(0);
    const documentEpochRef = useRef(initialMode ? 0 : -1);
    const [webViewKey, setWebViewKey] = useState(0);
    const activeWebViewKey = useRef(0);
    const reloadDraft = useRef<{ intentKey: string; content: string; draft: EditorDraft } | null>(null);
    const [submissionSnapshot, publishSubmission] = useState<{ readonly epoch: number } | null>(null);
    const [writes] = useState(() => createComposerWriteOperations(publishSubmission));
    const submitting = submissionSnapshot !== null;

    const modePreferenceRef = useRef<ComposerMode>(initialMode ?? 'rich');
    const initKeyRef = useRef(initialMode ? intentKey : '');
    const sentThemeRef = useRef(editorTheme);
    const sentDiscourseEmojiRef = useRef<readonly { name: string; url: string }[] | null>(null);
    const wasVisibleRef = useRef(visible);
    const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initializationTraceRef = useRef<DiagnosticTrace | null>(null);
    const initialModeRef = useRef(initialMode);
    initialModeRef.current = initialMode;
    const discourseEmoji = useMemo(
      () =>
        Object.entries(discourseEmojiUrls)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^https?:\/\//i.test(entry[1]))
          .slice(0, MAX_COMPOSER_EMOJI_COUNT)
          .map(([name, url]) => ({ name, url })),
      [discourseEmojiUrls]
    );
    const memberId =
      intent.site === 'nodeseek' && nodeSeekMemberId && /^\d+$/.test(nodeSeekMemberId) ? nodeSeekMemberId : null;
    const sentNodeSeekMemberRef = useRef(memberId);
    const initPayload = useMemo(
      () => ({
        site: intent.site,
        intentKind: intent.kind,
        markdown: content,
        pendingNodeSeekPolls,
        mode: initialMode ?? mode,
        readOnly,
        ...(memberId ? { nodeSeekMemberId: memberId } : {}),
        discourseEmoji,
        theme: editorTheme
      }),
      [
        content,
        discourseEmoji,
        editorTheme,
        initialMode,
        intent.kind,
        intent.site,
        mode,
        memberId,
        pendingNodeSeekPolls,
        readOnly
      ]
    );
    const initialDocumentRef = useRef(
      initialMode ? { type: 'INIT', payload: { ...initPayload, documentEpoch: 0 } } : null
    );
    const [useInitialDocument, setUseInitialDocument] = useState(Boolean(initialMode));
    const source = useMemo(() => {
      // Keep the initial HTML stable: later edits still use the versioned bridge.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Evaluate the large payload only when opening the editor.
      const editorDocument = require('./generated/editorDocument.js') as { html: string };
      const initialDocument = useInitialDocument ? initialDocumentRef.current : null;
      const html = initialDocument
        ? editorDocument.html.replace(
            '</head>',
            () =>
              `<script type="application/json" id="composer-initial-document">${JSON.stringify(initialDocument).replaceAll('<', '\\u003c')}</script></head>`
          )
        : editorDocument.html;
      return { html, baseUrl: 'https://composer.local/' };
    }, [useInitialDocument]);

    useEffect(() => {
      const isEmpty = !content.trim();
      setEditorState((current) =>
        current.isEmpty === isEmpty && current.markdownLength === content.length
          ? current
          : { ...current, isEmpty, markdownLength: content.length }
      );
    }, [content]);

    const send = useCallback((message: ComposerHostMessage) => {
      webViewRef.current?.postMessage(JSON.stringify(message));
    }, []);
    const syncNodeSeekMember = useCallback(() => {
      if (intent.site !== 'nodeseek' || sentNodeSeekMemberRef.current === memberId) return;
      sentNodeSeekMemberRef.current = memberId;
      send({ type: 'SET_NODESEEK_MEMBER', payload: { documentEpoch: documentEpochRef.current, memberId } });
    }, [intent.site, memberId, send]);
    useEffect(() => {
      // Android Back first collapses the native sheet. Close its expanded form too.
      if (expandedPanel && previousPresentationRef.current === 'fullscreen' && presentation === 'sheet') {
        panelPresentationRef.current = presentation;
        send({ type: 'COMMAND', payload: { name: 'blur' } });
      }
      previousPresentationRef.current = presentation;
    }, [expandedPanel, presentation, send]);
    useEffect(() => {
      if (dismissPanels && ready) send({ type: 'COMMAND', payload: { name: 'blur' } });
    }, [dismissPanels, ready, send]);
    const recordInvalidBridgeMessage = useCallback(
      (channel: 'native' | 'webview') => {
        const trace = beginDiagnosticTrace('webview', 'webview-transport', {
          site: intent.site,
          channel,
          isReady: ready,
          isVisible: visible
        });
        finishDiagnosticTrace(trace, 'failure', { reason: 'invalid_response' });
      },
      [intent.site, ready, visible]
    );
    const cancelUploadCommand = useCallback(() => writes.cancelCommand(), [writes]);
    const invalidateImageHandoff = useCallback(() => {
      const handoff = handoffs.image;
      if (!handoff) return;
      handoffs.invalidateImage();
      const pending = writes.pendingCommand;
      if (
        pending?.command === 'begin-image-upload' &&
        pending.id === handoff.uploadId &&
        pending.epoch === handoff.epoch
      )
        cancelUploadCommand();
    }, [cancelUploadCommand, handoffs, writes]);
    const invalidatePanelHandoff = useCallback(() => {
      handoffs.invalidatePanel();
      publishHandoffs();
    }, [handoffs, publishHandoffs]);

    useLayoutEffect(() => {
      if (!visible || readOnly || actionBusy) invalidateImageHandoff();
    }, [actionBusy, invalidateImageHandoff, readOnly, visible]);
    useLayoutEffect(() => {
      if (!visible || readOnly || actionBusy || dismissPanels || rendererGone || !ready || submitting)
        invalidatePanelHandoff();
    }, [actionBusy, dismissPanels, invalidatePanelHandoff, readOnly, ready, rendererGone, submitting, visible]);

    const clearReadyTimer = useCallback(() => {
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }, []);
    const rejectSnapshots = useCallback((message: string, reason: 'canceled' | 'superseded' | 'renderer_gone') => {
      for (const { reject, timer, trace } of snapshotResolversRef.current.values()) {
        clearTimeout(timer);
        finishDiagnosticTrace(
          trace,
          reason === 'renderer_gone' ? 'failure' : reason === 'superseded' ? 'stale' : 'canceled',
          { reason }
        );
        reject(new Error(message));
      }
      snapshotResolversRef.current.clear();
    }, []);
    const scheduleInitializationTimeout = useCallback(
      (state = AppState.currentState) => {
        const trace = initializationTraceRef.current;
        if (
          !trace ||
          !documentLifecycle.waitingForReady ||
          !visible ||
          state === 'background' ||
          state === 'inactive'
        ) {
          clearReadyTimer();
          return;
        }
        if (readyTimerRef.current) return;
        readyTimerRef.current = setTimeout(() => {
          readyTimerRef.current = null;
          initializationTraceRef.current = null;
          finishDiagnosticTrace(trace, 'failure', { reason: 'timeout' });
          transitionDocument('initialization-timeout');
          setLocalError('编辑器启动超时，可重载后继续');
        }, 1500);
      },
      [clearReadyTimer, documentLifecycle, transitionDocument, visible]
    );
    const watchInitialization = useCallback(() => {
      initializationTraceRef.current = beginDiagnosticTrace('webview', 'composer-init', { site: intent.site, mode });
      scheduleInitializationTimeout();
    }, [intent.site, mode, scheduleInitializationTimeout]);
    useEffect(() => {
      scheduleInitializationTimeout();
      const subscription = AppState.addEventListener('change', scheduleInitializationTimeout);
      return () => subscription.remove();
    }, [scheduleInitializationTimeout]);

    const sendInit = useCallback(() => {
      if (!modeLoaded) return;
      documentEpochRef.current++;
      setToolbarState(null);
      writes.cancelSubmission();
      cancelUploadCommand();
      transitionDocument('initialize');
      rejectSnapshots('编辑文档已切换，请重试', 'superseded');
      clearReadyTimer();
      if (initializationTraceRef.current)
        finishDiagnosticTrace(initializationTraceRef.current, 'stale', { reason: 'superseded' });
      watchInitialization();
      setLocalError('');
      const restoring = reloadDraft.current;
      reloadDraft.current = null;
      const draft =
        restoring?.intentKey === intentKey && restoring.content === content
          ? restoring.draft
          : { markdown: content, pendingNodeSeekPolls: initPayload.pendingNodeSeekPolls };
      send({
        type: 'INIT',
        payload: {
          ...initPayload,
          ...draft,
          ...(restoring?.intentKey === intentKey ? { mode: modePreferenceRef.current } : {}),
          documentEpoch: documentEpochRef.current
        }
      });
      sentThemeRef.current = initPayload.theme;
      sentNodeSeekMemberRef.current = initPayload.nodeSeekMemberId ?? null;
      sentDiscourseEmojiRef.current = discourseEmoji;
      initKeyRef.current = intentKey;
      lastConfirmedDraft.current = draft;
      lastExternalSentRef.current = draft.markdown;
      lastContentPropRef.current = content;
      lastRevisionRef.current = 0;
    }, [
      cancelUploadCommand,
      clearReadyTimer,
      content,
      discourseEmoji,
      initPayload,
      intentKey,
      modeLoaded,
      rejectSnapshots,
      send,
      transitionDocument,
      watchInitialization,
      writes
    ]);

    useEffect(() => {
      let current = true;
      if (initialModeRef.current) {
        modePreferenceRef.current = initialModeRef.current;
        setMode(initialModeRef.current);
        transitionDocument('mode-loaded');
        return;
      }
      transitionDocument('mode-loading');
      void AsyncStorage.getItem(modePreferenceKey(intent.site))
        .then((stored) => {
          if (!current) return;
          const storedMode = stored === 'source' ? 'source' : 'rich';
          modePreferenceRef.current = storedMode;
          setMode(storedMode);
        })
        .finally(() => {
          if (current) transitionDocument('mode-loaded');
        });
      return () => {
        current = false;
      };
    }, [intent.site, intentKey, transitionDocument]);

    useEffect(() => {
      if (!webLoaded || !modeLoaded || ready || rendererGone) return;
      if (!documentLifecycle.initializing) sendInit();
      else if (documentLifecycle.waitingForReady && !initializationTraceRef.current) watchInitialization();
    }, [documentLifecycle, modeLoaded, ready, rendererGone, sendInit, watchInitialization, webLoaded]);

    useEffect(() => {
      if (!ready || initKeyRef.current === intentKey) return;
      sendInit();
    }, [intentKey, ready, sendInit]);

    useEffect(() => {
      if (ready && !documentLifecycle.initializing) syncNodeSeekMember();
    }, [documentLifecycle, ready, syncNodeSeekMember]);

    useEffect(() => {
      if (!ready || sentThemeRef.current === editorTheme) return;
      sentThemeRef.current = editorTheme;
      send({ type: 'SET_THEME', payload: editorTheme });
    }, [editorTheme, ready, send]);

    useEffect(() => {
      if (ready) send({ type: 'SET_READ_ONLY', payload: { readOnly } });
    }, [readOnly, ready, send]);

    useEffect(() => {
      if (!ready || intent.site !== 'linuxdo' || sentDiscourseEmojiRef.current === discourseEmoji) return;
      sentDiscourseEmojiRef.current = discourseEmoji;
      send({ type: 'COMMAND', payload: { name: 'set-discourse-emoji', discourseEmoji } });
    }, [discourseEmoji, intent.site, ready, send]);

    useEffect(() => {
      if (!ready || content === lastContentPropRef.current) return;
      lastContentPropRef.current = content;
      if (content === lastConfirmedDraft.current.markdown || content === lastExternalSentRef.current) return;
      if (!content || intent.kind === 'create-topic' || intent.kind === 'edit-topic') {
        sendInit();
        return;
      }
      lastExternalSentRef.current = content;
      const confirmed = lastConfirmedDraft.current.markdown;
      const markdown = content.startsWith(confirmed) ? content.slice(confirmed.length) : content;
      send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown } });
    }, [content, intent.kind, ready, send, sendInit]);

    const requestSnapshot = useCallback(
      (submission?: { documentEpoch: number; revision: number }) => {
        const trace = beginDiagnosticTrace('webview', 'composer-snapshot', {
          site: intent.site,
          isReady: ready,
          revision: lastRevisionRef.current
        });
        if (!ready || documentLifecycle.initializing) {
          finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
          return Promise.reject(new Error('编辑器尚未就绪'));
        }
        const id = requestId();
        return new Promise<ComposerSnapshot>((resolve, reject) => {
          const timer = setTimeout(() => {
            snapshotResolversRef.current.delete(id);
            finishDiagnosticTrace(trace, 'failure', { reason: 'timeout' });
            reject(new Error('无法取得最新正文，草稿已保留'));
          }, 1500);
          snapshotResolversRef.current.set(id, { resolve, reject, timer, trace });
          send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: id, ...(submission ? { submission } : {}) } });
        });
      },
      [documentLifecycle, intent.site, ready, send]
    );

    const insertMarkup = useCallback(
      async (markdown: string) => {
        if (!ready || documentLifecycle.initializing) throw new Error('编辑器尚未就绪');
        if (readOnly) throw new Error('请先退出预览');
        send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown } });
        await requestSnapshot();
      },
      [documentLifecycle, readOnly, ready, requestSnapshot, send]
    );

    const sendUploadCommand = useCallback(
      (
        payload: Extract<ComposerHostMessage, { type: 'COMMAND' }>['payload'] & {
          uploadId: string;
          documentEpoch: number;
        }
      ) => writes.sendCommand(payload, send),
      [send, writes]
    );

    const beginImageUpload = useCallback(async () => {
      if (!ready || documentLifecycle.initializing) throw new Error('编辑器尚未就绪');
      if (readOnly) throw new Error('请先退出预览');
      if (handoffs.panel || handoffs.image || writes.upload?.epoch === documentEpochRef.current)
        throw new Error('请等待当前上传完成');
      const upload = writes.claimUpload(requestId(), documentEpochRef.current);
      try {
        await sendUploadCommand({ name: 'begin-image-upload', uploadId: upload.id, documentEpoch: upload.epoch });
        // Preserve current IME text; an ACK never replaces the document.
        await requestSnapshot();
        if (documentEpochRef.current !== upload.epoch) throw new Error('编辑文档已变化');
        return upload.id;
      } catch (error) {
        send({
          type: 'COMMAND',
          payload: { name: 'finish-image-upload', uploadId: upload.id, documentEpoch: upload.epoch }
        });
        writes.releaseUpload(upload);
        throw error;
      }
    }, [documentLifecycle, readOnly, ready, requestSnapshot, send, sendUploadCommand, handoffs, writes]);

    const finishImageUpload = useCallback(
      async (uploadId: string, markdown?: string) => {
        const upload = writes.upload;
        if (!upload || upload.id !== uploadId || upload.epoch !== documentEpochRef.current)
          throw new Error('编辑文档已变化');
        try {
          if (!ready || documentLifecycle.initializing) throw new Error('编辑器尚未就绪');
          if (markdown && readOnly) throw new Error('请先退出预览');
          await sendUploadCommand({
            name: 'finish-image-upload',
            uploadId,
            documentEpoch: upload.epoch,
            ...(markdown ? { markdown } : {})
          });
        } catch (error) {
          // A lost ACK may follow a successful insertion. Only clear its placeholder, never replay the image.
          send({ type: 'COMMAND', payload: { name: 'finish-image-upload', uploadId, documentEpoch: upload.epoch } });
          throw error;
        } finally {
          writes.releaseUpload(upload);
        }
        await requestSnapshot();
      },
      [documentLifecycle, readOnly, ready, requestSnapshot, send, sendUploadCommand, writes]
    );

    useImperativeHandle(
      ref,
      () => ({
        requestSnapshot,
        insertMarkup,
        beginImageUpload,
        finishImageUpload
      }),
      [beginImageUpload, finishImageUpload, insertMarkup, requestSnapshot]
    );

    useEffect(() => {
      if (focusSignal <= 0 || !ready || readOnly || consumedFocusSignalRef.current === focusSignal) return;
      consumedFocusSignalRef.current = focusSignal;
      webViewRef.current?.requestFocus();
      send({ type: 'COMMAND', payload: { name: 'focus' } });
    }, [focusSignal, readOnly, ready, send]);

    useEffect(() => {
      if (wasVisibleRef.current && !visible && ready) {
        send({ type: 'COMMAND', payload: { name: 'blur' } });
      }
      wasVisibleRef.current = visible;
    }, [ready, send, visible]);

    useEffect(() => {
      // Topic drafts persist confirmed state on background; runtime autosnapshots resume with the WebView.
      if (!visible || !ready) return;
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          invalidateImageHandoff();
          invalidatePanelHandoff();
          if (intent.kind !== 'create-topic' && intent.kind !== 'edit-topic')
            void requestSnapshot().catch(() => undefined);
        }
      });
      return () => subscription.remove();
    }, [intent.kind, invalidateImageHandoff, invalidatePanelHandoff, ready, requestSnapshot, visible]);

    useEffect(
      () => () => {
        writes.cancelSubmission();
        cancelUploadCommand();
        clearReadyTimer();
        if (initializationTraceRef.current)
          finishDiagnosticTrace(initializationTraceRef.current, 'canceled', { reason: 'canceled' });
        initializationTraceRef.current = null;
        rejectSnapshots('编辑器已关闭', 'canceled');
        send({ type: 'DESTROY' });
      },
      [cancelUploadCommand, clearReadyTimer, rejectSnapshots, send, writes]
    );

    const discardDocumentOperations = (reason: 'renderer_gone' | 'superseded') => {
      documentEpochRef.current++;
      clearReadyTimer();
      if (initializationTraceRef.current) {
        finishDiagnosticTrace(initializationTraceRef.current, reason === 'renderer_gone' ? 'failure' : 'stale', {
          reason
        });
        initializationTraceRef.current = null;
      }
      rejectSnapshots(reason === 'renderer_gone' ? '编辑器进程已退出' : '编辑器正在重载', reason);
      writes.cancelSubmission();
      writes.cancelCommand();
      if (writes.upload) writes.releaseUpload(writes.upload);
      if (handoffs.image) handoffs.releaseImage(handoffs.image);
      handoffs.invalidatePanel();
      publishHandoffs();
      setToolbarState(null);
      setPanelLayout('compact');
      onPanelChange?.(false);
      const previous = panelPresentationRef.current;
      panelPresentationRef.current = null;
      if (previous) onPresentationChange?.(previous);
    };
    const reloadEditor = () => {
      reloadDraft.current = {
        intentKey,
        content,
        draft:
          initKeyRef.current === intentKey && content === lastContentPropRef.current
            ? lastConfirmedDraft.current
            : { markdown: content, pendingNodeSeekPolls }
      };
      discardDocumentOperations('superseded');
      const trace = beginDiagnosticTrace('webview', 'recover', { site: intent.site });
      finishDiagnosticTrace(trace, 'success', { state: 'started' });
      setUseInitialDocument(false);
      activeWebViewKey.current += 1;
      setWebViewKey(activeWebViewKey.current);
      transitionDocument('reload');
      setLocalError('');
    };

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.nativeEvent.data);
        } catch {
          recordInvalidBridgeMessage('native');
          return;
        }
        const parsed = composerEditorMessageSchema.safeParse(raw);
        if (!parsed.success) {
          recordInvalidBridgeMessage('native');
          return;
        }
        const message = parsed.data;
        if (message.type === 'ERROR') {
          if (message.payload.documentEpoch !== undefined && message.payload.documentEpoch !== documentEpochRef.current)
            return;
          const pending = message.payload.requestId
            ? snapshotResolversRef.current.get(message.payload.requestId)
            : undefined;
          if (message.payload.requestId && !pending) return;
          if (pending && message.payload.requestId) {
            clearTimeout(pending.timer);
            snapshotResolversRef.current.delete(message.payload.requestId);
            finishDiagnosticTrace(pending.trace, 'failure', { reason: 'invalid_response' });
            pending.reject(new Error(message.payload.message));
          }
        }
        if (message.type === 'UPLOAD_COMMAND_RESULT') {
          writes.commandResult(message.payload, documentEpochRef.current);
          return;
        }
        // Revisions restart on INIT. A previous document can still have bridge messages in flight.
        if (
          (message.type === 'READY' ||
            message.type === 'RETURN_TO_EDITOR' ||
            message.type === 'STATE_CHANGED' ||
            message.type === 'TOOLBAR_STATE' ||
            message.type === 'SNAPSHOT' ||
            message.type === 'PANEL_CHANGED') &&
          (message.payload.documentEpoch ?? 0) !== documentEpochRef.current
        )
          return;
        if (message.type === 'TOOLBAR_STATE') {
          setToolbarState(message.payload.state);
          return;
        }
        if (message.type === 'RETURN_TO_EDITOR') {
          if (!ready || !visible || readOnly || dismissPanels || rendererGone) return;
          onReturnToEditor?.();
          webViewRef.current?.requestFocus();
          return;
        }
        if (message.type === 'PANEL_CHANGED') {
          onPanelChange?.(message.payload.open);
          const layout = message.payload.open ? (message.payload.layout ?? 'compact') : 'compact';
          const expanded = layout === 'form';
          setPanelLayout(layout);
          if (presentation !== 'embedded') {
            if (expanded && panelPresentationRef.current === null) {
              panelPresentationRef.current = presentation;
              onPresentationChange?.('fullscreen');
            } else if (!expanded && panelPresentationRef.current !== null) {
              const previous = panelPresentationRef.current;
              panelPresentationRef.current = null;
              onPresentationChange?.(previous);
            }
          }
          return;
        }
        if (message.type === 'USER_INTERACTION') {
          if (visible) recordUserInteraction();
          return;
        }
        if (message.type === 'ERROR' && message.payload.code.startsWith('bridge-invalid')) {
          recordInvalidBridgeMessage('webview');
          return;
        }
        if (message.type === 'READY') {
          transitionDocument('ready');
          syncNodeSeekMember();
          if (initializationTraceRef.current)
            finishDiagnosticTrace(initializationTraceRef.current, 'success', { state: 'ready' });
          initializationTraceRef.current = null;
          clearReadyTimer();
          setLocalError('');
          return;
        }
        if (message.type === 'STATE_CHANGED') {
          if (message.payload.revision < lastRevisionRef.current) return;
          lastRevisionRef.current = message.payload.revision;
          setMode(message.payload.mode);
          setEditorState((current) =>
            current.isEmpty === message.payload.isEmpty &&
            current.canUndo === message.payload.canUndo &&
            current.canRedo === message.payload.canRedo
              ? current
              : {
                  ...current,
                  isEmpty: message.payload.isEmpty,
                  canUndo: message.payload.canUndo,
                  canRedo: message.payload.canRedo
                }
          );
          if (modePreferenceRef.current !== message.payload.mode) {
            modePreferenceRef.current = message.payload.mode;
            void AsyncStorage.setItem(modePreferenceKey(intent.site), message.payload.mode);
          }
          return;
        }
        if (message.type === 'SNAPSHOT') {
          const snapshot = message.payload.snapshot;
          const resolver = message.payload.requestId
            ? snapshotResolversRef.current.get(message.payload.requestId)
            : undefined;
          if (message.payload.requestId && !resolver) return;
          if (snapshot.revision < lastRevisionRef.current) {
            if (resolver) {
              clearTimeout(resolver.timer);
              snapshotResolversRef.current.delete(message.payload.requestId!);
              finishDiagnosticTrace(resolver.trace, 'stale', { reason: 'stale', revision: snapshot.revision });
              resolver.reject(new Error('编辑器返回了过期正文，请重试'));
            }
            return;
          }
          lastRevisionRef.current = snapshot.revision;
          lastConfirmedDraft.current = {
            markdown: snapshot.markdown,
            pendingNodeSeekPolls: snapshot.pendingNodeSeekPolls
          };
          lastExternalSentRef.current = snapshot.markdown;
          onSnapshot(snapshot);
          setMode(snapshot.mode);
          setEditorState((current) =>
            current.isEmpty === snapshot.isEmpty && current.markdownLength === snapshot.markdown.length
              ? current
              : { ...current, isEmpty: snapshot.isEmpty, markdownLength: snapshot.markdown.length }
          );
          if (snapshot.validationIssues.length) setLocalError(snapshot.validationIssues[0]!.message);
          else if (localError && !rendererGone) setLocalError('');
          if (resolver && message.payload.requestId) {
            clearTimeout(resolver.timer);
            snapshotResolversRef.current.delete(message.payload.requestId);
            finishDiagnosticTrace(resolver.trace, 'success', { revision: snapshot.revision });
            resolver.resolve(snapshot);
          }
          return;
        }
        if (message.type === 'REQUEST_HOST_ACTION') {
          const requestEpoch = documentEpochRef.current;
          let imageRequest: ComposerImageHandoff | undefined;
          let panelRequest: object | undefined;
          const reply = (result?: unknown, actionError?: string) => {
            if (requestEpoch !== documentEpochRef.current || !mounted.current) return;
            send({
              type: 'COMMAND',
              payload: {
                name: 'host-action-result',
                requestId: message.payload.requestId,
                ...(result === undefined ? {} : { result }),
                ...(actionError ? { error: actionError } : {})
              }
            });
          };
          void (async () => {
            try {
              if (message.payload.action === 'preview-topic') {
                if (presentation !== 'embedded' || !visible || actionBusy) throw new Error('当前无法打开编辑选项');
                onTogglePreview?.();
                reply();
              } else if (message.payload.action === 'prepare-panel') {
                const epoch = (message.payload.data as { documentEpoch?: unknown } | undefined)?.documentEpoch;
                if (!awaitKeyboardSettled) throw new Error('当前入口尚未准备好编辑工具');
                if (handoffs.panel || handoffs.image || writes.submitting) throw new Error('正在准备编辑操作，请稍候');
                const request = handoffs.claimPanel();
                panelRequest = request;
                const assertCurrent = () => {
                  if (
                    handoffs.panel !== request ||
                    !mounted.current ||
                    !uploadAvailable.current ||
                    !ready ||
                    dismissPanels ||
                    rendererGone ||
                    AppState.currentState === 'background' ||
                    AppState.currentState === 'inactive' ||
                    currentIntentKey.current !== intentKey ||
                    epoch !== documentEpochRef.current
                  )
                    throw new Error('编辑文档已变化，请重新打开工具');
                };
                assertCurrent();
                handoffs.waitForPanel(request);
                publishHandoffs();
                await awaitKeyboardSettled();
                assertCurrent();
                reply();
              } else if (message.payload.action === 'upload-image') {
                if (!onUploadImage) throw new Error('当前入口不支持上传图片');
                if (!awaitKeyboardSettled) throw new Error('当前入口尚未准备好图片选择');
                if (handoffs.panel || handoffs.image || writes.upload?.epoch === documentEpochRef.current)
                  throw new Error('正在准备选择，请稍候');
                const data = message.payload.data as { uploadId?: unknown; documentEpoch?: unknown } | undefined;
                const uploadId = data?.uploadId;
                const epoch = data?.documentEpoch;
                if (
                  typeof uploadId !== 'string' ||
                  !uploadId.length ||
                  uploadId.length > 80 ||
                  typeof epoch !== 'number' ||
                  !Number.isInteger(epoch) ||
                  epoch < 0 ||
                  epoch !== documentEpochRef.current
                )
                  throw new Error('编辑文档已变化，请重新选择');
                const handoff = handoffs.claimImage(uploadId, epoch);
                imageRequest = handoff;
                publishHandoffs();
                const assertCurrent = () => {
                  if (
                    !handoffs.ownsImage(handoff) ||
                    !mounted.current ||
                    !uploadAvailable.current ||
                    AppState.currentState === 'background' ||
                    AppState.currentState === 'inactive' ||
                    currentIntentKey.current !== intentKey ||
                    epoch !== documentEpochRef.current
                  )
                    throw new Error('编辑文档已变化，请重新选择');
                };
                assertCurrent();
                await awaitKeyboardSettled();
                assertCurrent();
                await sendUploadCommand({ name: 'begin-image-upload', uploadId, documentEpoch: epoch });
                assertCurrent();
                const markdown = await onUploadImage();
                reply(typeof markdown === 'string' ? { markdown } : undefined);
              } else if (message.payload.action === 'resolve-linuxdo-upload') {
                if (intent.site !== 'linuxdo' || !onResolveLinuxDoUpload) throw new Error('当前入口不支持图片地址解析');
                const shortUrl = (message.payload.data as { shortUrl?: unknown } | undefined)?.shortUrl;
                if (typeof shortUrl !== 'string') throw new Error('图片短地址不正确');
                reply({ url: await onResolveLinuxDoUpload(shortUrl) });
              } else if (message.payload.action === 'load-linuxdo-templates') {
                if (!onLoadLinuxDoTemplates) throw new Error('当前入口不支持动态模板');
                reply({ templates: await onLoadLinuxDoTemplates() });
              } else if (message.payload.action === 'load-linuxdo-poll-capabilities') {
                if (!onLoadLinuxDoPollCapabilities) throw new Error('当前入口不支持 LinuxDo 投票配置');
                reply(await onLoadLinuxDoPollCapabilities());
              } else {
                if (!onUseLinuxDoTemplate) throw new Error('当前入口不支持动态模板');
                const data = message.payload.data as { id?: unknown } | undefined;
                const id = String(data?.id || '').trim();
                if (!id) throw new Error('模板 id 不正确');
                await onUseLinuxDoTemplate(id);
                reply({ used: true });
              }
            } catch (actionError) {
              if (imageRequest && imageRequest.epoch === documentEpochRef.current)
                send({
                  type: 'COMMAND',
                  payload: {
                    name: 'finish-image-upload',
                    uploadId: imageRequest.uploadId,
                    documentEpoch: imageRequest.epoch
                  }
                });
              reply(undefined, actionError instanceof Error ? actionError.message : '操作失败');
            } finally {
              if (panelRequest && handoffs.panel === panelRequest) {
                handoffs.releasePanel(panelRequest);
                if (mounted.current) publishHandoffs();
              }
              if (imageRequest && handoffs.image === imageRequest) {
                handoffs.releaseImage(imageRequest);
                if (mounted.current) publishHandoffs();
              }
            }
          })();
          return;
        }
        if (message.payload.revision >= lastRevisionRef.current) {
          const editorError = (
            ['markdown-invalid', 'markdown-parse-failed', 'image-upload-pending', 'template-usage-failed'] as const
          ).find((code) => code === message.payload.code);
          const trace = beginDiagnosticTrace('webview', 'composer-error', {
            site: intent.site,
            revision: message.payload.revision
          });
          finishDiagnosticTrace(
            trace,
            editorError === 'markdown-invalid' || editorError === 'image-upload-pending' ? 'blocked' : 'failure',
            { reason: 'invalid_response', ...(editorError ? { editorError } : {}) }
          );
          setLocalError(message.payload.message);
        }
      },
      [
        intent.site,
        intentKey,
        currentIntentKey,
        clearReadyTimer,
        localError,
        onLoadLinuxDoPollCapabilities,
        onResolveLinuxDoUpload,
        onLoadLinuxDoTemplates,
        onSnapshot,
        onUploadImage,
        onUseLinuxDoTemplate,
        onTogglePreview,
        onPanelChange,
        onReturnToEditor,
        onPresentationChange,
        presentation,
        actionBusy,
        awaitKeyboardSettled,
        dismissPanels,
        readOnly,
        ready,
        recordInvalidBridgeMessage,
        rendererGone,
        send,
        sendUploadCommand,
        syncNodeSeekMember,
        transitionDocument,
        visible,
        uploadAvailable,
        handoffs,
        publishHandoffs,
        writes
      ]
    );

    const changeMode = useCallback(
      (nextMode: ComposerMode) => {
        setLocalError('');
        webViewRef.current?.requestFocus();
        send({ type: 'SET_MODE', payload: { mode: nextMode } });
      },
      [send]
    );

    const runToolbarAction = (action: ComposerToolbarAction) => {
      if (
        !ready ||
        documentLifecycle.initializing ||
        !toolbarState ||
        !visible ||
        readOnly ||
        dismissPanels ||
        rendererGone ||
        actionBusy ||
        submitting ||
        handoffs.panel ||
        handoffs.image
      )
        return;
      recordUserInteraction();
      send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: documentEpochRef.current, action } });
    };

    const submit = useCallback(() => {
      if (writes.submitting || handoffs.image || handoffs.panel || actionBusy) return;
      const documentEpoch = documentEpochRef.current;
      const submission = writes.claimSubmission(documentEpoch);
      if (!submission) return;
      setLocalError('');
      void requestSnapshot()
        .then((snapshot) => {
          if (!writes.ownsSubmission(submission) || handoffs.image) return;
          if (snapshot.validationIssues.length) {
            setLocalError(snapshot.validationIssues[0]!.message);
            return;
          }
          if (snapshot.isEmpty) {
            setLocalError('请输入回复内容');
            return;
          }
          const settleSubmission: ComposerSubmissionSettlement = async (complete) => {
            if (!writes.ownsSubmission(submission) || documentEpochRef.current !== documentEpoch) return false;
            let completed = false;
            try {
              const current = await requestSnapshot({ documentEpoch, revision: snapshot.revision });
              if (
                writes.ownsSubmission(submission) &&
                documentEpochRef.current === documentEpoch &&
                current.revision === snapshot.revision
              )
                completed = complete();
              return completed;
            } catch {
              return false;
            } finally {
              // A successful React settlement keeps the old document locked until its replacement INIT.
              if (!completed && writes.ownsSubmission(submission) && documentEpochRef.current === documentEpoch)
                send({ type: 'SET_READ_ONLY', payload: { readOnly: Boolean(currentReadOnly.current) } });
            }
          };
          return onSubmit?.(snapshot, settleSubmission);
        })
        .catch((snapshotError) => {
          if (writes.ownsSubmission(submission))
            setLocalError(snapshotError instanceof Error ? snapshotError.message : '无法取得最新正文');
        })
        .finally(() => {
          writes.releaseSubmission(submission);
        });
    }, [actionBusy, currentReadOnly, onSubmit, requestSnapshot, send, handoffs, writes]);

    const displayError = localError || error || disabledReason;
    const fullscreenFeedback = displayError || status;
    const CloseIcon = closeLabel.includes('收起') ? ChevronDown : X;
    const embedded = presentation === 'embedded';
    const modeSwitch = (
      <View accessibilityRole="tablist" style={styles.modeSwitch}>
        {(['rich', 'source'] as const).map((value) => {
          const active = mode === value;
          const label = value === 'rich' ? '富文本' : '源码';
          const ModeIcon = value === 'rich' ? TextCursorInput : CodeXml;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active, disabled: readOnly }}
              disabled={readOnly}
              style={[styles.modeButton, active && styles.modeButtonActive]}
              onPress={() => changeMode(value)}
            >
              <ModeIcon color={active ? theme.primary : theme.muted} size={19} strokeWidth={1.9} />
            </Pressable>
          );
        })}
      </View>
    );
    const historyActions = (
      <>
        <IconButton
          ghost
          iconOnly
          icon={Undo2}
          iconSize={19}
          label="撤销"
          disabled={readOnly || !ready || !editorState.canUndo}
          onPress={() => send({ type: 'COMMAND', payload: { name: 'undo' } })}
        />
        <IconButton
          ghost
          iconOnly
          icon={Redo2}
          iconSize={19}
          label="重做"
          disabled={readOnly || !ready || !editorState.canRedo}
          onPress={() => send({ type: 'COMMAND', payload: { name: 'redo' } })}
        />
      </>
    );
    const count = ready ? `${editorState.markdownLength} 字符` : '编辑器初始化中';

    return (
      <View ref={toolbarHostRef} collapsable={false} style={styles.root}>
        {!embedded && !expandedPanel ? (
          <View testID="structured-composer-header" style={styles.header}>
            <IconButton
              ghost
              iconOnly
              icon={CloseIcon}
              iconSize={20}
              label={closeLabel}
              onPress={() => onOpenChange?.(false)}
            />
            <View style={styles.headerBody}>
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
            </View>
            {modeSwitch}
            <IconButton
              ghost
              iconOnly
              icon={presentation === 'fullscreen' ? Minimize2 : Maximize2}
              iconSize={20}
              label={presentation === 'fullscreen' ? '退出全屏' : '全屏'}
              onPress={() => onPresentationChange?.(presentation === 'fullscreen' ? 'sheet' : 'fullscreen')}
            />
          </View>
        ) : null}
        <View
          ref={editorFrameRef}
          collapsable={false}
          testID="structured-composer-editor-frame"
          style={styles.editorFrame}
        >
          {rendererGone ? (
            <View style={styles.rendererGone}>
              <Text style={[styles.message, styles.error]}>编辑器进程已退出，最后确认草稿仍在。</Text>
              <AppButton label="重载编辑器" onPress={reloadEditor} />
            </View>
          ) : (
            <WebView
              key={webViewKey}
              ref={webViewRef}
              testID="structured-composer-webview"
              source={source}
              style={styles.webView}
              originWhitelist={['https://composer.local']}
              javaScriptEnabled
              domStorageEnabled={false}
              cacheEnabled
              saveFormDataDisabled
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled={false}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              mixedContentMode="never"
              automaticallyAdjustContentInsets={false}
              androidLayerType="hardware"
              androidPrewarmOnWindowVisible
              nestedScrollEnabled
              overScrollMode="never"
              onLoadEnd={() => {
                if (activeWebViewKey.current === webViewKey) transitionDocument('web-loaded');
              }}
              onMessage={(event) => {
                if (activeWebViewKey.current === webViewKey) handleMessage(event);
              }}
              onRenderProcessGone={() => {
                if (activeWebViewKey.current !== webViewKey) return;
                activeWebViewKey.current += 1;
                const trace = beginDiagnosticTrace('webview', 'composer-error', {
                  site: intent.site,
                  revision: lastRevisionRef.current
                });
                finishDiagnosticTrace(trace, 'failure', { reason: 'renderer_gone' });
                discardDocumentOperations('renderer_gone');
                transitionDocument('renderer-gone');
                setLocalError('编辑器进程已退出，最后确认草稿仍在');
              }}
              onShouldStartLoadWithRequest={(request: WebViewNavigation) =>
                request.url === 'about:blank' || request.url.startsWith('https://composer.local/')
              }
            />
          )}
        </View>
        {initializationTimedOut && !rendererGone ? <AppButton label="重载编辑器" onPress={reloadEditor} /> : null}
        {!readOnly && !expandedPanel && !expressionPanel && !rendererGone ? (
          <ComposerToolbar
            state={toolbarState}
            site={intent.site}
            intentKind={intent.kind}
            disabled={
              !ready ||
              !toolbarState ||
              !visible ||
              Boolean(dismissPanels) ||
              actionBusy ||
              submitting ||
              panelHandoffPending ||
              imageHandoffPending
            }
            onAction={runToolbarAction}
            viewportRef={editorFrameRef}
            hostRef={toolbarHostRef}
            menuHostName={toolbarMenuHost}
          />
        ) : null}
        {presentation === 'fullscreen' && !expandedPanel ? (
          fullscreenFeedback ? (
            <Text accessibilityLiveRegion="polite" style={[styles.message, displayError && styles.error]}>
              {fullscreenFeedback}
            </Text>
          ) : null
        ) : (
          <>
            {status && (embedded || Boolean(expandedPanel) || Boolean(expressionPanel)) ? (
              <Text accessibilityLiveRegion="polite" style={styles.message}>
                {status}
              </Text>
            ) : null}
            {displayError ? (
              <Text accessibilityLiveRegion="polite" style={[styles.message, styles.error]}>
                {displayError}
              </Text>
            ) : null}
          </>
        )}
        {(!embedded || readOnly) && !expandedPanel && !expressionPanel ? (
          <View testID="structured-composer-footer" style={styles.footer}>
            {embedded ? (
              footerActions
            ) : (
              <>
                <View style={styles.footerBody}>
                  <Text
                    accessibilityLiveRegion={status ? 'polite' : 'none'}
                    numberOfLines={1}
                    style={[styles.metaText, { fontVariant: ['tabular-nums'] }]}
                  >
                    {status || count}
                  </Text>
                </View>
                {historyActions}
                <AppButton
                  compact
                  minWidth={76}
                  variant="solid"
                  accessibilityLabel={submitLabel}
                  label={actionBusy || submitting ? '发送中' : submitLabel}
                  loading={actionBusy || submitting}
                  disabled={
                    !ready ||
                    actionBusy ||
                    submitting ||
                    panelHandoffPending ||
                    imageHandoffPending ||
                    editorState.isEmpty ||
                    Boolean(disabledReason) ||
                    rendererGone
                  }
                  onPress={submit}
                />
              </>
            )}
          </View>
        ) : null}
        <PortalHost name={toolbarMenuHost} />
      </View>
    );
  }
);

StructuredReplyComposer.displayName = 'StructuredReplyComposer';
