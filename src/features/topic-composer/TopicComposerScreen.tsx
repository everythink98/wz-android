import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  KeyboardState,
  useAnimatedKeyboard,
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
import type { ReaderSettings } from '@/domain/reader/readerData';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import type {
  TopicCreationSource,
  TopicDraft,
  TopicDraftAttachment,
  YaohuoTopicKind
} from '@/domain/forum/topicComposer';
import { validateTopicDraft, validateTopicEdit } from '@/domain/forum/topicComposer';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import { StructuredReplyComposer } from '@/ui/composer/StructuredReplyComposer';
import { YaohuoReplyComposer } from '@/ui/composer/YaohuoReplyComposer';
import { ComposerKeyboardHost, type ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useKeyboardHandoff } from '@/ui/hooks/useKeyboardHandoff';
import type { useTopicComposerController } from './useTopicComposerController';
import { TopicSelectionPanel } from './TopicSelectionPanel';
import { useTopicTagSearch } from './useTopicTagSearch';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const font = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.surface },
    header: {
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
      fontFamily: font,
      fontSize: Math.round(16 * settings.fontScale),
      lineHeight: Math.round(22 * settings.fontScale),
      includeFontPadding: false,
      fontWeight: '600',
      flexShrink: 1
    },
    text: {
      color: theme.ink,
      fontFamily: font,
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false,
      flexShrink: 1
    },
    muted: {
      color: theme.muted,
      fontFamily: font,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale),
      includeFontPadding: false,
      flexShrink: 1
    },
    error: { color: theme.danger, fontFamily: font, fontSize: Math.round(13 * settings.fontScale) },
    meta: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 4 },
    metaViewport: { maxHeight: '42%', flexGrow: 0, flexShrink: 1 },
    metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metadataBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line
    },
    settingsControl: {
      flex: 1,
      minWidth: 0,
      minHeight: 52,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 10,
      backgroundColor: theme.surface2
    },
    settingsLabel: { fontWeight: '500', fontSize: Math.round(13 * settings.fontScale) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    title: {
      color: theme.ink,
      fontFamily: font,
      fontSize: Math.round(22 * settings.fontScale),
      fontWeight: '600',
      paddingVertical: 6,
      paddingHorizontal: 0,
      minHeight: 48,
      maxHeight: 104,
      textAlignVertical: 'top'
    },
    input: {
      color: theme.ink,
      fontFamily: font,
      fontSize: Math.round(14 * settings.fontScale),
      minHeight: 48,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: 10,
      backgroundColor: theme.surface2,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    inputFocused: { borderColor: theme.primary },
    inputError: { borderColor: theme.danger },
    label: { color: theme.ink, fontFamily: font, fontSize: Math.round(13 * settings.fontScale), fontWeight: '500' },
    field: { gap: 6, marginBottom: 12 },
    editor: { flex: 1, minHeight: 120 },
    metadataSummary: {
      maxWidth: '24%',
      minWidth: 0,
      minHeight: 48,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
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
      minHeight: 48,
      paddingHorizontal: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 240,
      borderRadius: 10
    },
    tools: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    saveLine: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    thumbnail: { width: 56, height: 56, borderRadius: 8, backgroundColor: theme.surface2 },
    fileIcon: {
      width: 56,
      height: 56,
      borderRadius: 8,
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line
    },
    attachmentDescription: { paddingLeft: 68, gap: 4 },
    descriptionInput: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 0 },
    emptyMedia: { paddingVertical: 20, alignItems: 'center', gap: 6 },
    option: {
      minHeight: 48,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
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
    sheetHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 8
    },
    section: {
      gap: 8,
      paddingVertical: 12,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    sheetBody: { paddingBottom: 16, gap: 4 },
    chip: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
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
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        accessibilityState={{ disabled }}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        style={[styles.input, focused && styles.inputFocused, error && styles.inputError]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
  padding,
  pickerReady,
  onOpened
}: {
  bottomInset: number;
  padding: SharedValue<number>;
  pickerReady: SharedValue<boolean>;
  onOpened: () => void;
}) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true
  });
  useAnimatedReaction(
    () => Math.max(0, keyboard.height.value - bottomInset),
    (height) => padding.set(height)
  );
  useAnimatedReaction(
    () =>
      keyboard.height.value === 0 &&
      (keyboard.state.value === KeyboardState.CLOSED || keyboard.state.value === KeyboardState.UNKNOWN) &&
      padding.value === 0,
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
      padding.set(0);
      pickerReady.set(false);
    },
    [padding, pickerReady]
  );
  return null;
}

