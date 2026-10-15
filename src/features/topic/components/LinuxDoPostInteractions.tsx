import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps
} from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Rocket, Smile, X } from 'lucide-react-native';
import type { DiscourseBoost, Reply, TopicDetail, UserReference } from '@/domain/forum/models';
import { discourseBoostStats } from '@/domain/forum/discourseInteractions';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { PopupMenu } from '@/ui/controls/PopupMenu';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { Avatar } from '@/ui/avatar/Avatar';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
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
};
const Context = createContext<InteractionContext | null>(null);
export function useLinuxDoInteractionOverlayOpen() {
  return useContext(Context)?.overlayOpen || false;
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = Math.round(14 * settings.fontScale);
  return StyleSheet.create({
    bubbles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    bubble: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 40,
      paddingLeft: 6,
      paddingRight: 12,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      maxWidth: '100%',
      backgroundColor: theme.surface2
    },
    content: {
      color: theme.ink,
      fontSize,
      lineHeight: Math.round(22 * settings.fontScale),
      includeFontPadding: false,
      fontFamily: fontFamilyValue(settings.fontFamily),
      flexShrink: 1
    },
    bubbleAvatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    bubbleContent: { flexShrink: 1, justifyContent: 'center', minHeight: 32 },
    rocket: {
      width: 40,
      height: 40,
      borderRadius: 20,
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
    choice: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    selected: { backgroundColor: alphaColor(theme.primary, theme.dark ? 0.25 : 0.12) },
    choiceLabel: {
      fontSize: Math.round(11 * settings.fontScale),
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      textAlign: 'center'
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heading: { flex: 1, minWidth: 0, gap: 4 },
    sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
    sheetLayer: { zIndex: 30, elevation: 30 },
    sheetContent: { gap: 12, paddingHorizontal: 16, paddingTop: 9 },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: theme.lineStrong },
    composer: { flexShrink: 1, gap: 16, paddingTop: 4 },
    emojiPicker: { flexShrink: 1, gap: 8 },
    input: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(16 * settings.fontScale),
      backgroundColor: theme.surface2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 56
    },
    searchInput: { minHeight: 48, paddingVertical: 8, fontSize },
    catalog: { maxHeight: 208 },
    catalogChoice: { width: '16.666666%', minHeight: 48, borderRadius: 10, padding: 4 },
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

function BoostBubble({ boost, postId }: { boost: DiscourseBoost; postId: number }) {
  const context = useContext(Context);
  const { styles, settings } = useReaderThemeStyles(createStyles);
  const label = boost.content.map((part) => ('text' in part ? part.text : part.emoji)).join('');
  return (
    <View style={styles.bubble}>
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
              <Text key={index}>{part.text}</Text>
            ) : (
              <EmojiImage
                key={index}
                url={part.imageUrl}
                label={part.emoji}
                size={Math.round(18 * settings.fontScale)}
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
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const boosts = post.siteExtension?.boosts || [];
  if (!boosts.length || !post.commentId) return null;
  const allowed = context?.decisionFor({ action: 'boost', target: post }).allowed;
  return (
    <View style={styles.bubbles} testID={`post-boosts-${post.commentId}`}>
      {boosts.map((boost) => (
        <BoostBubble key={boost.id} boost={boost} postId={post.commentId!} />
      ))}
      {allowed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加加电"
          style={styles.rocket}
          hitSlop={4}
          onPress={() => context?.openBoostComposer(post.commentId!)}
        >
          <Rocket size={20} color={theme.muted} />
        </Pressable>
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
  const inputRef = useRef<TextInput>(null);
  const [picker, setPicker] = useState<{ postId: number; x: number; y: number } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [reactionBusy, setReactionBusy] = useState(false);
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
      overlayOpen
    }),
    [decisionFor, reactToPost, openBoostComposer, deleteBoost, emojiUrls, onOpenUser, openReactions, overlayOpen]
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
          top: Math.max(32, Math.min((picker?.y || height / 2) - 160, height - 210))
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
                  style={styles.input}
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
                      style={[styles.input, styles.searchInput]}
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
