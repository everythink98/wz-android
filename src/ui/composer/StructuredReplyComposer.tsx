import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { ChevronDown, CodeXml, Maximize2, Minimize2, Redo2, TextCursorInput, Undo2, X } from 'lucide-react-native';
import editorDocument from './generated/editorDocument.json';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import type {
  ComposerIntent,
  ComposerMode,
  ComposerPresentation,
  ComposerSnapshot,
  PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import {
  composerEditorMessageSchema,
  MAX_COMPOSER_EMOJI_COUNT,
  type ComposerHostMessage
} from './structuredComposerBridge';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { androidRipple, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { pressWithFeedback } from '@/ui/controls/pressFeedback';

type TemplateSummary = { id: string; title: string; content: string };
type EmojiUrlMap = Record<string, string>;
const EMPTY_EMOJI_URLS: EmojiUrlMap = {};

export type StructuredReplyComposerHandle = {
  requestSnapshot: () => Promise<ComposerSnapshot>;
  focus: () => void;
};

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontSize = (size: number) => Math.round(size * Math.min(settings.fontScale, 1.15));
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
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(15),
      fontWeight: '600'
    },
    modeSwitch: {
      alignItems: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      padding: 2
    },
    modeButton: {
      alignItems: 'center',
      borderRadius: 8,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 48
    },
    modeButtonActive: { backgroundColor: theme.surface },
    editorFrame: { alignSelf: 'stretch', flex: 1, minHeight: 0, overflow: 'hidden' },
    webView: { flex: 1, backgroundColor: theme.surface },
    message: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(12),
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
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(11)
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
    closeLabel: string;
    content: string;
    disabledReason?: string;
    discourseEmojiUrls?: EmojiUrlMap;
    error?: string;
    focusSignal: number;
    intent: ComposerIntent;
    nodeSeekMemberId?: string;
    pendingNodeSeekPolls: PendingNodeSeekPoll[];
    presentation: ComposerPresentation;
    status?: string;
    submitLabel: string;
    title: string;
    visible: boolean;
    onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
    onLoadLinuxDoTemplates?: () => Promise<TemplateSummary[]>;
    onOpenChange: (open: boolean) => void;
    onPresentationChange: (presentation: ComposerPresentation) => void;
    onSnapshot: (snapshot: ComposerSnapshot) => void;
    onSubmit: (snapshot: ComposerSnapshot) => unknown;
    onUploadImage?: () => unknown;
    onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  }
