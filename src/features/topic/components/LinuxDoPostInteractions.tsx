import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type ComponentRef
} from 'react';
import {
  FlatList,
  Keyboard,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type LayoutRectangle
} from 'react-native';
import { AppTextInput as TextInput } from '@/ui/controls/InputControls';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useFlashListContext, useLayoutState } from '@shopify/flash-list';
import { ChevronDown, Rocket, Smile, X } from 'lucide-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { DiscourseBoost, Reply, TopicDetail, UserReference } from '@/domain/forum/models';
import { discourseBoostStats } from '@/domain/forum/discourseInteractions';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { PopupMenu } from '@/ui/controls/PopupMenu';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { Avatar } from '@/ui/avatar/Avatar';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  readerRadii,
  alphaColor,
  fontFamilyValue,
  type ReaderStyleSettings,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { DetailActionButton } from './TopicActionBar';

type Post = Reply | TopicDetail;
type InteractionContext = Pick<
  TopicActionsController,
  'decisionFor' | 'reactToPost' | 'openBoostComposer' | 'deleteBoost'
> & {
  emojiUrls: DiscourseEmojiUrlMap;
  openReactions: (postId: number, event?: GestureResponderEvent) => void;
  openUser: (user: UserReference) => void;
  overlayOpen: boolean;
  expandedBoosts: ReadonlySet<number>;
  expandBoosts: (postId: number) => void;
};
const Context = createContext<InteractionContext | null>(null);
export function useLinuxDoInteractionOverlayOpen() {
  return useContext(Context)?.overlayOpen || false;
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = Math.round(14 * settings.fontScale);
  return StyleSheet.create({
    bubbles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6, flexShrink: 0 },
    boostViewport: { overflow: 'hidden' },
    boostFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    expandBoosts: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    bubble: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 32,
      paddingLeft: 4,
      paddingRight: 8,
      paddingVertical: 3,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      maxWidth: '100%',
      backgroundColor: theme.surface2
    },
    content: {
      color: theme.ink,
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale),
      includeFontPadding: false,
      fontFamily: fontFamilyValue(settings.fontFamily),
      flexShrink: 1
    },
    bubbleAvatar: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    bubbleContent: { flexShrink: 1, justifyContent: 'center', minHeight: 24 },
    rocket: {
      width: 32,
      height: 32,
      borderRadius: readerRadii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      alignItems: 'center',
      justifyContent: 'center'
    },
    picker: { padding: 10, gap: 8 },
    title: {
      fontSize: Math.round(16 * settings.fontScale),
      lineHeight: Math.round(22 * settings.fontScale),
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontWeight: '600'
    },
    muted: {
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(18 * settings.fontScale),
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily)
    },
    choices: { flexDirection: 'row', flexWrap: 'wrap' },
    choice: {
      width: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: readerRadii.control
    },
    selected: { backgroundColor: alphaColor(theme.primary, theme.dark ? 0.25 : 0.12) },
    choiceLabel: {
      fontSize: Math.round(11 * settings.fontScale),
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      textAlign: 'center'
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { flex: 1, minWidth: 0, gap: 4 },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: readerRadii.sheet,
      borderTopRightRadius: readerRadii.sheet
    },
    sheetLayer: { zIndex: 30, elevation: 30 },
    sheetContent: { gap: 12, paddingHorizontal: 16, paddingTop: 9 },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: readerRadii.pill,
      backgroundColor: theme.lineStrong
    },
    composer: { flexShrink: 1, gap: 16, paddingTop: 4 },
    emojiPicker: { flexShrink: 1, gap: 8 },
    input: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(16 * settings.fontScale),
      backgroundColor: theme.surface2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: readerRadii.control,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 56
    },
    searchInput: { minHeight: 48, paddingVertical: 8, fontSize },
    catalog: { maxHeight: 208 },
    catalogChoice: { width: '16.666666%', minHeight: 48, borderRadius: readerRadii.control, padding: 4 },
    error: {
      color: theme.danger,
      fontSize,
      lineHeight: Math.round(20 * settings.fontScale),
      fontFamily: fontFamilyValue(settings.fontFamily)
    },
    footer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      paddingTop: 12
    }
  });
}

