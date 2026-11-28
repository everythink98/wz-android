import {
  useComposerKeyboardSource,
  type KeyboardSource,
  type PublishKeyboardSource
} from '@/ui/hooks/useComposerKeyboardSource';
import { AppSwitch as Switch, AppTextInput } from '@/ui/controls/InputControls';
import { ActivityIndicator } from 'react-native-paper';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  KeyboardState,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  type SharedValue
} from 'react-native-reanimated';
import {
  Check,
  Circle,
  CircleCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Eye,
  FileText,
  ImagePlus,
  Paperclip,
  Pencil,
  RotateCw,
  Trash2,
  Upload,
  X
} from 'lucide-react-native';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import type {
  TopicCreationSource,
  TopicDraft,
  TopicDraftAttachment,
  YaohuoTopicKind
} from '@/domain/forum/topicComposer';
import { validateTopicDraft, validateTopicEdit } from '@/domain/forum/topicComposer';
import { createTopicComposerPanels, type TopicComposerPanel, type TopicPanelRequest } from './topicComposerPanels';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { LoadingState } from '@/ui/controls/FeedbackStates';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { NavigationBackdropProvider, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import { StructuredReplyComposer } from '@/ui/composer/StructuredReplyComposer';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ComposerKeyboardHost, type ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  readerRadii,
  type ReaderStyleSettings,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useKeyboardHandoff } from '@/ui/hooks/useKeyboardHandoff';
import { useComposerKeyboardAdmission } from '@/ui/hooks/useComposerKeyboardAdmission';
import type { useTopicComposerController } from './useTopicComposerController';
import { TopicSelectionPanel } from './TopicSelectionPanel';
import { useTopicTagSearch } from './useTopicTagSearch';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = fontFamilyValue(settings.fontFamily);
  const uiFontFamily = fontFamilyValue(settings.uiFontFamily);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.surface },
    header: {
      zIndex: 1,
      minHeight: 56,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    siteButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6
    },
    siteIdentity: {
      flexDirection: 'column',
      alignItems: 'center',
      minWidth: 0,
      flexShrink: 1,
      paddingVertical: 4,
      gap: 0
    },
    siteName: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    heading: {
      color: theme.ink,
      fontFamily: uiFontFamily,
      fontSize: Math.round(16 * settings.uiFontScale),
      lineHeight: Math.round(22 * settings.uiFontScale),
      includeFontPadding: false,
      fontWeight: '600',
      flexShrink: 1
    },
    text: {
      color: theme.ink,
      fontFamily: uiFontFamily,
      fontSize: Math.round(14 * settings.uiFontScale),
      lineHeight: Math.round(20 * settings.uiFontScale),
      includeFontPadding: false,
      flexShrink: 1
    },
    muted: {
      color: theme.muted,
      fontFamily: uiFontFamily,
      fontSize: Math.round(12 * settings.uiFontScale),
      lineHeight: Math.round(18 * settings.uiFontScale),
      includeFontPadding: false,
      flexShrink: 1
    },
    error: { color: theme.danger, fontFamily: uiFontFamily, ...textSizeStyle(Math.round(13 * settings.uiFontScale)) },
    meta: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 4 },
    yaohuoMeta: { paddingTop: 12, paddingBottom: 8, gap: 8 },
    metaViewport: { maxHeight: '42%', flexGrow: 0, flexShrink: 1 },
    metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metadataBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    settingsControl: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: readerRadii.control,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
    },
    settingsControlCompact: {
      flex: 0,
      flexShrink: 1
    },
    settingsLabel: { flexShrink: 1, fontWeight: '500', fontSize: Math.round(13 * settings.uiFontScale) },
    attachmentLabelRow: { flexDirection: 'row', flexShrink: 1, alignItems: 'center', gap: 6 },
    attachmentCount: {
      color: theme.primary,
      fontFamily: uiFontFamily,
      ...textSizeStyle(Math.round(12 * settings.uiFontScale)),
      fontWeight: '600'
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    title: {
      color: theme.ink,
      fontFamily: font,
      ...textSizeStyle(Math.round(22 * settings.fontScale)),
      fontWeight: '600',
      paddingVertical: 6,
      paddingHorizontal: 0,
      minHeight: 48,
      maxHeight: 104,
      textAlignVertical: 'top'
    },
    yaohuoTitle: {
      fontSize: Math.round(20 * settings.fontScale),
      lineHeight: Math.round(28 * settings.fontScale),
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    input: {
      minHeight: 48
    },
    label: {
      color: theme.ink,
      fontFamily: uiFontFamily,
      ...textSizeStyle(Math.round(13 * settings.uiFontScale)),
      fontWeight: '500'
    },
    field: { gap: 6, marginBottom: 12 },
    editor: { flex: 1, minHeight: 120 },
    metadataSummary: {
      flex: 1,
      minWidth: 80,
      minHeight: 44,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      borderRadius: readerRadii.control,
      gap: 4
    },
    banner: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    center: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 },
    metadataControl: {
      minHeight: 38,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 240,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth
    },
    tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    saveLine: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    thumbnail: { width: 56, height: 56, borderRadius: readerRadii.content, backgroundColor: theme.surface2 },
    fileIcon: {
      width: 56,
      height: 56,
      borderRadius: readerRadii.content,
      backgroundColor: theme.surface2,
      alignItems: 'center',
      justifyContent: 'center'
    },
    attachmentIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    attachmentInfo: { flex: 1, minWidth: 0, gap: 4 },
    attachmentActions: { flexDirection: 'row', alignItems: 'center', gap: 0 },
    attachmentAction: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    mediaPickers: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 8 },
    mediaPicker: {
      minHeight: 48,
      flexGrow: 1,
      flexBasis: 120,
      justifyContent: 'center'
    },
    attachmentDescription: { paddingLeft: 68, gap: 4 },
    emptyMedia: { paddingVertical: 20, alignItems: 'center', gap: 6 },
    option: {
      minHeight: 48,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: readerRadii.control,
      marginVertical: 2,
      justifyContent: 'center',
      gap: 4
    },
    optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12 },
    optionText: { flex: 1, gap: 4 },
    selected: { backgroundColor: theme.primarySoft },
    selectedText: { color: theme.primary, fontWeight: '600' },
    sectionLabel: { marginTop: 8, marginBottom: 6 },
    choiceIndicator: { width: 24, alignItems: 'center', justifyContent: 'center' },
    switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
    section: {
      gap: 8,
      paddingVertical: 12,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    sheetBody: { gap: 4 },
    chip: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: readerRadii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line
    },
    selectedChip: { borderColor: theme.primary, backgroundColor: theme.primarySoft },
    disabled: { opacity: 0.5 },
    flex: { flex: 1 }
  });
}

function AttachmentThumbnail({ file }: { file: TopicDraftAttachment }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const [failed, setFailed] = useState(false);
  const localImage =
    /^(file|content):\/\//.test(file.uri) && /^image\/(jpeg|jpg|png|gif|webp|bmp|avif)$/.test(file.mimeType);
  return localImage && !failed ? (
    <Image
      source={{ uri: file.uri }}
      style={styles.thumbnail}
      resizeMode="cover"
      accessibilityLabel={`${file.name} 缩略图`}
      onError={() => setFailed(true)}
    />
  ) : (
    <View style={styles.fileIcon} accessible={false}>
      <FileText size={26} color={theme.muted} />
    </View>
  );
}

function fileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.max(0.1, size / 1024).toFixed(1)} KiB`;
}

function Field({
  label,
  value,
  onChange,
  numeric,
  multiline,
  error,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View style={styles.field}>
      <AppTextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        accessibilityState={{ disabled }}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        style={styles.input}
        error={Boolean(error)}
        keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={multiline}
        autoCapitalize="none"
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const kindLabels: Record<YaohuoTopicKind, string> = {
  normal: '普通／悬赏',
  gift: '派币',
  poll: '投票',
  files: '本地文件',
  resources: '外站资源'
};
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'heic',
  'heif',
  'tiff',
  'ico'
]);
type Controller = ReturnType<typeof useTopicComposerController>;

function TopicComposerKeyboardObserver({
  bottomInset,
  publish,
  pickerReady,
  onOpened
}: {
  bottomInset: number;
  publish: PublishKeyboardSource;
  pickerReady: SharedValue<boolean>;
  onOpened: () => void;
}) {
  const keyboard = useComposerKeyboardSource(publish);
  useAnimatedReaction(
    () =>
      keyboard.height.value === 0 &&
      (keyboard.state.value === KeyboardState.CLOSED || keyboard.state.value === KeyboardState.UNKNOWN),
    (ready) => pickerReady.set(ready)
  );
  // A positive height can belong to the previous hide; only a new OPEN confirms the return.
  useAnimatedReaction(
    () => keyboard.state.value === KeyboardState.OPEN && keyboard.height.value > bottomInset,
    (opened, previous) => {
      if (opened && !previous) runOnJS(onOpened)();
    }
  );
  useEffect(
    () => () => {
      pickerReady.set(false);
    },
    [pickerReady]
  );
  return null;
}

export function TopicComposerScreen({
  active = true,
  routeFocus,
  editorEnabled = true,
  controller: c,
  sessions,
  enabledSources,
  onBack,
  onOpenAccount,
  onManageSources
}: {
  active?: boolean;
  routeFocus?: { isFocused: () => boolean; addListener: (name: 'blur', callback: () => void) => () => void };
  editorEnabled?: boolean;
  controller: Controller;
  sessions: SiteSessionViewModels;
  enabledSources: readonly string[];
  onBack: () => void;
  onOpenAccount: (source: TopicCreationSource) => void;
  onManageSources: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const onLayout = useStartupPageLayout();
  const insets = useSafeAreaInsets();
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleMetadataExpanded, setTitleMetadataExpanded] = useState(false);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [editorPanelOpen, setEditorPanelOpen] = useState(false);
  const [editorFocusPending, setEditorFocusPending] = useState(false);
  const returnToEditor = useCallback(() => {
    setTitleMetadataExpanded(false);
    if (editorPanelOpen || !keyboardShown) setEditorFocusPending(true);
  }, [editorPanelOpen, keyboardShown]);
  const keyboardOpened = useCallback(() => {
    setTitleMetadataExpanded(false);
    setKeyboardShown(true);
    setEditorFocusPending(false);
  }, []);
  const changeEditorPanel = useCallback((open: boolean) => {
    setEditorPanelOpen(open);
    if (open) setEditorFocusPending(false);
  }, []);
  const [keyboard, setKeyboard] = useState<KeyboardSource | null>(null);
  const pickerReady = useSharedValue(false);
  const keyboardHost = useRef<ComposerKeyboardHostHandle>(null);
  const modalKeyboardHost = useRef<ComposerKeyboardHostHandle>(null);
  // The Modal has its own window. Its native completion owns IME readiness;
  // reuse the handoff's UI-frame check without subscribing the Activity again.
  const modalPickerReady = useSharedValue(true);
  const { foreground, retainedWhileBackground, ignoreOldKeyboard, resumedKeyboardHeight, onImeInsets } =
    useComposerKeyboardAdmission();
  const visibleKeyboardHeight = () => {
    'worklet';
    const animatedHeight = keyboard?.height.value ?? 0;
    if (!foreground.value) return retainedWhileBackground.value ? animatedHeight : 0;
    return ignoreOldKeyboard.value && keyboard?.state.value !== KeyboardState.OPENING
      ? resumedKeyboardHeight.value
      : animatedHeight;
  };
  useAnimatedReaction(
    () => visibleKeyboardHeight() > insets.bottom,
    (shown, previous) => {
      if (shown !== previous) runOnJS(setKeyboardShown)(shown);
    }
  );
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, visibleKeyboardHeight() - insets.bottom)
  }));
  const metadataCollapsed =
    !titleEditing && !titleMetadataExpanded && (keyboardShown || editorPanelOpen || editorFocusPending);
  const [panelFlow] = useState(createTopicComposerPanels);
  const [presentation, setPanelView] = useState(panelFlow.presentation);
  const { panel } = presentation;
  const publishPanels = useCallback(() => setPanelView(panelFlow.presentation), [panelFlow]);
  const presentPanel = useCallback(
    (next: TopicComposerPanel) => {
      panelFlow.show(next);
      publishPanels();
    },
    [panelFlow, publishPanels]
  );
  useLayoutEffect(() => routeFocus?.addListener('blur', () => presentPanel(null)), [presentPanel, routeFocus]);
  useEffect(() => () => panelFlow.cancel(), [panelFlow]);
  const panelOwner = useCommittedRef({ active, busy: c.busy, draftId: c.draft?.id });
  const settleKeyboard = useKeyboardHandoff(pickerReady, active && panel === null, keyboardHost);
  const awaitModalKeyboardSettled = useKeyboardHandoff(modalPickerReady, active && panel !== null, modalKeyboardHost);
  const [preview, setPreview] = useState(false);
  const togglePreview = () => {
    if (c.busy || c.uploading) return;
    Keyboard.dismiss();
    setPreview((value) => !value);
  };
  const [tagQuery, setTagQuery] = useState('');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [bodyFocusSignal, setBodyFocusSignal] = useState(0);
  const [insertionError, setInsertionError] = useState('');
  const [descriptionFileId, setDescriptionFileId] = useState<string | null>(null);
  const titleRef = useRef<TextInput>(null);
  const awaitKeyboardSettled = useCallback(async () => {
    await settleKeyboard();
    if (titleEditing) {
      titleRef.current?.blur();
      setTitleEditing(false);
    }
  }, [settleKeyboard, titleEditing]);
  const { draft, context, searchTags } = c;
  const rulesLoading = c.contextLoading && !context;
  const editorObscured = Boolean(
    draft &&
    (c.loading ||
      !c.enabled ||
      draft.source !== c.source ||
      draft.identityKey !== siteSessionIdentityKey(sessions[draft.source]))
  );
  const tagSearch = useTopicTagSearch({
    context,
    draft,
    enabled: active && panel === 'tags' && !editorObscured,
    query: tagQuery,
    search: searchTags
  });
  const freshTagResult = tagSearch.rulesCurrent ? tagSearch.result : undefined;
  const allowed = (field: keyof NonNullable<typeof c.editContext>['permissions']) =>
    !c.editing || (!c.replacementDocument && c.editContext?.permissions[field] === true);
  const titleEditable = !c.busy && allowed('title');
  const bodyReadOnly = c.busy || preview || !allowed('body');
  useEffect(() => {
    if (titleEditing || !active || panel !== null || bodyReadOnly || editorObscured) setEditorFocusPending(false);
  }, [active, bodyReadOnly, editorFocusPending, editorObscured, panel, titleEditing]);
  const draftErrors = useMemo(
    () =>
      draft && context
        ? c.editing && c.editContext
          ? validateTopicEdit(draft, c.editContext)
          : validateTopicDraft(draft, context)
        : {},
    [draft, context, c.editing, c.editContext]
  );
  const invalidPostType =
    (draft?.source === 'linuxdo' && context?.source === 'linuxdo' && draft.postVoting && !context.postVotingEnabled) ||
    (draft?.source === 'yaohuo' && context?.source === 'yaohuo' && !context.kinds.includes(draft.kind));
  const categoryError =
    c.errors.categoryId || (draft?.categoryId || invalidPostType ? draftErrors.categoryId : undefined);
  const rankError = c.errors.rank || draftErrors.rank;
  const tagsMessage =
    c.errors.tags ||
    draftErrors.tags ||
    (draft?.source === 'linuxdo' && freshTagResult?.requiredGroup
      ? `请从 ${freshTagResult.requiredGroup.name} 选择至少 ${freshTagResult.requiredGroup.minCount} 个标签`
      : '');
  const tagsError = c.errors.tags || (draft?.source === 'linuxdo' && draft.tags.length ? tagsMessage : undefined);
  const tagsHint = tagsError ? undefined : tagsMessage;
  const category = context?.categories.find((item) => item.id === draft?.categoryId);
  const mediaTitle = draft?.source === 'linuxdo' ? '附件' : '文件';
  const imageAttachments = draft?.attachments.filter((file) => file.kind === 'image') || [];
  const fileAttachments =
    draft?.attachments.filter((file) =>
      draft.source === 'linuxdo'
        ? file.kind === 'attachment'
        : draft.source === 'yaohuo' && draft.kind === 'files' && file.kind === 'yaohuo-file'
    ) || [];
  const visibleAttachments = panel === 'images' ? imageAttachments : fileAttachments;
  const hasFilePanel = draft?.source === 'linuxdo' || (draft?.source === 'yaohuo' && draft.kind === 'files');
  const mediaLabel = `${mediaTitle}${fileAttachments.length ? ` ${fileAttachments.length}` : ''}`;
  const imageRuleError =
    c.errors.attachments && draft?.source === 'linuxdo' && context?.source === 'linuxdo' && imageAttachments.length
      ? validateTopicDraft({ ...draft, attachments: imageAttachments }, context).attachments
      : undefined;
  const attachmentErrorPanel = useCommittedRef<'images' | 'attachments'>(
    !hasFilePanel ||
      imageRuleError ||
      imageAttachments.some((file) => file.status !== 'uploaded') ||
      (draft?.source === 'linuxdo' && imageAttachments.length && !fileAttachments.length)
      ? 'images'
      : 'attachments'
  );
  const canPickFiles =
    context?.source === 'linuxdo' &&
    context.canUploadAttachments &&
    context.allowedExtensions.some((extension) => !IMAGE_EXTENSIONS.has(extension));
  const settingsSummary =
    draft?.source === 'nodeseek'
      ? draft.rank === 255
        ? '私有'
        : draft.rank
          ? `Lv${draft.rank}`
          : '公开'
      : draft?.source === 'linuxdo'
        ? draft.postVoting
          ? '问答主题'
          : '普通主题'
        : draft?.source === 'yaohuo'
          ? c.editing
            ? '追加悬赏'
            : draft.kind !== 'normal'
              ? kindLabels[draft.kind]
              : draft.reward
                ? `悬赏 ${draft.reward} 妖晶`
                : '普通帖'
          : '';
  const unresolved = c.attempt?.status === 'sending' || c.attempt?.status === 'unknown';
  const hasPanelAccess = () =>
    (!routeFocus || routeFocus.isFocused()) &&
    panelFlow.presentation === presentation &&
    panelOwner.current.draftId === draft?.id;
  function panelAction<Args extends unknown[]>(action: (...args: Args) => unknown) {
    return (...args: Args) => {
      if (hasPanelAccess()) action(...args);
    };
  }
  const changePanelDraft = panelAction(c.change);
  const currentPanelRequest = (request: TopicPanelRequest) => hasPanelAccess() && panelFlow.owns(request);
  const currentPanelAccess = (request: TopicPanelRequest) =>
    currentPanelRequest(request) && panelOwner.current.active && !panelOwner.current.busy;
  const openPanel = async (next: TopicComposerPanel) => {
    if (!hasPanelAccess() || c.busy) return;
    const request = panelFlow.opening(next);
    if (!request) return;
    setInsertionError('');
    try {
      await (panel === null ? awaitKeyboardSettled() : awaitModalKeyboardSettled());
      if (!currentPanelAccess(request)) return;
      if (next === 'attachments' || next === 'images') setPreview(false);
      if (next === 'categories') setCategoryQuery('');
      if (panelFlow.opened(request)) publishPanels();
    } catch (cause) {
      if (currentPanelAccess(request))
        setInsertionError(cause instanceof Error ? cause.message : '键盘尚未收起，请重试');
    } finally {
      panelFlow.finished(request);
    }
  };
  const pickPanelAttachment = async (kind: 'attachment' | 'yaohuo-file') => {
    if (!hasPanelAccess()) return;
    const request = panelFlow.working('pick');
    if (!request) return;
    setInsertionError('');
    try {
      await awaitModalKeyboardSettled();
      if (!currentPanelAccess(request)) return;
      await c.pickAttachments(kind);
    } catch (cause) {
      if (currentPanelAccess(request))
        setInsertionError(cause instanceof Error ? cause.message : '选择附件失败，请重试');
    } finally {
      panelFlow.finished(request);
    }
  };

  const updateYaohuo = (update: (value: Extract<TopicDraft, { source: 'yaohuo' }>) => TopicDraft) =>
    changePanelDraft((value) => (value.source === 'yaohuo' ? update(value) : value));
  const giftKind = draft?.source === 'yaohuo' && draft.kind === 'gift' ? 'gift' : 'poll';
  useEffect(() => {
    setPreview(false);
    presentPanel(null);
    setTagQuery('');
    setInsertionError('');
    setDescriptionFileId(null);
    setTitleMetadataExpanded(false);
    setEditorPanelOpen(false);
    setEditorFocusPending(false);
  }, [draft?.id, presentPanel]);
  useEffect(() => {
    if (c.uploading) {
      panelFlow.uploadStarted();
      publishPanels();
    }
  }, [c.uploading, panelFlow, publishPanels]);
  useEffect(() => {
    if (editorObscured || (routeFocus && !routeFocus.isFocused())) return;
    if (c.errors.title) titleRef.current?.focus();
    else if (c.errors.categoryId) presentPanel('categories');
    else if (c.errors.tags) presentPanel('tags');
    else if (c.errors.attachments) presentPanel(attachmentErrorPanel.current);
    else if (c.errors.body || (draft?.source === 'nodeseek' && c.errors.poll)) {
      setPreview(false);
      setBodyFocusSignal((value) => value + 1);
    } else if (c.errors.rank || c.errors.reward || c.errors.gift || c.errors.poll || c.errors.resources)
      presentPanel('options');
  }, [attachmentErrorPanel, c.errors, draft?.source, editorObscured, presentPanel, routeFocus]);
  const insertAndClose = async (markup: string) => {
    if (!hasPanelAccess() || c.busy || preview) return;
    const request = panelFlow.working('insert');
    if (!request) return;
    setInsertionError('');
    try {
      await c.insertMarkup(markup);
      if (currentPanelRequest(request) && panelFlow.closed(request)) publishPanels();
    } catch (error) {
      if (currentPanelRequest(request)) setInsertionError(error instanceof Error ? error.message : '插入失败，请重试');
    } finally {
      panelFlow.finished(request);
    }
  };
  const rebaseAndClose = async () => {
    if (!hasPanelAccess()) return;
    const request = panelFlow.working('rebase');
    if (!request) return;
    try {
      const saved = await c.rebaseEdit();
      if (saved && currentPanelRequest(request) && panelFlow.closed(request)) publishPanels();
    } finally {
      panelFlow.finished(request);
    }
  };
  const panelTitle = {
    latest: '原站最新内容',
    sites: '选择发帖网站',
    more: '附件与草稿',
    options: '帖子设置',
    categories: '选择版块',
    tags: '选择标签',
    attachments: mediaTitle,
    images: '图片上传记录'
  };
  const footerActions = (
    <View style={styles.tools}>
      {draft?.source !== 'yaohuo' ? (
        <IconButton
          icon={preview ? Pencil : Eye}
          iconOnly
          iconSize={21}
          label={preview ? '继续编辑' : '预览'}
          disabled={c.busy || c.uploading}
          onPress={togglePreview}
        />
      ) : null}
    </View>
  );
  const siteIdentity = (
    <View style={styles.siteIdentity}>
      <View style={styles.siteName}>
        <Text numberOfLines={1} style={styles.heading}>
          {c.source ? sourceCatalog[c.source].label : '发帖'}
        </Text>
        {!c.editing ? <ChevronDown color={theme.ink} size={15} accessible={false} /> : null}
      </View>
      <Text numberOfLines={1} style={styles.muted}>
        {c.session?.currentUser?.username || c.session?.statusLabel || '选择发帖账号'}
        {draft ? ` · ${c.uploading ? '上传中…' : c.saveStatus}` : ''}
      </Text>
    </View>
  );
  const submitDisabled =
    !draft ||
    (c.editing && !c.hasChanges) ||
    !context ||
    !editorEnabled ||
    c.busy ||
    c.loading ||
    c.contextLoading ||
    Boolean(c.replacementDocument) ||
    c.uploading ||
    unresolved ||
    !c.session?.canWrite ||
    !c.enabled;
  const renderDraftRecovery = () => {
    if (c.loading && (!draft || c.enabled)) return <LoadingState compact text="恢复草稿中" />;
    if (!c.enabled)
      return (
        <>
          <Text style={styles.text}>此网站已停用</Text>
          <AppButton label="管理内容来源" onPress={onManageSources} />
        </>
      );
    if (c.recoverInitialEditRead)
      return (
        <>
          <Text style={styles.text}>请完成验证后继续读取主帖</Text>
          <AppButton label="完成验证后继续" onPress={c.recoverInitialEditRead} disabled={editorObscured && c.busy} />
        </>
      );
    if (draft)
      return (
        <>
          <Text style={styles.error}>尚未完成草稿保存与切换，原草稿仍保留。</Text>
          <AppButton label="重试保存并恢复" onPress={() => c.retryDraft()} disabled={c.busy} />
        </>
      );
    const loggedIn = c.session?.isLoggedIn;
    return (
      <>
        <Text style={styles.text}>{loggedIn ? '草稿暂时无法读取' : '登录后创建和恢复你的草稿'}</Text>
        <AppButton
          label={loggedIn ? '重试读取草稿' : '登录当前网站'}
          onPress={() => {
            if (loggedIn) c.retryDraft();
            else if (c.source) onOpenAccount(c.source);
          }}
        />
      </>
    );
  };
  return (
    <NavigationBackdropProvider>
      <ComposerKeyboardHost
        testID="topic-keyboard-host"
        ref={keyboardHost}
        enabled={active && panel === null}
        trackImeInsets
        onImeInsets={onImeInsets}
        style={styles.root}
      >
        <Animated.View testID="create-topic-keyboard-viewport" style={[styles.root, keyboardStyle]}>
          {/* A Modal/picker owns a different window and can consume the Activity's final IME hide frame. */}
          {active && panel === null ? (
            <TopicComposerKeyboardObserver
              bottomInset={insets.bottom}
              publish={setKeyboard}
              pickerReady={pickerReady}
              onOpened={keyboardOpened}
            />
          ) : null}
          <SafeAreaView
            testID="create-topic-safe-area"
            style={[styles.root, { paddingTop: Math.max(insets.top, NativeStatusBar.currentHeight ?? 0) }]}
            edges={['bottom']}
            onLayout={onLayout}
          >
            <View style={styles.header}>
              <IconButton
                icon={ChevronLeft}
                iconSize={24}
                iconOnly
                ghost
                label="返回"
                onPress={onBack}
                disabled={c.busy}
              />
              {c.editing ? (
                <View style={styles.siteButton}>{siteIdentity}</View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="切换发帖网站"
                  accessibilityHint={
                    c.session?.currentUser?.username
                      ? `当前发布账号：${c.session.currentUser.username}`
                      : c.session?.statusLabel
                  }
                  accessibilityState={{ disabled: c.busy, expanded: panel === 'sites' }}
                  disabled={c.busy}
                  style={styles.siteButton}
                  onPress={() => openPanel('sites')}
                >
                  {siteIdentity}
                </Pressable>
              )}
              <AppButton
                backdrop={<NavigationGlass accent={!submitDisabled || c.busy} sampleBackdrop={false} />}
                minWidth={c.editing ? 84 : 68}
                label={c.editing ? '保存修改' : '发布'}
                style={{ minHeight: 48, justifyContent: 'center' }}
                loading={c.busy}
                variant="primary"
                disabled={submitDisabled}
                onPress={() => {
                  Keyboard.dismiss();
                  void c.submit();
                }}
              />
            </View>
            <View style={styles.flex} testID="composer-glass-content">
              {c.error ? (
                <View style={[styles.banner, styles.spread]}>
                  <Text accessibilityRole="alert" style={[styles.error, styles.flex]}>
                    {c.error}
                  </Text>
                  {c.editing && !c.busy ? (
                    <AppButton
                      compact
                      label="核对原站最新内容"
                      onPress={() => {
                        void c.reviewLatest().then((value) => {
                          if (value) openPanel('latest');
                        });
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
              {unresolved && !c.busy ? (
                <View style={styles.banner}>
                  <Text style={styles.error}>
                    {c.editing ? '上次保存结果尚未确认，请先到原站核对。' : '上次发布结果尚未确认，请先到原站核对。'}
                  </Text>
                  <View style={styles.row}>
                    <AppButton
                      label="到原站核对"
                      onPress={() => {
                        if (c.source) onOpenAccount(c.source);
                      }}
                    />
                    <AppButton
                      label={c.editing ? '已核对，未保存' : '已核对，未发布'}
                      onPress={() => void c.acknowledgeUnknown()}
                    />
                  </View>
                </View>
              ) : null}
              {!draft ? (
                <View style={styles.center}>{renderDraftRecovery()}</View>
              ) : (
                <View style={styles.flex}>
                  <View
                    style={styles.flex}
                    pointerEvents={editorObscured ? 'none' : 'auto'}
                    accessibilityElementsHidden={editorObscured}
                    importantForAccessibility={editorObscured ? 'no-hide-descendants' : 'auto'}
                  >
                    <ScrollView
                      overScrollMode="never"
                      style={[styles.metaViewport, metadataCollapsed && { maxHeight: 0 }]}
                      accessibilityElementsHidden={metadataCollapsed}
                      importantForAccessibility={metadataCollapsed ? 'no-hide-descendants' : 'auto'}
                      contentContainerStyle={[styles.meta, draft.source === 'yaohuo' && styles.yaohuoMeta]}
                      keyboardShouldPersistTaps="handled"
                    >
                      {!c.session?.canWrite ? (
                        <View style={styles.row}>
                          <Text style={styles.error}>请确认登录状态后发布</Text>
                          <AppButton label="检测登录" onPress={() => onOpenAccount(draft.source)} />
                        </View>
                      ) : null}
                      <ScrollView
                        overScrollMode="never"
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.metadataRow}
                        keyboardShouldPersistTaps="handled"
                      >
                        {!c.editing || draft.source === 'linuxdo' ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={rulesLoading ? '正在加载版块' : category?.name || '选择版块'}
                            accessibilityState={{
                              disabled: c.busy || !context || !allowed('categoryId'),
                              busy: rulesLoading
                            }}
                            disabled={c.busy || !context || !allowed('categoryId')}
                            style={[
                              styles.metadataControl,
                              (c.busy || !context || !allowed('categoryId')) && styles.disabled
                            ]}
                            onPress={() => {
                              if (allowed('categoryId')) openPanel('categories');
                            }}
                          >
                            <Text numberOfLines={1} style={styles.text}>
                              {rulesLoading ? '加载版块…' : category?.name || '选择版块'}
                            </Text>
                            {rulesLoading ? (
                              <ActivityIndicator size="small" color={theme.muted} />
                            ) : (
                              <ChevronDown size={14} color={theme.muted} />
                            )}
                          </Pressable>
                        ) : null}
                        {draft.source === 'linuxdo' ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={
                              rulesLoading
                                ? '正在加载标签规则'
                                : draft.tags.length
                                  ? `标签 ${draft.tags.length}`
                                  : '选择标签'
                            }
                            accessibilityHint={tagsHint}
                            accessibilityState={{
                              disabled: c.busy || !context || !allowed('tags'),
                              busy: rulesLoading
                            }}
                            disabled={c.busy || !context || !allowed('tags')}
                            style={[
                              styles.metadataControl,
                              (c.busy || !context || !allowed('tags')) && styles.disabled
                            ]}
                            onPress={() => {
                              if (allowed('tags')) openPanel('tags');
                            }}
                          >
                            <Text numberOfLines={1} style={draft.tags.length ? styles.text : styles.muted}>
                              {rulesLoading
                                ? '加载标签…'
                                : draft.tags.length
                                  ? `标签 ${draft.tags.length}`
                                  : tagsHint
                                    ? '选择标签 · 必填'
                                    : '选择标签'}
                            </Text>
                            {rulesLoading ? (
                              <ActivityIndicator size="small" color={theme.muted} />
                            ) : (
                              <ChevronDown size={14} color={theme.muted} />
                            )}
                          </Pressable>
                        ) : null}
                      </ScrollView>
                      {!c.editing &&
                      draft.source === 'nodeseek' &&
                      draft.categoryId === 'inside' &&
                      context?.source === 'nodeseek' ? (
                        <Text style={styles.muted}>内版发布费用：{context.insideFee} 鸡腿</Text>
                      ) : null}
                      <TextInput
                        ref={titleRef}
                        accessibilityLabel="帖子标题"
                        placeholder="标题"
                        placeholderTextColor={theme.muted}
                        value={draft.title}
                        onChangeText={(title) => c.change((value) => ({ ...value, title }))}
                        onFocus={() => setTitleEditing(true)}
                        onBlur={() => setTitleEditing(false)}
                        editable={titleEditable}
                        multiline
                        style={[styles.title, draft.source === 'yaohuo' && styles.yaohuoTitle]}
                      />
                      {c.errors.title ? <Text style={styles.error}>{c.errors.title}</Text> : null}
                      {[categoryError, rankError, tagsError].filter(Boolean).map((error) => (
                        <Text key={error} accessibilityLiveRegion="polite" style={styles.error}>
                          {error}
                        </Text>
                      ))}
                      {c.contextError ? (
                        <View style={styles.row}>
                          <Text style={styles.error}>{c.contextError}</Text>
                          {c.contextNeedsVerification ? (
                            <AppButton label="验证登录" disabled={c.busy} onPress={() => onOpenAccount(draft.source)} />
                          ) : null}
                          <AppButton
                            label="重试加载规则"
                            disabled={c.busy || c.contextLoading}
                            onPress={c.reloadContext}
                          />
                        </View>
                      ) : null}
                    </ScrollView>
                    <View style={styles.metadataBar}>
                      {metadataCollapsed ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="查看标题与标签"
                          accessibilityHint={draft.title || '查看标题、版块和标签'}
                          hitSlop={TOUCH_HIT_SLOP}
                          style={styles.metadataSummary}
                          onPress={() => {
                            if (!titleEditable) {
                              setTitleMetadataExpanded(true);
                              return;
                            }
                            setTitleEditing(true);
                            requestAnimationFrame(() => titleRef.current?.focus());
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={[draft.title.trim() ? styles.text : styles.muted, styles.flex]}
                          >
                            {draft.title.trim() || '标题'}
                          </Text>
                          <ChevronDown size={14} color={theme.muted} />
                        </Pressable>
                      ) : null}
                      {!c.editing || draft.source === 'nodeseek' || allowed('additionalReward') ? (
                        <Pressable
                          testID="composer-settings-trigger"
                          accessibilityRole="button"
                          accessibilityLabel="帖子设置"
                          accessibilityHint={settingsSummary}
                          accessibilityState={{ disabled: c.busy || !context, busy: rulesLoading }}
                          disabled={c.busy || !context}
                          hitSlop={TOUCH_HIT_SLOP}
                          style={[
                            styles.settingsControl,
                            metadataCollapsed && styles.settingsControlCompact,
                            (c.busy || !context) && styles.disabled
                          ]}
                          onPress={() => openPanel('options')}
                        >
                          <Text
                            numberOfLines={1}
                            style={[styles.text, styles.settingsLabel, !metadataCollapsed && styles.flex]}
                          >
                            {rulesLoading ? '读取规则中' : settingsSummary}
                          </Text>
                          <ChevronRight size={16} color={theme.muted} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        testID="composer-more-trigger"
                        accessibilityRole="button"
                        accessibilityLabel="附件与草稿"
                        accessibilityState={{ disabled: c.busy }}
                        disabled={c.busy}
                        accessibilityHint="管理图片、附件和本机草稿"
                        hitSlop={TOUCH_HIT_SLOP}
                        style={[
                          styles.settingsControl,
                          metadataCollapsed && styles.settingsControlCompact,
                          c.busy && styles.disabled
                        ]}
                        onPress={() => openPanel('more')}
                      >
                        <View style={[styles.attachmentLabelRow, !metadataCollapsed && styles.flex]}>
                          <Text numberOfLines={1} style={[styles.text, styles.settingsLabel]}>
                            附件与草稿
                          </Text>
                          {draft.attachments.length ? (
                            <Text style={styles.attachmentCount}>{draft.attachments.length}</Text>
                          ) : null}
                        </View>
                        <ChevronRight size={16} color={theme.muted} />
                      </Pressable>
                    </View>
                    {c.saveStatus.startsWith('保存失败') ? (
                      <View style={styles.saveLine}>
                        <Text accessibilityLiveRegion="polite" style={styles.error}>
                          {c.saveStatus}
                        </Text>
                        <AppButton
                          label="重试保存草稿"
                          compact
                          variant="ghost"
                          disabled={c.busy}
                          onPress={() => {
                            void c.flush().catch(() => undefined);
                          }}
                        />
                      </View>
                    ) : null}
                    {panel === null && insertionError ? (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {insertionError}
                      </Text>
                    ) : null}
                    {c.errors.body || (draft.source === 'nodeseek' && c.errors.poll) ? (
                      <Text accessibilityLiveRegion="polite" style={styles.error}>
                        {c.errors.body || c.errors.poll}
                      </Text>
                    ) : null}
                    <View style={styles.editor}>
                      {!editorEnabled && draft.source !== 'yaohuo' ? (
                        <View style={styles.center}>
                          <LoadingState compact text="准备正文中" />
                        </View>
                      ) : draft.source === 'yaohuo' ? (
                        <YaohuoReplyComposer
                          key={draft.id}
                          presentation="embedded"
                          dismissPanels={titleEditing || panel !== null}
                          faceMode="inline"
                          actionBusy={c.busy || !allowed('body')}
                          focusSignal={bodyFocusSignal}
                          content={draft.body}
                          inputAccessibilityLabel="帖子正文"
                          placeholder="写下正文…"
                          onContentChange={(body) => c.change((value) => ({ ...value, body }))}
                          onUploadImage={() => c.pickAttachments('image', true)}
                          awaitKeyboardSettled={awaitKeyboardSettled}
                          onPanelChange={changeEditorPanel}
                          onReturnToEditor={returnToEditor}
                        />
                      ) : (
                        <StructuredReplyComposer
                          key={draft.id}
                          ref={c.editorRef}
                          presentation="embedded"
                          dismissPanels={titleEditing || panel !== null}
                          footerActions={footerActions}
                          onTogglePreview={togglePreview}
                          onPanelChange={changeEditorPanel}
                          onReturnToEditor={returnToEditor}
                          actionBusy={c.busy}
                          visible={active && panel === null}
                          content={c.replacementDocument?.draft.body ?? draft.body}
                          initialMode={c.replacementDocument?.draft.mode ?? draft.mode}
                          readOnly={bodyReadOnly}
                          replacementDocument={c.replacementDocument}
                          focusSignal={bodyFocusSignal}
                          intent={
                            draft.edit
                              ? {
                                  kind: 'edit-topic',
                                  site: draft.source,
                                  topicId: draft.edit.topicId,
                                  draftId: draft.id
                                }
                              : { kind: 'create-topic', site: draft.source, draftId: draft.id }
                          }
                          pendingNodeSeekPolls={
                            c.replacementDocument?.draft.pendingNodeSeekPolls ?? draft.pendingNodeSeekPolls
                          }
                          nodeSeekMemberId={
                            draft.source === 'nodeseek' ? draft.identityKey.slice('nodeseek:'.length) : undefined
                          }
                          discourseEmojiUrls={c.emojiUrls}
                          onSnapshot={(snapshot) => c.acceptSnapshot(snapshot, draft.id)}
                          onUploadImage={() => c.pickAttachments('image', true)}
                          awaitKeyboardSettled={awaitKeyboardSettled}
                          onLoadLinuxDoPollCapabilities={async () => {
                            if (context?.source !== 'linuxdo') throw new Error('请先加载发帖设置');
                            return context.pollCapabilities;
                          }}
                          onLoadLinuxDoTemplates={c.editorServices.loadTemplates}
                          onUseLinuxDoTemplate={c.editorServices.useTemplate}
                          onResolveLinuxDoUpload={c.editorServices.resolveUpload}
                        />
                      )}
                    </View>
                  </View>
                  {editorObscured ? (
                    <View testID="draft-owner-overlay" style={[StyleSheet.absoluteFill, styles.root, styles.center]}>
                      {renderDraftRecovery()}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
            <ModalSheetFrame
              keyboardHostRef={modalKeyboardHost}
              visible={
                Boolean(panel) && (!routeFocus || routeFocus.isFocused()) && (!editorObscured || panel === 'sites')
              }
              backdropLabel="收起发帖面板"
              onRequestClose={panelAction(() => presentPanel(null))}
            >
              <ModalSheetHeader
                title={panel ? panelTitle[panel] : ''}
                subtitle={panel === 'more' && draft ? `${c.saveStatus} · ${draft.body.length} 字符` : undefined}
                closeLabel="关闭发帖选项"
                onClose={panelAction(() => presentPanel(null))}
              />
              {c.error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {c.error}
                </Text>
              ) : null}
              {panel === 'categories' || panel === 'tags' ? (
                <TopicSelectionPanel
                  mode={panel}
                  controller={c}
                  query={panel === 'categories' ? categoryQuery : tagQuery}
                  onQueryChange={panelAction(panel === 'categories' ? setCategoryQuery : setTagQuery)}
                  error={panel === 'categories' ? categoryError : tagsError}
                  hint={panel === 'tags' ? tagsHint : undefined}
                  tagSearch={tagSearch}
                  onChangeDraft={changePanelDraft}
                  onChangeCategory={panelAction(c.changeCategory)}
                  onRetryTags={panelAction(tagSearch.retry)}
                  onSelectCategory={() => openPanel('categories')}
                  onClose={panelAction(() => presentPanel(null))}
                />
              ) : (
                <ScrollView
                  overScrollMode="never"
                  key={panel}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.sheetBody}
                >
                  {insertionError ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {insertionError}
                    </Text>
                  ) : null}
                  {panel === 'latest' && c.editContext ? (
                    <View style={styles.section}>
                      <Text selectable style={styles.heading}>
                        {c.editContext.original.title}
                      </Text>
                      <Text selectable style={styles.text}>
                        {c.editContext.original.body}
                      </Text>
                      <Text selectable style={styles.muted}>
                        版块：{c.editContext.original.categoryId} · 标签：
                        {c.editContext.original.tags?.map((tag) => tag.name).join('、') || '无'} · 阅读权限：
                        {c.editContext.original.rank ?? '无'}
                      </Text>
                      <AppButton
                        label="保留本机修改继续"
                        disabled={unresolved || c.busy}
                        onPress={() => {
                          void rebaseAndClose();
                        }}
                      />
                    </View>
                  ) : null}
                  {panel === 'options' && c.editing && draft?.source === 'yaohuo' && allowed('additionalReward') ? (
                    <Field
                      label="追加悬赏妖晶（选填）"
                      numeric
                      disabled={c.busy}
                      value={draft.additionalReward || ''}
                      error={c.errors.additionalReward}
                      onChange={(additionalReward) => changePanelDraft((value) => ({ ...value, additionalReward }))}
                    />
                  ) : null}
                  {panel === 'sites'
                    ? (['nodeseek', 'linuxdo', 'yaohuo'] as const).map((site) => (
                        <Pressable
                          key={site}
                          accessibilityRole="button"
                          accessibilityLabel={`选择 ${sourceCatalog[site].label}`}
                          accessibilityState={{ selected: site === c.source, disabled: c.busy }}
                          disabled={c.busy}
                          style={[styles.option, styles.optionRow, site === c.source && styles.selected]}
                          onPress={panelAction(() => {
                            presentPanel(null);
                            void c.switchSource(site);
                          })}
                        >
                          <View style={styles.optionText}>
                            <Text style={[styles.text, site === c.source && styles.selectedText]}>
                              {sourceCatalog[site].label}
                              {c.draftSites[site] ? ' · 有草稿' : ''}
                            </Text>
                            <Text style={styles.muted}>
                              {!enabledSources.includes(site)
                                ? '已停用'
                                : sessions[site].currentUser?.username || sessions[site].statusLabel}
                            </Text>
                          </View>
                          <View style={styles.choiceIndicator}>
                            {site === c.source ? <Check size={20} color={theme.primary} /> : null}
                          </View>
                        </Pressable>
                      ))
                    : null}
                  {panel === 'more' && draft ? (
                    <>
                      {hasFilePanel ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={mediaLabel}
                          disabled={c.busy}
                          style={[styles.option, styles.optionRow]}
                          onPress={() => openPanel('attachments')}
                        >
                          <Paperclip size={20} color={theme.ink} />
                          <Text style={styles.text}>{mediaLabel}</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="图片上传记录"
                        accessibilityState={{ disabled: c.busy }}
                        disabled={c.busy}
                        style={[styles.option, styles.optionRow]}
                        onPress={() => openPanel('images')}
                      >
                        <ImagePlus size={20} color={theme.ink} />
                        <Text style={styles.text}>
                          图片上传记录{imageAttachments.length ? ` · ${imageAttachments.length}` : ''}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="丢弃草稿"
                        accessibilityState={{ disabled: c.busy || c.uploading }}
                        disabled={c.busy || c.uploading}
                        style={[styles.option, styles.optionRow]}
                        onPress={panelAction(() => {
                          presentPanel(null);
                          void c.discard();
                        })}
                      >
                        <Trash2 size={20} color={theme.danger} />
                        <Text style={[styles.text, { color: theme.danger }]}>丢弃当前草稿</Text>
                      </Pressable>
                    </>
                  ) : null}
                  {panel === 'options' && draft?.source === 'nodeseek' && context?.source === 'nodeseek' ? (
                    <>
                      <Text style={[styles.label, styles.sectionLabel]}>阅读权限</Text>
                      {rankError ? <Text style={styles.error}>{rankError}</Text> : null}
                      {context.ranks.map((rank) => (
                        <Pressable
                          key={rank}
                          accessibilityRole="radio"
                          accessibilityLabel={rank === 255 ? '私有' : rank ? `Lv${rank}` : '公开'}
                          accessibilityState={{ checked: draft.rank === rank, disabled: c.busy }}
                          disabled={c.busy}
                          style={[styles.option, styles.optionRow, draft.rank === rank && styles.selected]}
                          onPress={() =>
                            changePanelDraft((value) => (value.source === 'nodeseek' ? { ...value, rank } : value))
                          }
                        >
                          <Text style={[styles.text, styles.flex, draft.rank === rank && styles.selectedText]}>
                            {rank === 255 ? '私有' : rank ? `Lv${rank}` : '公开'}
                          </Text>
                          <View style={styles.choiceIndicator}>
                            {draft.rank === rank ? (
                              <CircleCheck size={20} color={theme.primary} />
                            ) : (
                              <Circle size={20} color={theme.muted} />
                            )}
                          </View>
                        </Pressable>
                      ))}
                      {!c.editing && draft.categoryId === 'inside' ? (
                        <Text style={styles.muted}>发布到内版将收取 {context.insideFee} 鸡腿</Text>
                      ) : null}
                    </>
                  ) : null}
                  {!c.editing && panel === 'options' && draft?.source === 'linuxdo' && context?.source === 'linuxdo' ? (
                    <>
                      <View style={styles.switchRow}>
                        <Text style={[styles.text, styles.flex]}>问答／帖子投票主题</Text>
                        <Switch
                          accessibilityLabel="问答／帖子投票主题"
                          disabled={c.busy || !context.postVotingEnabled || category?.onlyPostVoting}
                          value={draft.postVoting}

                          onValueChange={(postVoting) =>
                            changePanelDraft((value) => (value.source === 'linuxdo' ? { ...value, postVoting } : value))
                          }
                        />
                      </View>
                      {category?.onlyPostVoting ? <Text style={styles.muted}>此版块要求使用问答主题</Text> : null}
                      {!context.postVotingEnabled ? <Text style={styles.muted}>当前站点未开放问答主题</Text> : null}
                      {category?.template && draft.body !== category.template ? (
                        <AppButton
                          label="插入版块模板"
                          disabled={c.busy || preview}
                          onPress={() => void insertAndClose(category.template!)}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {!c.editing && panel === 'options' && draft?.source === 'yaohuo' && context?.source === 'yaohuo' ? (
                    <>
                      <Text style={[styles.label, styles.sectionLabel]}>帖子类型</Text>
                      <View style={styles.row}>
                        {context.kinds.map((kind) => (
                          <Pressable
                            key={kind}
                            accessibilityRole="radio"
                            accessibilityLabel={kindLabels[kind]}
                            accessibilityState={{ checked: draft.kind === kind, disabled: c.busy }}
                            disabled={c.busy}
                            style={[styles.chip, draft.kind === kind && styles.selectedChip]}
                            onPress={() => updateYaohuo((value) => ({ ...value, kind }))}
                          >
                            <Check size={16} color={draft.kind === kind ? theme.primary : 'transparent'} />
                            <Text style={[styles.text, draft.kind === kind && styles.selectedText]}>
                              {kindLabels[kind]}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.section}>
                        {draft.kind === 'normal' ? (
                          <Field
                            disabled={c.busy}
                            label="悬赏妖晶（选填，至少 1000）"
                            numeric
                            value={draft.reward}
                            error={c.errors.reward}
                            onChange={(reward) => updateYaohuo((value) => ({ ...value, reward }))}
                          />
                        ) : null}
                        {draft.kind === 'poll' ? (
                          <>
                            {c.errors.poll ? <Text style={styles.error}>{c.errors.poll}</Text> : null}
                            {draft.poll.options.map((option, index) => (
                              <View key={index} style={styles.row}>
                                <View style={styles.flex}>
                                  <Field
                                    disabled={c.busy}
                                    label={`投票选项 ${index + 1}（最多 15 字）`}
                                    value={option}
                                    onChange={(text) =>
                                      updateYaohuo((value) => ({
                                        ...value,
                                        poll: {
                                          ...value.poll,
                                          options: value.poll.options.map((old, at) => (at === index ? text : old))
                                        }
                                      }))
                                    }
                                  />
                                </View>
                                <IconButton
                                  icon={X}
                                  iconOnly
                                  label={`删除投票选项 ${index + 1}`}
                                  disabled={c.busy || draft.poll.options.length <= 2}
                                  onPress={() =>
                                    updateYaohuo((value) => ({
                                      ...value,
                                      poll: {
                                        ...value.poll,
                                        options: value.poll.options.filter((_, at) => at !== index)
                                      }
                                    }))
                                  }
                                />
                              </View>
                            ))}
                            <AppButton
                              label="添加投票选项"
                              disabled={c.busy || draft.poll.options.length >= 9}
                              onPress={() =>
                                updateYaohuo((value) => ({
                                  ...value,
                                  poll: { ...value.poll, options: [...value.poll.options, ''] }
                                }))
                              }
                            />
                            <View style={styles.spread}>
                              <Text style={styles.text}>投票派币</Text>
                              <Switch
                                accessibilityLabel="投票派币"
                                disabled={c.busy}
                                value={draft.poll.giftEnabled}
                                onValueChange={(giftEnabled) =>
                                  updateYaohuo((value) => ({ ...value, poll: { ...value.poll, giftEnabled } }))
                                }
                              />
                            </View>
                          </>
                        ) : null}
                        {draft.kind === 'gift' || (draft.kind === 'poll' && draft.poll.giftEnabled) ? (
                          <Fragment key={giftKind}>
                            <Field
                              disabled={c.busy}
                              label={`${giftKind === 'poll' ? '投票' : ''}派币总额（至少 2000）`}
                              numeric
                              value={draft[giftKind].total}
                              error={c.errors.gift}
                              onChange={(total) =>
                                updateYaohuo((value) => ({ ...value, [giftKind]: { ...value[giftKind], total } }))
                              }
                            />
                            <Field
                              disabled={c.busy}
                              label={`${giftKind === 'poll' ? '投票' : ''}每人妖晶（200–10000）`}
                              numeric
                              value={draft[giftKind].perPerson}
                              onChange={(perPerson) =>
                                updateYaohuo((value) => ({ ...value, [giftKind]: { ...value[giftKind], perPerson } }))
                              }
                            />
                          </Fragment>
                        ) : null}
                        {draft.kind === 'files' ? (
                          <>
                            <Text style={styles.muted}>选择 1–9 个文件，发布时一起上传。</Text>
                            <AppButton
                              label="管理文件"
                              disabled={c.busy || c.uploading}
                              onPress={panelAction(() => presentPanel('attachments'))}
                            />
                          </>
                        ) : null}
                        {draft.kind === 'resources' ? (
                          <>
                            {c.errors.resources ? <Text style={styles.error}>{c.errors.resources}</Text> : null}
                            {draft.resources.map((resource, index) => (
                              <View key={index} style={styles.section}>
                                <View style={styles.spread}>
                                  <Text style={styles.heading}>资源 {index + 1}</Text>
                                  <IconButton
                                    icon={X}
                                    iconOnly
                                    label={`删除资源 ${index + 1}`}
                                    disabled={c.busy || draft.resources.length <= 1}
                                    onPress={() =>
                                      updateYaohuo((value) => ({
                                        ...value,
                                        resources: value.resources.filter((_, at) => at !== index)
                                      }))
                                    }
                                  />
                                </View>
                                {(['title', 'url', 'size', 'extension', 'description'] as const).map((key) => (
                                  <Field
                                    disabled={c.busy}
                                    key={key}
                                    label={`资源 ${index + 1} ${{ title: '名称', url: '链接', size: '大小（选填）', extension: '后缀（选填）', description: '说明（选填）' }[key]}`}
                                    value={resource[key]}
                                    multiline={key === 'description'}
                                    onChange={(text) =>
                                      updateYaohuo((value) => ({
                                        ...value,
                                        resources: value.resources.map((row, at) =>
                                          at === index ? { ...row, [key]: text } : row
                                        )
                                      }))
                                    }
                                  />
                                ))}
                              </View>
                            ))}
                            <AppButton
                              label="添加资源"
                              disabled={c.busy || draft.resources.length >= 9}
                              onPress={() =>
                                updateYaohuo((value) => ({
                                  ...value,
                                  resources: [
                                    ...value.resources,
                                    { title: '', url: '', size: '', extension: '', description: '' }
                                  ]
                                }))
                              }
                            />
                          </>
                        ) : null}
                      </View>
                    </>
                  ) : null}
                  {(panel === 'attachments' || panel === 'images') && draft ? (
                    <>
                      {c.errors.attachments ? <Text style={styles.error}>{c.errors.attachments}</Text> : null}
                      {c.errors.attachments && imageAttachments.length && fileAttachments.length ? (
                        <AppButton
                          variant="ghost"
                          label={panel === 'images' ? `查看${mediaTitle}` : '查看图片记录'}
                          onPress={() => openPanel(panel === 'images' ? 'attachments' : 'images')}
                        />
                      ) : null}
                      {panel === 'attachments' ? (
                        <View style={styles.mediaPickers}>
                          {canPickFiles ? (
                            <AppButton
                              icon={Paperclip}
                              label="添加附件"
                              accessibilityLabel="选择附件"
                              style={styles.mediaPicker}
                              disabled={c.busy || c.uploading || preview || !allowed('body')}
                              onPress={() => void pickPanelAttachment('attachment')}
                            />
                          ) : null}
                          {draft.source === 'yaohuo' && draft.kind === 'files' ? (
                            <AppButton
                              icon={Paperclip}
                              label="添加文件"
                              accessibilityLabel="选择本地文件"
                              style={styles.mediaPicker}
                              disabled={c.busy || c.uploading || !context}
                              onPress={() => void pickPanelAttachment('yaohuo-file')}
                            />
                          ) : null}
                        </View>
                      ) : null}
                      {!context && panel === 'attachments' ? (
                        <Text style={styles.muted}>读取原站规则后即可选择文件。已保存的内容会继续保留。</Text>
                      ) : null}
                      {preview ? <Text style={styles.muted}>继续编辑后可添加文件或插入正文。</Text> : null}
                      {panel === 'attachments' && context?.source === 'linuxdo' && !canPickFiles ? (
                        <Text style={styles.muted}>当前账号和站点规则不支持普通附件。</Text>
                      ) : null}
                      {panel === 'attachments' && context?.source === 'linuxdo' && canPickFiles ? (
                        <Text style={styles.muted}>附件最多 {fileSize(context.maxAttachmentBytes)}</Text>
                      ) : null}
                      {!visibleAttachments.length ? (
                        <View style={styles.emptyMedia}>
                          {panel === 'images' ? (
                            <ImagePlus size={32} color={theme.muted} />
                          ) : (
                            <Paperclip size={32} color={theme.muted} />
                          )}
                          <Text style={styles.text}>
                            {panel === 'images' ? '还没有图片上传记录' : '还没有添加文件'}
                          </Text>
                        </View>
                      ) : null}
                      {visibleAttachments.map((file) => (
                        <View key={file.id} style={styles.section}>
                          <View style={styles.attachmentIdentity}>
                            <AttachmentThumbnail file={file} />
                            <View style={styles.attachmentInfo}>
                              <Text numberOfLines={2} style={styles.text}>
                                {file.name}
                              </Text>
                              <View style={styles.saveLine}>
                                {file.status === 'uploading' ? (
                                  <ActivityIndicator size="small" color={theme.primary} />
                                ) : null}
                                <Text
                                  accessibilityLiveRegion="polite"
                                  style={
                                    file.status === 'failed' || file.status === 'unknown' ? styles.error : styles.muted
                                  }
                                >
                                  {file.kind === 'yaohuo-file' ? '随帖文件' : file.kind === 'image' ? '图片' : '附件'} ·{' '}
                                  {fileSize(file.size)} ·{' '}
                                  {file.kind === 'yaohuo-file' && file.status === 'queued'
                                    ? '发布时上传'
                                    : {
                                        queued: '待上传',
                                        uploading: '上传中',
                                        uploaded: '已上传',
                                        failed: '上传失败',
                                        unknown: '上传结果待核对'
                                      }[file.status]}
                                </Text>
                              </View>
                              {file.description && descriptionFileId !== file.id ? (
                                <Text numberOfLines={2} style={styles.muted}>
                                  {file.description}
                                </Text>
                              ) : null}
                            </View>
                            <View style={styles.attachmentActions}>
                              {file.kind === 'yaohuo-file' ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`${descriptionFileId === file.id ? '收起说明' : file.description ? '编辑说明' : '添加说明'} ${file.name}`}
                                  accessibilityState={{ disabled: c.busy, expanded: descriptionFileId === file.id }}
                                  style={[styles.attachmentAction, c.busy && styles.disabled]}
                                  disabled={c.busy}
                                  onPress={panelAction(() =>
                                    setDescriptionFileId((current) => (current === file.id ? null : file.id))
                                  )}
                                >
                                  <Pencil size={20} color={theme.muted} />
                                </Pressable>
                              ) : null}
                              {file.kind !== 'yaohuo-file' && !['uploaded', 'uploading'].includes(file.status) ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`${file.status === 'failed' ? '重试上传' : file.status === 'unknown' ? '核对后重传' : '上传并插入'} ${file.name}`}
                                  accessibilityState={{
                                    disabled: c.busy || c.uploading || preview || !allowed('body')
                                  }}
                                  style={[
                                    styles.attachmentAction,
                                    (c.busy || c.uploading || preview || !allowed('body')) && styles.disabled
                                  ]}
                                  disabled={c.busy || c.uploading || preview || !allowed('body')}
                                  onPress={panelAction(() => c.uploadFiles([file]))}
                                >
                                  {file.status === 'queued' ? (
                                    <Upload size={20} color={theme.primary} />
                                  ) : (
                                    <RotateCw size={20} color={theme.primary} />
                                  )}
                                </Pressable>
                              ) : null}
                              {file.markup ? (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`插入正文 ${file.name}`}
                                  accessibilityState={{ disabled: c.busy || preview || !allowed('body') }}
                                  style={[
                                    styles.attachmentAction,
                                    (c.busy || preview || !allowed('body')) && styles.disabled
                                  ]}
                                  disabled={c.busy || preview || !allowed('body')}
                                  onPress={() => void insertAndClose(file.markup!)}
                                >
                                  <CornerDownLeft size={20} color={theme.primary} />
                                </Pressable>
                              ) : null}
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`移出草稿 ${file.name}`}
                                accessibilityState={{ disabled: c.busy || c.uploading }}
                                style={[styles.attachmentAction, (c.busy || c.uploading) && styles.disabled]}
                                disabled={c.busy || c.uploading}
                                onPress={panelAction(() => c.removeAttachment(file))}
                              >
                                <X size={20} color={theme.muted} />
                              </Pressable>
                            </View>
                          </View>
                          {file.error ? <Text style={styles.error}>{file.error}</Text> : null}
                          {file.kind === 'yaohuo-file' && descriptionFileId === file.id ? (
                            <View style={styles.attachmentDescription}>
                              <AppTextInput
                                accessibilityLabel={`${file.name} 文件说明`}
                                label="文件说明"
                                editable={!c.busy}
                                placeholder="文件说明（选填）"
                                placeholderTextColor={theme.muted}
                                multiline
                                value={file.description}
                                onChangeText={(description) =>
                                  changePanelDraft((value) => ({
                                    ...value,
                                    attachments: value.attachments.map((item) =>
                                      item.id === file.id ? { ...item, description } : item
                                    )
                                  }))
                                }
                              />
                            </View>
                          ) : null}
                        </View>
                      ))}
                      {visibleAttachments.length ? (
                        <Text style={styles.muted}>移出草稿不会删除已插入的正文链接，也不会删除网站上的文件。</Text>
                      ) : null}
                    </>
                  ) : null}
                </ScrollView>
              )}
            </ModalSheetFrame>
          </SafeAreaView>
        </Animated.View>
      </ComposerKeyboardHost>
    </NavigationBackdropProvider>
  );
}