>(
  (
    {
      actionBusy,
      closeLabel,
      content,
      disabledReason,
      discourseEmojiUrls = EMPTY_EMOJI_URLS,
      error,
      focusSignal,
      intent,
      nodeSeekMemberId,
      pendingNodeSeekPolls,
      presentation,
      status,
      submitLabel,
      title,
      visible,
      onLoadLinuxDoPollCapabilities,
      onLoadLinuxDoTemplates,
      onOpenChange,
      onPresentationChange,
      onSnapshot,
      onSubmit,
      onUploadImage,
      onUseLinuxDoTemplate
    },
    ref
  ) => {
    const { settings, styles, theme } = useReaderThemeStyles(createStyles);
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
        fontScale: settings.fontScale
      }),
      [
        settings.fontScale,
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
    const webViewRef = useRef<WebView>(null);
    const latestSnapshotRef = useRef<ComposerSnapshot>({
      revision: 0,
      markdown: content,
      mode: 'rich',
      isEmpty: !content.trim(),
      validationIssues: [],
      pendingNodeSeekPolls
    });
    const snapshotResolversRef = useRef(
      new Map<
        string,
        {
          resolve: (snapshot: ComposerSnapshot) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >()
    );
    const [mode, setMode] = useState<ComposerMode>('rich');
    const [modeLoaded, setModeLoaded] = useState(false);
    const [webLoaded, setWebLoaded] = useState(false);
    const [ready, setReady] = useState(false);
    const [rendererGone, setRendererGone] = useState(false);
    const [localError, setLocalError] = useState('');
    const [editorState, setEditorState] = useState({
      isEmpty: !content.trim(),
      canUndo: false,
      canRedo: false,
      markdownLength: content.length
    });
    const lastConfirmedMarkdownRef = useRef(content);
    const lastExternalSentRef = useRef(content);
    const lastRevisionRef = useRef(0);
    const modePreferenceRef = useRef<ComposerMode>('rich');
    const initKeyRef = useRef('');
    const editorThemeRef = useRef(editorTheme);
    const sentThemeRef = useRef(editorTheme);
    const sentDiscourseEmojiRef = useRef<readonly { name: string; url: string }[] | null>(null);
    const wasVisibleRef = useRef(visible);
    const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const source = useMemo(() => ({ html: editorDocument.html, baseUrl: 'https://composer.local/' }), []);
    const intentKey =
      intent.kind === 'private-message'
        ? `${intent.site}:pm:${intent.conversationId}`
        : `${intent.site}:${intent.kind}:${intent.topicId}:${intent.kind === 'edit-reply' ? intent.commentId : ''}`;
    const discourseEmoji = useMemo(
      () =>
        Object.entries(discourseEmojiUrls)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^https?:\/\//i.test(entry[1]))
          .slice(0, MAX_COMPOSER_EMOJI_COUNT)
          .map(([name, url]) => ({ name, url })),
      [discourseEmojiUrls]
    );

    useEffect(() => {
      editorThemeRef.current = editorTheme;
    }, [editorTheme]);

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
    const focusEditor = useCallback(() => {
      webViewRef.current?.requestFocus();
      send({ type: 'COMMAND', payload: { name: 'focus' } });
    }, [send]);

    const sendInit = useCallback(() => {
      if (!modeLoaded) return;
      const initialTheme = editorThemeRef.current;
      pendingNodeSeekPolls.forEach((poll) => {
        // Zod at the bridge boundary validates the full sidecar again.
        void poll;
      });
      send({
        type: 'INIT',
        payload: {
          site: intent.site,
          intentKind: intent.kind,
          markdown: content,
          pendingNodeSeekPolls,
          mode,
          ...(nodeSeekMemberId && /^\d+$/.test(nodeSeekMemberId) ? { nodeSeekMemberId } : {}),
          discourseEmoji,
          theme: initialTheme
        }
      });
      sentThemeRef.current = initialTheme;
      sentDiscourseEmojiRef.current = discourseEmoji;
      initKeyRef.current = intentKey;
      lastConfirmedMarkdownRef.current = content;
      lastExternalSentRef.current = content;
      lastRevisionRef.current = 0;
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
      readyTimerRef.current = setTimeout(() => setLocalError('编辑器启动超时，可重载后继续'), 1500);
    }, [
      content,
      discourseEmoji,
      intent.kind,
      intent.site,
      intentKey,
      mode,
      modeLoaded,
      nodeSeekMemberId,
      pendingNodeSeekPolls,
      send
    ]);

    useEffect(() => {
      let current = true;
      setModeLoaded(false);
      void AsyncStorage.getItem(modePreferenceKey(intent.site))
        .then((stored) => {
          if (!current) return;
          const storedMode = stored === 'source' ? 'source' : 'rich';
          modePreferenceRef.current = storedMode;
          setMode(storedMode);
        })
        .finally(() => {
          if (current) setModeLoaded(true);
        });
      return () => {
        current = false;
      };
    }, [intent.site]);

    useEffect(() => {
      if (webLoaded && modeLoaded && !ready) sendInit();
    }, [modeLoaded, ready, sendInit, webLoaded]);

    useEffect(() => {
      if (!ready || initKeyRef.current === intentKey) return;
      sendInit();
    }, [intentKey, ready, sendInit]);

    useEffect(() => {
      if (!ready || sentThemeRef.current === editorTheme) return;
      sentThemeRef.current = editorTheme;
      send({ type: 'SET_THEME', payload: editorTheme });
    }, [editorTheme, ready, send]);

    useEffect(() => {
      if (!ready || intent.site !== 'linuxdo' || sentDiscourseEmojiRef.current === discourseEmoji) return;
      sentDiscourseEmojiRef.current = discourseEmoji;
      send({ type: 'COMMAND', payload: { name: 'set-discourse-emoji', discourseEmoji } });
    }, [discourseEmoji, intent.site, ready, send]);

    useEffect(() => {
      if (!ready || content === lastConfirmedMarkdownRef.current || content === lastExternalSentRef.current) return;
      lastExternalSentRef.current = content;
      const confirmed = lastConfirmedMarkdownRef.current;
      const markdown = content.startsWith(confirmed) ? content.slice(confirmed.length) : content;
      send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown } });
    }, [content, ready, send]);

    const requestSnapshot = useCallback(() => {
      if (!ready) return Promise.reject(new Error('编辑器尚未就绪'));
      const id = requestId();
      return new Promise<ComposerSnapshot>((resolve, reject) => {
        const timer = setTimeout(() => {
          snapshotResolversRef.current.delete(id);
          reject(new Error('无法取得最新正文，草稿已保留'));
        }, 1500);
        snapshotResolversRef.current.set(id, { resolve, reject, timer });
        send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: id } });
      });
    }, [ready, send]);

    useImperativeHandle(
      ref,
      () => ({
        requestSnapshot,
        focus: focusEditor
      }),
      [focusEditor, requestSnapshot]
    );

    useEffect(() => {
      if (focusSignal > 0 && ready) focusEditor();
    }, [focusEditor, focusSignal, ready]);

    useEffect(() => {
      if (wasVisibleRef.current && !visible && ready) {
        send({ type: 'COMMAND', payload: { name: 'blur' } });
      }
      wasVisibleRef.current = visible;
    }, [ready, send, visible]);

    useEffect(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active' && visible && ready) void requestSnapshot().catch(() => undefined);
      });
      return () => subscription.remove();
    }, [ready, requestSnapshot, visible]);

    useEffect(
      () => () => {
        if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
        snapshotResolversRef.current.forEach(({ reject, timer }) => {
          clearTimeout(timer);
          reject(new Error('编辑器已关闭'));
        });
        snapshotResolversRef.current.clear();
        send({ type: 'DESTROY' });
      },
      [send]
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.nativeEvent.data);
        } catch {
          setLocalError('编辑器返回了无效消息');
          return;
        }
        const parsed = composerEditorMessageSchema.safeParse(raw);
        if (!parsed.success) {
          setLocalError('编辑器返回了无效消息');
          return;
        }
        const message = parsed.data;
        if (message.type === 'READY') {
          if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
          readyTimerRef.current = null;
          setReady(true);
          setRendererGone(false);
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
          if (snapshot.revision < lastRevisionRef.current) {
            if (resolver) {
              clearTimeout(resolver.timer);
              snapshotResolversRef.current.delete(message.payload.requestId!);
              resolver.reject(new Error('编辑器返回了过期正文，请重试'));
            }
            return;
          }
          lastRevisionRef.current = snapshot.revision;
          lastConfirmedMarkdownRef.current = snapshot.markdown;
          lastExternalSentRef.current = snapshot.markdown;
          latestSnapshotRef.current = snapshot;
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
            resolver.resolve(snapshot);
          }
          return;
        }
        if (message.type === 'REQUEST_HOST_ACTION') {
          const reply = (result?: unknown, actionError?: string) =>
            send({
              type: 'COMMAND',
              payload: {
                name: 'host-action-result',
                requestId: message.payload.requestId,
                ...(result === undefined ? {} : { result }),
                ...(actionError ? { error: actionError } : {})
              }
            });
          void (async () => {
            try {
              if (message.payload.action === 'upload-image') {
                if (!onUploadImage) throw new Error('当前入口不支持上传图片');
                const markdown = await onUploadImage();
                reply(typeof markdown === 'string' ? { markdown } : undefined);
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
              reply(undefined, actionError instanceof Error ? actionError.message : '操作失败');
            }
          })();
          return;
        }
        if (message.payload.revision >= lastRevisionRef.current) setLocalError(message.payload.message);
      },
      [
        intent.site,
        localError,
        onLoadLinuxDoPollCapabilities,
        onLoadLinuxDoTemplates,
        onSnapshot,
        onUploadImage,
        onUseLinuxDoTemplate,
        rendererGone,
        send
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

    const submit = useCallback(() => {
      setLocalError('');
      void requestSnapshot()
        .then((snapshot) => {
          if (snapshot.validationIssues.length) {
            setLocalError(snapshot.validationIssues[0]!.message);
            return;
          }
          if (snapshot.isEmpty) {
            setLocalError('请输入回复内容');
            return;
          }
          return onSubmit(snapshot);
        })
        .catch((snapshotError) =>
          setLocalError(snapshotError instanceof Error ? snapshotError.message : '无法取得最新正文')
        );
    }, [onSubmit, requestSnapshot]);

    const displayError = localError || error || disabledReason;
    const fullscreenFeedback = displayError || status;
    const CloseIcon = closeLabel.includes('收起') ? ChevronDown : X;

    return (
      <View style={styles.root}>
        <View testID="structured-composer-header" style={styles.header}>
          <IconButton
            ghost
            iconOnly
            icon={CloseIcon}
            iconSize={20}
            label={closeLabel}
            onPress={() => onOpenChange(false)}
          />
          <View style={styles.headerBody}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </View>
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
                  accessibilityState={{ selected: active }}
                  android_ripple={androidRipple(theme.primarySoft, true)}
                  style={[styles.modeButton, active && styles.modeButtonActive]}
                  onPress={() => pressWithFeedback(() => changeMode(value))}
                >
                  <ModeIcon color={active ? theme.primary : theme.muted} size={19} strokeWidth={1.9} />
                </Pressable>
              );
            })}
          </View>
          <IconButton
            ghost
            iconOnly
            icon={presentation === 'fullscreen' ? Minimize2 : Maximize2}
            iconSize={20}
            label={presentation === 'fullscreen' ? '退出全屏' : '全屏'}
            onPress={() => onPresentationChange(presentation === 'fullscreen' ? 'sheet' : 'fullscreen')}
          />
        </View>
        <View testID="structured-composer-editor-frame" style={styles.editorFrame}>
          {rendererGone ? (
            <View style={styles.rendererGone}>
              <Text style={[styles.message, styles.error]}>编辑器进程已退出，最后确认草稿仍在。</Text>
              <AppButton
                label="重载编辑器"
                onPress={() => {
                  setRendererGone(false);
                  setReady(false);
                  setWebLoaded(false);
                  webViewRef.current?.reload();
                }}
              />
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              testID="structured-composer-webview"
              source={source}
              style={styles.webView}
              originWhitelist={['https://composer.local']}
              javaScriptEnabled
              domStorageEnabled={false}
              cacheEnabled={false}
              saveFormDataDisabled
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled={false}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              mixedContentMode="never"
              nestedScrollEnabled
              overScrollMode="never"
              textZoom={100}
              onLoadEnd={() => {
                setWebLoaded(true);
              }}
              onMessage={handleMessage}
              onRenderProcessGone={() => {
                setReady(false);
                setRendererGone(true);
                setLocalError('编辑器进程已退出，最后确认草稿仍在');
              }}
              onShouldStartLoadWithRequest={(request: WebViewNavigation) =>
                request.url === 'about:blank' || request.url.startsWith('https://composer.local/')
              }
            />
          )}
        </View>
        {presentation === 'fullscreen' ? (
          fullscreenFeedback ? (
            <Text accessibilityLiveRegion="polite" style={[styles.message, displayError && styles.error]}>
              {fullscreenFeedback}
            </Text>
          ) : null
        ) : (
          <>
            {status ? (
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
        <View testID="structured-composer-footer" style={styles.footer}>
          <View style={styles.footerBody}>
            <Text numberOfLines={1} style={styles.metaText}>
              {ready ? `${editorState.markdownLength} 字符` : '编辑器初始化中'}
            </Text>
          </View>
          <IconButton
            ghost
            iconOnly
            icon={Undo2}
            iconSize={19}
            label="撤销"
            disabled={!ready || !editorState.canUndo}
            onPress={() => send({ type: 'COMMAND', payload: { name: 'undo' } })}
          />
          <IconButton
            ghost
            iconOnly
            icon={Redo2}
            iconSize={19}
            label="重做"
            disabled={!ready || !editorState.canRedo}
            onPress={() => send({ type: 'COMMAND', payload: { name: 'redo' } })}
          />
          <AppButton
            compact
            variant="primary"
            accessibilityLabel={submitLabel}
            label={actionBusy ? '处理中…' : submitLabel}
            disabled={!ready || actionBusy || editorState.isEmpty || Boolean(disabledReason) || rendererGone}
            onPress={submit}
          />
        </View>
      </View>
    );
  }
);

StructuredReplyComposer.displayName = 'StructuredReplyComposer';