function EmojiImage({ url, label, size = 22 }: { url: string; label: string; size?: number }) {
  const mediaContext = useForumMediaRequestContext('linuxdo');
  return (
    <ExpoImage
      accessibilityLabel={label}
      source={imageSourceFromUrl(url, { mediaContext })}
      recyclingKey={`${mediaContext.sessionIdentity}:${url}`}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}

export function LinuxDoReactionButton({
  post,
  onPress,
  ...props
}: Omit<ComponentProps<typeof DetailActionButton>, 'onPress'> & { post: Post; onPress: () => void }) {
  const context = useContext(Context);
  const selected = post.currentUserReaction;
  const unknown = post.siteExtension?.interactionUnconfirmed === true;
  const imageUrl = selected && context?.emojiUrls[selected.id];
  return (
    <DetailActionButton
      {...props}
      active={Boolean(selected || post.liked)}
      accessibilityLabel={unknown ? '核对反应结果' : selected ? `取消反应 ${selected.id}` : props.accessibilityLabel}
      disabled={unknown ? false : props.disabled}
      iconContent={imageUrl ? <EmojiImage url={imageUrl} label={selected.id} size={18} /> : undefined}
      onPress={context && post.commentId ? () => void context.reactToPost(post.commentId!) : onPress}
      onLongPress={context && post.commentId ? (event) => context.openReactions(post.commentId!, event) : undefined}
    />
  );
}

function BoostBubble({
  boost,
  postId,
  hidden,
  onLayout
}: {
  boost: DiscourseBoost;
  postId: number;
  hidden: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const context = useContext(Context);
  const { styles, settings } = useReaderThemeStyles(createStyles);
  const label = boost.content.map((part) => ('text' in part ? part.text : part.emoji)).join('');
  return (
    <View
      style={styles.bubble}
      testID={`post-boost-${postId}-${boost.id}`}
      onLayout={onLayout}
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看 ${boost.user.displayName || boost.user.username} 的资料`}
        onPress={() => context?.openUser(boost.user)}
        hitSlop={8}
        style={styles.bubbleAvatar}
      >
        <Avatar
          contentSource="linuxdo"
          name={boost.user.displayName || boost.user.username}
          uri={boost.user.avatar}
          tiny
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`加电 ${label}`}
        accessibilityHint={boost.canDelete ? '长按删除这条加电' : undefined}
        style={styles.bubbleContent}
        accessibilityActions={boost.canDelete ? [{ name: 'longpress', label: '删除加电' }] : undefined}
        onAccessibilityAction={boost.canDelete && context ? () => context.deleteBoost(postId, boost.id) : undefined}
        onLongPress={boost.canDelete && context ? () => context.deleteBoost(postId, boost.id) : undefined}
      >
        <Text style={styles.content}>
          {boost.content.map((part, index) =>
            'text' in part ? (
              <Text key={index}>
                {part.text.split(/(:[a-z0-9_+-]+(?::t\d)?:)/g).map((text, tokenIndex) => {
                  const name = text.slice(1, -1);
                  const imageUrl =
                    tokenIndex % 2 === 1 && context && Object.hasOwn(context.emojiUrls, name)
                      ? context.emojiUrls[name]
                      : undefined;
                  return imageUrl ? (
                    <EmojiImage
                      key={tokenIndex}
                      url={imageUrl}
                      label={text}
                      size={Math.round(16 * settings.fontScale)}
                    />
                  ) : (
                    text
                  );
                })}
              </Text>
            ) : (
              <EmojiImage
                key={index}
                url={part.imageUrl}
                label={part.emoji}
                size={Math.round(16 * settings.fontScale)}
              />
            )
          )}
        </Text>
      </Pressable>
    </View>
  );
}

export function LinuxDoBoosts({ post }: { post: Post }) {
  const context = useContext(Context);
  const listContext = useFlashListContext();
  const reduceMotion = useReducedMotion();
  const { styles, theme, settings } = useReaderThemeStyles(createStyles);
  const boosts = post.siteExtension?.boosts || [];
  const postId = post.commentId;
  const [layout, setLayout] = useState<{
    postId: number | undefined;
    boxes: Record<number, LayoutRectangle>;
    width: number;
    height: number;
  }>({ postId, boxes: {}, width: 0, height: 0 });
  const [transition, setTransition] = useLayoutState<{
    postId: number;
    from: number;
    to: number;
    progress: number;
  } | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const updateProgress = useLatestCallback((value: number) => {
    setTransition((current) => (current ? { ...current, progress: value } : current));
  });
  useEffect(() => {
    const listener = progress.addListener(({ value }) => updateProgress(value));
    return () => {
      animation.current?.stop();
      progress.removeListener(listener);
    };
  }, [progress, updateProgress]);
  useEffect(() => () => animation.current?.stop(), [postId]);
  if (layout.postId !== postId) {
    setLayout({ postId, boxes: {}, width: 0, height: 0 });
    setTransition(null, true);
  }
  if (!boosts.length || !post.commentId) return null;
  const expanded = context?.expandedBoosts.has(post.commentId) === true;
  const expanding = expanded && transition?.postId === postId ? transition : null;
  const measured = layout.postId === postId && layout.width > 0 && boosts.every((boost) => layout.boxes[boost.id]);
  const rowTops = measured
    ? [...new Set(boosts.map((boost) => Math.round(layout.boxes[boost.id].y)))].sort((a, b) => a - b)
    : [];
  const fifthRow = rowTops[4];
  const collapsed = !expanded && fifthRow !== undefined;
  const allowed = context?.decisionFor({ action: 'boost', target: post }).allowed;
  const actionsWidth = allowed ? 80 : 40;
  const previewBoxes =
    fifthRow === undefined
      ? []
      : boosts.map((boost) => layout.boxes[boost.id]).filter((box) => Math.round(box.y) < fifthRow);
  const lastRow = previewBoxes.filter((box) => Math.round(box.y) === rowTops[3]);
  const lastRowTop = Math.min(...lastRow.map((box) => box.y));
  const lastRowBottom = Math.max(...lastRow.map((box) => box.y + box.height));
  const actionsLeft = Math.max(...lastRow.map((box) => box.x + box.width)) + 6;
  const inlineActions =
    lastRow.length > 0 && actionsLeft + actionsWidth <= layout.width
      ? { left: actionsLeft, top: Math.max(0, (lastRowTop + lastRowBottom - 40) / 2) }
      : null;
  const previewHeight = collapsed
    ? Math.max(...previewBoxes.map((box) => box.y + box.height), inlineActions ? inlineActions.top + 40 : 0)
    : !expanded && !measured
      ? Math.min(4, boosts.length) * (Math.max(32, Math.round(18 * settings.fontScale) + 6) + 6) - 6
      : undefined;
  const rocket = (hidden = false) =>
    allowed ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="添加加电"
        style={styles.rocket}
        hitSlop={8}
        pointerEvents={hidden ? 'none' : 'auto'}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        onPress={() => context?.openBoostComposer(post.commentId!)}
      >
        <Rocket size={16} color={theme.muted} />
      </Pressable>
    ) : null;
  return (
    <View testID={`post-boosts-${post.commentId}`}>
      <View
        style={[
          styles.boostViewport,
          expanding
            ? { height: expanding.from + (expanding.to - expanding.from) * expanding.progress }
            : { maxHeight: previewHeight }
        ]}
        testID={`post-boost-viewport-${post.commentId}`}
      >
        <View
          style={styles.bubbles}
          onLayout={({ nativeEvent: { layout: box } }) =>
            setLayout((current) =>
              current.postId !== postId || (current.height === box.height && current.width === box.width)
                ? current
                : { ...current, height: box.height, width: box.width }
            )
          }
        >
          {boosts.map((boost) => (
            <BoostBubble
              key={boost.id}
              boost={boost}
              postId={post.commentId!}
              hidden={collapsed && Math.round(layout.boxes[boost.id].y) >= fifthRow}
              onLayout={({ nativeEvent: { layout: box } }) =>
                setLayout((current) => {
                  if (current.postId !== postId) return current;
                  const previous = current.boxes[boost.id];
                  if (
                    previous?.x === box.x &&
                    previous.y === box.y &&
                    previous.width === box.width &&
                    previous.height === box.height
                  )
                    return current;
                  return { ...current, boxes: { ...current.boxes, [boost.id]: box } };
                })
              }
            />
          ))}
          {rocket(collapsed)}
        </View>
      </View>
      {collapsed || expanding ? (
        <View
          testID={`post-boost-actions-${post.commentId}`}
          style={[
            styles.boostFooter,
            inlineActions && { position: 'absolute', ...inlineActions, width: actionsWidth, height: 40, marginTop: 0 },
            expanding && {
              ...(!inlineActions && { height: 40 * (1 - expanding.progress), marginTop: 6 * (1 - expanding.progress) }),
              opacity: 1 - expanding.progress,
              overflow: 'hidden'
            }
          ]}
          pointerEvents={expanding ? 'none' : 'auto'}
          accessibilityElementsHidden={Boolean(expanding)}
          importantForAccessibility={expanding ? 'no-hide-descendants' : 'auto'}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`查看全部 ${boosts.length} 条加电`}
            style={styles.expandBoosts}
            onPress={() => {
              if (!collapsed || previewHeight === undefined || animation.current) return;
              listContext?.getRef()?.prepareForLayoutAnimationRender();
              if (!reduceMotion) {
                setTransition({ postId: post.commentId!, from: previewHeight, to: layout.height, progress: 0 });
                progress.setValue(0);
              }
              context?.expandBoosts(post.commentId!);
              listContext?.layout();
              if (!reduceMotion) {
                // Commit each height step together with FlashList's following cell positions.
                animation.current = Animated.timing(progress, {
                  toValue: 1,
                  duration: 200,
                  easing: Easing.inOut(Easing.cubic),
                  useNativeDriver: false,
                  isInteraction: false
                });
                animation.current.start(({ finished }) => {
                  animation.current = null;
                  if (finished) setTransition(null);
                });
              }
            }}
          >
            <ChevronDown size={18} color={theme.muted} />
          </Pressable>
          {rocket()}
        </View>
      ) : null}
    </View>
  );
}

export function LinuxDoBoostButton({
  post,
  ...props
}: Omit<ComponentProps<typeof DetailActionButton>, 'icon' | 'label' | 'accessibilityLabel' | 'onPress'> & {
  post: Post;
}) {
  const context = useContext(Context);
  if (
    !context ||
    !post.commentId ||
    post.siteExtension?.boosts?.length ||
    !context.decisionFor({ action: 'boost', target: post }).allowed
  )
    return null;
  return (
    <DetailActionButton
      {...props}
      icon={Rocket}
      label="加电"
      accessibilityLabel="添加加电"
      onPress={() => context.openBoostComposer(post.commentId!)}
    />
  );
}

export function LinuxDoPostInteractionsProvider({
  active,
  scopeKey,
  topic,
  replies,
  actions,
  emojiUrls,
  onOpenUser,
  children
}: {
  active: boolean;
  scopeKey: string;
  topic: TopicDetail | null;
  replies: Reply[];
  actions: TopicActionsController;
  emojiUrls: DiscourseEmojiUrlMap;
  onOpenUser: (user: UserReference) => void;
  children: ReactNode;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { width, height } = useWindowDimensions();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [picker, setPicker] = useState<{ postId: number; x: number; y: number } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [reactionBusy, setReactionBusy] = useState(false);
  const [expandedBoosts, setExpandedBoosts] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    setExpandedBoosts(new Set());
  }, [scopeKey]);
  const expandBoosts = useCallback((postId: number) => {
    setExpandedBoosts((current) => (current.has(postId) ? current : new Set([...current, postId])));
  }, []);
  const posts = useMemo(
    () =>
      new Map(
        [...(topic ? [topic] : []), ...replies].flatMap((post) =>
          post.commentId ? [[post.commentId, post] as const] : []
        )
      ),
    [replies, topic]
  );
  const currentBoostTarget = actions.boostComposer ? posts.get(actions.boostComposer.postId) : undefined;
  // Keep the draft painted while the shared panel finishes its closing animation.
  const [presentedBoost, setPresentedBoost] = useState<{
    scopeKey: string;
    target: Post;
    composer: NonNullable<TopicActionsController['boostComposer']>;
  } | null>(null);
  if (presentedBoost && presentedBoost.scopeKey !== scopeKey) setPresentedBoost(null);
  else if (
    currentBoostTarget &&
    actions.boostComposer &&
    (presentedBoost?.target !== currentBoostTarget || presentedBoost.composer !== actions.boostComposer)
  )
    setPresentedBoost({ scopeKey, target: currentBoostTarget, composer: actions.boostComposer });
  const boostVisible = active && !!actions.boostComposer && !!currentBoostTarget;
  const boostTarget = currentBoostTarget || presentedBoost?.target;
  useEffect(() => {
    if (boostVisible && !inputRef.current?.isFocused()) inputRef.current?.focus();
  }, [boostVisible]);
  const currentPost = picker ? posts.get(picker.postId) : undefined;
  const boostTargetLabel =
    boostTarget?.commentId === topic?.commentId
      ? '主帖'
      : boostTarget && 'floor' in boostTarget && boostTarget.floor
        ? `#${boostTarget.floor}`
        : '评论';
  const enabled = active && topic?.source === 'linuxdo' && Boolean(picker || actions.boostComposer);
  const {
    data: config,
    error,
    isPending,
    refetch
  } = useQuery({ ...actions.linuxDoInteractionConfigQuery, enabled, retry: false });
  useEffect(() => {
    setPicker(null);
    setEmojiPickerOpen(false);
    setEmojiQuery('');
  }, [active, scopeKey]);
  useEffect(() => {
    setEmojiPickerOpen(false);
    setEmojiQuery('');
  }, [actions.boostComposer?.postId]);
  const openReactions = useCallback(
    (postId: number, event?: GestureResponderEvent) => {
      setPicker({ postId, x: event?.nativeEvent.pageX ?? width / 2, y: event?.nativeEvent.pageY ?? height / 2 });
      Vibration.vibrate(15);
    },
    [height, width]
  );
  const overlayOpen = Boolean(picker || actions.boostComposer);
  const { decisionFor, reactToPost, openBoostComposer, deleteBoost } = actions;
  const context = useMemo(
    () => ({
      decisionFor,
      reactToPost,
      openBoostComposer,
      deleteBoost,
      emojiUrls,
      openReactions,
      openUser: onOpenUser,
      overlayOpen,
      expandedBoosts,
      expandBoosts
    }),
    [
      decisionFor,
      reactToPost,
      openBoostComposer,
      deleteBoost,
      emojiUrls,
      onOpenUser,
      openReactions,
      overlayOpen,
      expandedBoosts,
      expandBoosts
    ]
  );
  const emojiNames = useMemo(() => Object.keys(emojiUrls), [emojiUrls]);
  const filteredEmojis = useMemo(
    () => emojiNames.filter((id) => id.includes(emojiQuery.toLowerCase().trim())),
    [emojiNames, emojiQuery]
  );
  const content = actions.boostComposer?.content ?? presentedBoost?.composer.content ?? '';
  const stats = discourseBoostStats(content, emojiNames);
  const boostDecision = boostTarget ? actions.decisionFor({ action: 'boost', target: boostTarget }) : null;
  const unknown = boostTarget?.siteExtension?.interactionUnconfirmed === true;
  const canReact = currentPost && actions.decisionFor({ action: 'like', target: currentPost }).allowed;
  const chooseReaction = async (id: string) => {
    if (!picker || reactionBusy) return;
    const selected = picker;
    setReactionBusy(true);
    try {
      if (await actions.reactToPost(selected.postId, id))
        setPicker((current) => (current === selected ? null : current));
    } finally {
      setReactionBusy(false);
    }
  };
  const addEmoji = (id: string) => {
    const next = content + (content ? ' ' : '') + `:${id}:`;
    if (!discourseBoostStats(next, emojiNames).valid) return;
    actions.changeBoostContent(next);
    setEmojiPickerOpen(false);
    inputRef.current?.focus();
  };
  return (
    <Context.Provider value={topic?.source === 'linuxdo' ? context : null}>
      {children}
      <PopupMenu
        visible={active && !!picker}
        accessibilityLabel="关闭表情反应"
        onRequestClose={() => setPicker(null)}
        placementStyle={{
          position: 'absolute',
          width: Math.min(300, width - 32),
          left: Math.max(16, Math.min((picker?.x || width / 2) - 150, width - 316)),
          top: Math.max(32, safeTop + 8, Math.min((picker?.y || height / 2) - 160, height - safeBottom - 210))
        }}
      >
        <View style={styles.picker}>
          <Text style={styles.title}>选择表情反应</Text>
          {isPending ? (
            <Text style={styles.muted}>正在读取表情…</Text>
          ) : error ? (
            <View>
              <Text style={styles.error}>表情读取失败</Text>
              <AppButton label="重试" onPress={() => void refetch()} />
            </View>
          ) : config?.reactionsEnabled ? (
            <View style={styles.choices}>
              {config.enabledReactions.map((id) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={`反应 ${id}`}
                  accessibilityState={{
                    selected: currentPost?.currentUserReaction?.id === id,
                    disabled: !canReact || reactionBusy
                  }}
                  disabled={!canReact || reactionBusy}
                  style={[styles.choice, currentPost?.currentUserReaction?.id === id && styles.selected]}
                  onPress={() => void chooseReaction(id)}
                >
                  {emojiUrls[id] ? (
                    <EmojiImage url={emojiUrls[id]} label={id} />
                  ) : (
                    <Text style={styles.choiceLabel}>{id}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>当前站点未启用表情反应</Text>
          )}
          {picker && currentPost?.siteExtension?.interactionUnconfirmed ? (
            <AppButton label="核对反应结果" onPress={() => void actions.recheckLinuxDoPost(picker.postId)} />
          ) : null}
        </View>
      </PopupMenu>
      <ComposerBottomSheet
        active={active}
        visible={boostVisible}
        backdropDismissLabel="关闭加电"
        backgroundStyle={styles.sheet}
        containerStyle={styles.sheetLayer}
        contentStyle={styles.sheetContent}
        dark={theme.dark}
        onOpenChange={(open) => {
          if (!open) actions.closeBoostComposer();
        }}
      >
        {() =>
          presentedBoost ? (
            <>
              <View style={styles.handle} />
              <View style={styles.composer}>
                <View style={styles.row}>
                  <View style={styles.heading}>
                    <Text style={styles.title}>
                      加电给 {boostTarget?.author} · {boostTargetLabel}
                    </Text>
                    <Text style={styles.muted}>最多 16 个字符、5 个表情</Text>
                  </View>
                  <IconButton icon={X} label="关闭加电" iconOnly ghost onPress={actions.closeBoostComposer} />
                </View>
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="加电内容"
                  placeholder="输入简短文字或表情"
                  placeholderTextColor={theme.muted}
                  value={content}
                  onChangeText={actions.changeBoostContent}
                  autoFocus
                  maxLength={1000}
                  editable={boostDecision?.reason !== 'pending'}
                  returnKeyType="send"
                  onSubmitEditing={() => {
                    if (stats.valid && boostDecision?.allowed && !unknown) void actions.submitBoost();
                  }}
                />
                {emojiPickerOpen ? (
                  <View style={styles.emojiPicker}>
                    <TextInput
                      accessibilityLabel="搜索加电表情"
                      placeholder="搜索表情名称"
                      value={emojiQuery}
                      onChangeText={setEmojiQuery}
                      placeholderTextColor={theme.muted}
                    />
                    <FlatList
                      style={styles.catalog}
                      data={filteredEmojis}
                      numColumns={6}
                      keyboardShouldPersistTaps="handled"
                      keyExtractor={(id) => id}
                      renderItem={({ item: id }) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`插入表情 ${id}`}
                          style={[styles.choice, styles.catalogChoice]}
                          onPress={() => addEmoji(id)}
                        >
                          <EmojiImage url={emojiUrls[id]} label={id} />
                        </Pressable>
                      )}
                    />
                    {!emojiNames.length ? <Text style={styles.muted}>表情目录尚未加载</Text> : null}
                  </View>
                ) : null}
                {unknown ? <Text style={styles.error}>提交结果尚未确认，请先核对，勿重复发送。</Text> : null}
                {!unknown && boostTarget && !boostDecision?.allowed && boostDecision?.reason !== 'pending' ? (
                  <Text style={styles.muted}>当前内容无法继续加电</Text>
                ) : null}
                <View style={styles.footer}>
                  <View style={styles.row}>
                    <IconButton
                      icon={Smile}
                      label="选择加电表情"
                      iconOnly
                      ghost
                      onPress={() => {
                        Keyboard.dismiss();
                        setEmojiPickerOpen((value) => !value);
                      }}
                    />
                    <Text style={stats.length > 16 || stats.emojiCount > 5 ? styles.error : styles.muted}>
                      {stats.length}/16 · 表情 {stats.emojiCount}/5
                    </Text>
                  </View>
                  {unknown && boostTarget?.commentId ? (
                    <AppButton
                      label="核对结果"
                      onPress={() => void actions.recheckLinuxDoPost(boostTarget.commentId!)}
                    />
                  ) : (
                    <AppButton
                      variant="primary"
                      label={boostDecision?.reason === 'pending' ? '发送中' : '发送加电'}
                      disabled={!stats.valid || !boostDecision?.allowed || isPending || !!error}
                      onPress={() => void actions.submitBoost()}
                    />
                  )}
                </View>
                {error ? <AppButton label="重试读取互动配置" onPress={() => void refetch()} /> : null}
              </View>
            </>
          ) : null
        }
      </ComposerBottomSheet>
    </Context.Provider>
  );
}