export function TopicComposerScreen({
  active = true,
  editorEnabled = true,
  controller: c,
  sessions,
  enabledSources,
  onBack,
  onOpenAccount,
  onManageSources
}: {
  active?: boolean;
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
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [editorPanelOpen, setEditorPanelOpen] = useState(false);
  const [editorFocusPending, setEditorFocusPending] = useState(false);
  const returnToEditor = useCallback(() => {
    if (editorPanelOpen || !keyboardShown) setEditorFocusPending(true);
  }, [editorPanelOpen, keyboardShown]);
  const keyboardOpened = useCallback(() => {
    setKeyboardShown(true);
    setEditorFocusPending(false);
  }, []);
  const changeEditorPanel = useCallback((open: boolean) => {
    setEditorPanelOpen(open);
    if (open) setEditorFocusPending(false);
  }, []);
  const keyboardPadding = useSharedValue(0);
  const pickerReady = useSharedValue(false);
  const keyboardHost = useRef<ComposerKeyboardHostHandle>(null);
  const modalKeyboardHost = useRef<ComposerKeyboardHostHandle>(null);
  // The Modal has its own window. Its native completion owns IME readiness;
  // reuse the handoff's UI-frame check without subscribing the Activity again.
  const modalPickerReady = useSharedValue(true);
  useAnimatedReaction(
    () => keyboardPadding.value > 0,
    (shown, previous) => {
      if (shown !== previous) runOnJS(setKeyboardShown)(shown);
    }
  );
  const keyboardStyle = useAnimatedStyle(() => ({ paddingBottom: keyboardPadding.value }));
  const metadataCollapsed = !titleEditing && (keyboardShown || editorPanelOpen || editorFocusPending);
  const [panel, setPanel] = useState<
    'sites' | 'more' | 'options' | 'categories' | 'tags' | 'attachments' | 'images' | 'latest' | null
  >(null);
  const panelOwner = useCommittedRef({ active, panel, busy: c.busy, draftId: c.draft?.id });
  const awaitKeyboardSettled = useKeyboardHandoff(pickerReady, active && panel === null, keyboardHost);
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
    !c.editing || c.editContext?.permissions[field] === true;
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
  const openPanel = async (next: typeof panel) => {
    if (c.busy) return;
    const draftId = c.draft?.id;
    setInsertionError('');
    try {
      await (panel === null ? awaitKeyboardSettled() : awaitModalKeyboardSettled());
      if (
        !panelOwner.current.active ||
        panelOwner.current.panel !== panel ||
        panelOwner.current.draftId !== draftId ||
        panelOwner.current.busy
      )
        return;
      if (next === 'attachments' || next === 'images') setPreview(false);
      if (next === 'categories') setCategoryQuery('');
      setPanel(next);
    } catch (cause) {
      if (
        panelOwner.current.active &&
        !panelOwner.current.busy &&
        panelOwner.current.panel === panel &&
        panelOwner.current.draftId === draftId
      )
        setInsertionError(cause instanceof Error ? cause.message : '键盘尚未收起，请重试');
    }
  };
  const pickPanelAttachment = async (kind: 'attachment' | 'yaohuo-file') => {
    const draftId = c.draft?.id;
    setInsertionError('');
    try {
      await awaitModalKeyboardSettled();
      if (
        !panelOwner.current.active ||
        panelOwner.current.panel !== panel ||
        panelOwner.current.draftId !== draftId ||
        panelOwner.current.busy
      )
        return;
      await c.pickAttachments(kind);
    } catch (cause) {
      if (
        panelOwner.current.active &&
        !panelOwner.current.busy &&
        panelOwner.current.panel === panel &&
        panelOwner.current.draftId === draftId
      )
        setInsertionError(cause instanceof Error ? cause.message : '选择附件失败，请重试');
    }
  };
  const updateYaohuo = (update: (value: Extract<TopicDraft, { source: 'yaohuo' }>) => TopicDraft) =>
    c.change((value) => (value.source === 'yaohuo' ? update(value) : value));
  const giftKind = draft?.source === 'yaohuo' && draft.kind === 'gift' ? 'gift' : 'poll';
  useEffect(() => {
    setPreview(false);
    setPanel(null);
    setTagQuery('');
    setInsertionError('');
    setDescriptionFileId(null);
    setEditorPanelOpen(false);
    setEditorFocusPending(false);
  }, [draft?.id]);
  useEffect(() => {
    if (c.uploading) setPanel((current) => (current === 'attachments' || current === 'images' ? null : current));
  }, [c.uploading]);
  useEffect(() => {
    if (editorObscured) return;
    if (c.errors.title) titleRef.current?.focus();
    else if (c.errors.categoryId) setPanel('categories');
    else if (c.errors.tags) setPanel('tags');
    else if (c.errors.attachments) setPanel(attachmentErrorPanel.current);
    else if (c.errors.body || (draft?.source === 'nodeseek' && c.errors.poll)) {
      setPreview(false);
      setBodyFocusSignal((value) => value + 1);
    } else if (c.errors.rank || c.errors.reward || c.errors.gift || c.errors.poll || c.errors.resources)
      setPanel('options');
  }, [attachmentErrorPanel, c.errors, draft?.source, editorObscured]);
  const insertAndClose = async (markup: string) => {
    if (c.busy || preview) return;
    setInsertionError('');
    try {
      await c.insertMarkup(markup);
      setPanel(null);
    } catch (error) {
      setInsertionError(error instanceof Error ? error.message : '插入失败，请重试');
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
  return (
    <ComposerKeyboardHost
      testID="topic-keyboard-host"
      ref={keyboardHost}
      enabled={active && panel === null}
      style={styles.root}
    >
      <Animated.View testID="create-topic-keyboard-viewport" style={[styles.root, keyboardStyle]}>
        {/* A Modal/picker owns a different window and can consume the Activity's final IME hide frame. */}
        {active && panel === null ? (
          <TopicComposerKeyboardObserver
            bottomInset={insets.bottom}
            padding={keyboardPadding}
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
            <IconButton icon={ChevronLeft} iconOnly label="返回" onPress={onBack} disabled={c.busy} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={c.editing ? '编辑帖子' : '切换发帖网站'}
              accessibilityHint={
                c.session?.currentUser?.username
                  ? `当前发布账号：${c.session.currentUser.username}`
                  : c.session?.statusLabel
              }
              disabled={c.busy || c.editing}
              style={styles.siteButton}
              onPress={() => openPanel('sites')}
            >
              <View style={styles.siteIdentity}>
                <View style={styles.siteName}>
                  <Text numberOfLines={1} style={styles.heading}>
                    {c.source ? sourceCatalog[c.source].label : '发帖'}
                  </Text>
                  {!c.editing ? <ChevronDown color={theme.ink} size={15} /> : null}
                </View>
                <Text numberOfLines={1} style={styles.muted}>
                  {c.session?.currentUser?.username || c.session?.statusLabel || '选择发帖账号'}
                  {draft ? ` · ${c.uploading ? '上传中…' : c.saveStatus}` : ''}
                </Text>
              </View>
            </Pressable>
            <AppButton
              label={c.editing ? (c.busy ? '保存中…' : '保存修改') : c.busy ? '发布中…' : '发布'}
              accessibilityLabel={c.editing ? '保存修改' : '发布'}
              variant="primary"
              disabled={
                !draft ||
                (c.editing && !c.hasChanges) ||
                !context ||
                !editorEnabled ||
                c.busy ||
                c.loading ||
                c.contextLoading ||
                c.uploading ||
                unresolved ||
                !c.session?.canWrite ||
                !c.enabled
              }
              onPress={() => {
                Keyboard.dismiss();
                void c.submit();
              }}
            />
          </View>
          {c.error ? (
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {c.error}
              </Text>
            </View>
          ) : null}
          {c.editing && c.error && !c.busy ? (
            <View style={styles.banner}>
              <AppButton
                label="核对原站最新内容"
                onPress={() => {
                  void c.reviewLatest().then((value) => {
                    if (value) openPanel('latest');
                  });
                }}
              />
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
          {c.loading && !draft ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.muted}>正在恢复草稿…</Text>
            </View>
          ) : !c.enabled && !draft ? (
            <View style={styles.center}>
              <Text style={styles.text}>此网站已停用</Text>
              <AppButton label="管理内容来源" onPress={onManageSources} />
            </View>
          ) : !draft ? (
            <View style={styles.center}>
              <Text style={styles.text}>{c.session?.isLoggedIn ? '草稿暂时无法读取' : '登录后创建和恢复你的草稿'}</Text>
              <AppButton
                label={c.session?.isLoggedIn ? '重试读取草稿' : '登录当前网站'}
                onPress={() => (c.session?.isLoggedIn ? c.retryDraft() : c.source && onOpenAccount(c.source))}
              />
            </View>
          ) : (
            <View style={styles.flex}>
              <View
                style={styles.flex}
                pointerEvents={editorObscured ? 'none' : 'auto'}
                accessibilityElementsHidden={editorObscured}
                importantForAccessibility={editorObscured ? 'no-hide-descendants' : 'auto'}
              >
                <ScrollView
                  style={[styles.metaViewport, metadataCollapsed && { maxHeight: 0 }]}
                  accessibilityElementsHidden={metadataCollapsed}
                  importantForAccessibility={metadataCollapsed ? 'no-hide-descendants' : 'auto'}
                  contentContainerStyle={styles.meta}
                  keyboardShouldPersistTaps="handled"
                >
                  {!c.session?.canWrite ? (
                    <View style={styles.row}>
                      <Text style={styles.error}>请确认登录状态后发布</Text>
                      <AppButton label="检测登录" onPress={() => onOpenAccount(draft.source)} />
                    </View>
                  ) : null}
                  <ScrollView
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
                        accessibilityState={{ disabled: c.busy || !context || !allowed('tags'), busy: rulesLoading }}
                        disabled={c.busy || !context || !allowed('tags')}
                        style={[styles.metadataControl, (c.busy || !context || !allowed('tags')) && styles.disabled]}
                        onPress={() => {
                          if (allowed('tags')) openPanel('tags');
                        }}
                      >
                        <Text numberOfLines={1} style={styles.muted}>
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
                    editable={!c.busy && allowed('title')}
                    multiline
                    style={styles.title}
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
                      <AppButton label="重试加载规则" disabled={c.busy || c.contextLoading} onPress={c.reloadContext} />
                    </View>
                  ) : null}
                </ScrollView>
                <View style={styles.metadataBar}>
                  {metadataCollapsed ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="查看标题与标签"
                      accessibilityHint={draft.title || '查看标题、版块和标签'}
                      style={styles.metadataSummary}
                      onPress={() => {
                        setTitleEditing(true);
                        requestAnimationFrame(() => titleRef.current?.focus());
                      }}
                    >
                      <Text style={styles.muted}>标题</Text>
                      <ChevronDown size={14} color={theme.muted} />
                    </Pressable>
                  ) : null}
                  {!c.editing || draft.source === 'nodeseek' || allowed('additionalReward') ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="帖子设置"
                      accessibilityHint={settingsSummary}
                      accessibilityState={{ disabled: c.busy || !context, busy: rulesLoading }}
                      disabled={c.busy || !context}
                      style={[styles.settingsControl, (c.busy || !context) && styles.disabled]}
                      onPress={() => openPanel('options')}
                    >
                      <View style={styles.flex}>
                        <Text style={[styles.text, styles.settingsLabel]}>帖子设置</Text>
                        <Text numberOfLines={1} style={styles.muted}>
                          {rulesLoading ? '加载规则…' : settingsSummary}
                        </Text>
                      </View>
                      <ChevronRight size={16} color={theme.muted} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="附件与草稿"
                    accessibilityState={{ disabled: c.busy }}
                    disabled={c.busy}
                    style={[styles.settingsControl, c.busy && styles.disabled]}
                    onPress={() => openPanel('more')}
                  >
                    <View style={styles.flex}>
                      <Text style={[styles.text, styles.settingsLabel]}>附件与草稿</Text>
                      <Text numberOfLines={1} style={styles.muted}>
                        {draft.attachments.length ? draft.attachments.length + ' 个附件 · 管理' : '上传与草稿管理'}
                      </Text>
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
                    <View style={styles.center} accessibilityLiveRegion="polite">
                      <ActivityIndicator color={theme.primary} />
                      <Text style={styles.muted}>正在准备正文…</Text>
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
                      content={draft.body}
                      initialMode={draft.mode}
                      readOnly={bodyReadOnly}
                      focusSignal={bodyFocusSignal}
                      intent={
                        draft.edit
                          ? { kind: 'edit-topic', site: draft.source, topicId: draft.edit.topicId, draftId: draft.id }
                          : { kind: 'create-topic', site: draft.source, draftId: draft.id }
                      }
                      pendingNodeSeekPolls={draft.pendingNodeSeekPolls}
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
                  {c.enabled && c.loading ? (
                    <>
                      <ActivityIndicator color={theme.primary} />
                      <Text style={styles.muted}>正在恢复草稿…</Text>
                    </>
                  ) : c.enabled ? (
                    <>
                      <Text style={styles.error}>尚未完成草稿保存与切换，原草稿仍保留。</Text>
                      <AppButton label="重试保存并恢复" onPress={c.retryDraft} disabled={c.busy} />
                    </>
                  ) : (
                    <>
                      <Text style={styles.text}>此网站已停用</Text>
                      <AppButton label="管理内容来源" onPress={onManageSources} />
                    </>
                  )}
                </View>
              ) : null}
            </View>
          )}
          <ModalSheetFrame
            keyboardHostRef={modalKeyboardHost}
            visible={Boolean(panel) && (!editorObscured || panel === 'sites')}
            backdropLabel="收起发帖面板"
            onRequestClose={() => setPanel(null)}
          >
            <View style={styles.sheetHeading}>
              <Text style={styles.heading}>{panel ? panelTitle[panel] : ''}</Text>
              <IconButton icon={X} iconOnly label="关闭发帖选项" onPress={() => setPanel(null)} />
            </View>
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
                onQueryChange={panel === 'categories' ? setCategoryQuery : setTagQuery}
                error={panel === 'categories' ? categoryError : tagsError}
                hint={panel === 'tags' ? tagsHint : undefined}
                tagSearch={tagSearch}
                onSelectCategory={() => openPanel('categories')}
                onClose={() => setPanel(null)}
              />
            ) : (
              <ScrollView key={panel} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
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
                        void c.rebaseEdit().then(() => setPanel(null));
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
                    onChange={(additionalReward) => c.change((value) => ({ ...value, additionalReward }))}
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
                        onPress={() => {
                          setPanel(null);
                          void c.switchSource(site);
                        }}
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
                    <Text style={styles.muted}>
                      {c.saveStatus} · {draft.body.length} 字符
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="图片上传记录"
                      accessibilityState={{ disabled: c.busy }}
                      disabled={c.busy}
                      style={[styles.option, styles.optionRow]}
                      onPress={() => openPanel('images')}
                    >
                      <ImagePlus size={20} color={theme.ink} />
                      <View style={styles.optionText}>
                        <Text style={styles.text}>
                          图片上传记录{imageAttachments.length ? ` · ${imageAttachments.length}` : ''}
                        </Text>
                        <Text style={styles.muted}>核对上传、重试或再次插入正文</Text>
                      </View>
                    </Pressable>
                    <View style={styles.section}>
                      <Text style={styles.muted}>
                        {c.editing
                          ? '编辑草稿按网站、账号和帖子分别保存。返回时保留当前内容。'
                          : '草稿按网站和账号分别保存。返回或切换网站时保留当前内容。'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="丢弃草稿"
                      accessibilityState={{ disabled: c.busy || c.uploading }}
                      disabled={c.busy || c.uploading}
                      style={[styles.option, styles.optionRow]}
                      onPress={() => {
                        setPanel(null);
                        void c.discard();
                      }}
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
                        onPress={() => c.change((value) => (value.source === 'nodeseek' ? { ...value, rank } : value))}
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
                        trackColor={{ false: theme.line, true: theme.primarySoft }}
                        thumbColor={draft.postVoting ? theme.primary : theme.muted}
                        onValueChange={(postVoting) =>
                          c.change((value) => (value.source === 'linuxdo' ? { ...value, postVoting } : value))
                        }
                      />
                    </View>
                    {category?.onlyPostVoting ? <Text style={styles.muted}>此版块要求使用问答主题</Text> : null}
                    {!context.postVotingEnabled ? <Text style={styles.muted}>当前站点未开放问答主题</Text> : null}
                    <Text style={styles.muted}>正文中的投票可通过编辑器工具栏插入。</Text>
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
                            onPress={() => setPanel('attachments')}
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
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="选择附件"
                            accessibilityState={{ disabled: c.busy || c.uploading || preview }}
                            style={[styles.mediaPicker, (c.busy || c.uploading || preview) && styles.disabled]}
                            disabled={c.busy || c.uploading || preview}
                            onPress={() => void pickPanelAttachment('attachment')}
                          >
                            <Paperclip size={21} color={theme.ink} />
                            <Text style={styles.text}>添加附件</Text>
                          </Pressable>
                        ) : null}
                        {draft.source === 'yaohuo' && draft.kind === 'files' ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="选择本地文件"
                            accessibilityState={{ disabled: c.busy || c.uploading || !context }}
                            style={[styles.mediaPicker, (c.busy || c.uploading || !context) && styles.disabled]}
                            disabled={c.busy || c.uploading || !context}
                            onPress={() => void pickPanelAttachment('yaohuo-file')}
                          >
                            <Paperclip size={21} color={theme.ink} />
                            <Text style={styles.text}>添加文件</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={styles.muted}>
                      {panel === 'images'
                        ? '从正文工具栏插入图片；这里保留上传记录。'
                        : draft.source === 'linuxdo'
                          ? '文件上传到 linux.do，以链接插入正文。'
                          : '选择 1–9 个随帖文件，发布时上传。'}
                    </Text>
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
                        <Text style={styles.text}>{panel === 'images' ? '还没有图片上传记录' : '还没有添加文件'}</Text>
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
                                onPress={() =>
                                  setDescriptionFileId((current) => (current === file.id ? null : file.id))
                                }
                              >
                                <Pencil size={20} color={theme.muted} />
                              </Pressable>
                            ) : null}
                            {file.kind !== 'yaohuo-file' && !['uploaded', 'uploading'].includes(file.status) ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${file.status === 'failed' ? '重试上传' : file.status === 'unknown' ? '核对后重传' : '上传并插入'} ${file.name}`}
                                accessibilityState={{ disabled: c.busy || c.uploading || preview }}
                                style={[styles.attachmentAction, (c.busy || c.uploading || preview) && styles.disabled]}
                                disabled={c.busy || c.uploading || preview}
                                onPress={() => void c.uploadFiles([file])}
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
                                accessibilityState={{ disabled: c.busy || preview }}
                                style={[styles.attachmentAction, (c.busy || preview) && styles.disabled]}
                                disabled={c.busy || preview}
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
                              onPress={() => void c.removeAttachment(file)}
                            >
                              <X size={20} color={theme.muted} />
                            </Pressable>
                          </View>
                        </View>
                        {file.error ? <Text style={styles.error}>{file.error}</Text> : null}
                        {file.kind === 'yaohuo-file' && descriptionFileId === file.id ? (
                          <View style={styles.attachmentDescription}>
                            <TextInput
                              accessibilityLabel={`${file.name} 文件说明`}
                              editable={!c.busy}
                              placeholder="文件说明（选填）"
                              placeholderTextColor={theme.muted}
                              multiline
                              style={[styles.text, styles.descriptionInput]}
                              value={file.description}
                              onChangeText={(description) =>
                                c.change((value) => ({
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
  );
}
