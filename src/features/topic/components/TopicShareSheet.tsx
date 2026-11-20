import { ActivityIndicator } from 'react-native-paper';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  PixelRatio,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageURISource
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationBackdropProvider, NavigationBackdropTarget } from '@/ui/navigation/NavigationGlass';
import { ArrowLeft, Check, Download, Share2, X } from 'lucide-react-native';
import { Image, type ImageRef } from 'expo-image';
import RenderHTML, {
  defaultHTMLElementModels,
  TChildrenRenderer,
  type CustomBlockRenderer,
  type TNode
} from 'react-native-render-html';

import { FORUM_STICKER_TAG, INLINE_FORUM_IMAGE_TAG } from '@/domain/forum/forumContentMedia';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import type { TopicDetail } from '@/domain/forum/models';
import { normalizeMediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import {
  cachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster
} from '@/platform/media/compatibleImageSources';
import { captureLongTopicImage } from '@/platform/media/topicShareCapture';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { errorMessage } from '@/platform/network/errors';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { buildHtmlRenderingStyles, HTML_ALLOWED_INLINE_STYLES } from '@/ui/content/forumHtmlStyles';
import { createForumStickerRenderers } from '@/ui/content/ForumStickerContent';
import { ForumContentWidthBoundary, useForumContentWidth } from '@/ui/content/ForumContentWidth';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createReaderFontSizer,
  createTheme,
  fontFamilyValue,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { createHtmlCustomElementModels } from '../rendering/htmlElementModels';
import { prepareTopicShareContent } from '../topicShareContent';
import { shareTopicImageFile } from '../shareTopicImageFile';

type ImageProgress = {
  completed: ReadonlySet<number>;
  decodeSize: { maxWidth: number; maxHeight: number };
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  onComplete: (index: number) => void;
  onStart: (index: number) => void;
  onError: () => void;
  width: number;
};

const ImageProgressContext = createContext<ImageProgress | null>(null);
const tableModels = {
  table: defaultHTMLElementModels.table.extend({ getUADerivedStyleFromAttributes: () => ({}) }),
  th: defaultHTMLElementModels.th.extend({ getUADerivedStyleFromAttributes: () => ({}) }),
  td: defaultHTMLElementModels.td.extend({ getUADerivedStyleFromAttributes: () => ({}) })
};

const MAX_SHARE_IMAGE_HEIGHT = 10_000;
const MAX_SHARE_IMAGE_WIDTH = 1440;
// The preview retains every drawable for capture. At four bytes per pixel this budgets 192 MiB across them.
const MAX_SHARE_DECODE_PIXELS = 48 * 1024 * 1024;

function shareImageDecodeSize(imageCount: number): ImageProgress['decodeSize'] {
  const pixelsPerImage = Math.max(1, Math.floor(MAX_SHARE_DECODE_PIXELS / Math.max(1, imageCount)));
  const maxWidth = Math.min(MAX_SHARE_IMAGE_WIDTH, Math.floor(Math.sqrt(pixelsPerImage)));
  return { maxWidth, maxHeight: Math.min(MAX_SHARE_IMAGE_HEIGHT, Math.floor(pixelsPerImage / maxWidth)) };
}

type ShareImageAsset = { image: ImageRef; dimensions?: { width: number; height: number } };

async function decodeShareImage(
  source: ImageURISource & { uri: string },
  declaredSvg: boolean,
  decodeSize: ImageProgress['decodeSize'],
  signal: AbortSignal
): Promise<ShareImageAsset> {
  let artifact = cachedCompatibleSvgArtifact(source);
  if (!artifact && declaredSvg && Platform.OS === 'android') {
    artifact = await recoverCompatibleSvgArtifact(source, { signal }).catch(() => null);
    if (signal.aborted) throw new Error('图片加载已取消');
  }
  if (!artifact) {
    try {
      return { image: await Image.loadAsync(source, decodeSize) };
    } catch (error) {
      if (signal.aborted || declaredSvg || Platform.OS !== 'android') throw error;
      artifact = await recoverCompatibleSvgArtifact(source, { signal });
      if (!artifact || signal.aborted) throw error;
    }
  }
  try {
    return { image: await Image.loadAsync(artifact.posterSource, decodeSize), dimensions: artifact.dimensions };
  } catch (error) {
    if (signal.aborted) throw error;
    const refreshed = await refreshCompatibleSvgPoster(artifact, { signal });
    return { image: await Image.loadAsync(refreshed.posterSource, decodeSize), dimensions: refreshed.dimensions };
  }
}

function ShareImage({ tnode }: { tnode: TNode }) {
  const progress = useContext(ImageProgressContext);
  const contentWidth = useForumContentWidth();
  const [asset, setAsset] = useState<ShareImageAsset | null>(null);
  const observed = useRef({ loaded: false, displayed: false });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const index = Number(tnode.attributes['data-share-image-index']);
  const uri = tnode.attributes.src;
  const declaredSvg = tnode.attributes['data-share-svg'] === 'true' || /\.svg(?:[?#]|$)/i.test(uri);
  const referrerPolicy = normalizeMediaReferrerPolicy(tnode.attributes.referrerpolicy);
  const mediaContext = progress?.mediaContext;
  const decodeSize = progress?.decodeSize;
  const nodeSeekUserAgent = progress?.nodeSeekUserAgent;
  const onStart = progress?.onStart;
  const onError = progress?.onError;
  useEffect(() => {
    if (progress && index < progress.completed.size + 4) setEnabled(true);
  }, [index, progress]);
  useEffect(() => {
    if (!enabled || !mediaContext || !decodeSize) return;
    const controller = new AbortController();
    let decoded: ImageRef | undefined;
    observed.current = { loaded: false, displayed: false };
    setAsset(null);
    onStart?.(index);
    void decodeShareImage(
      { uri, ...imageSourceFromUrl(uri, { mediaContext, nodeSeekUserAgent, referrerPolicy }) },
      declaredSvg,
      decodeSize,
      controller.signal
    ).then(
      (loaded) => {
        if (controller.signal.aborted) loaded.image.release();
        else {
          decoded = loaded.image;
          setAsset(loaded);
        }
      },
      () => {
        if (!controller.signal.aborted) onError?.();
      }
    );
    return () => {
      controller.abort();
      decoded?.release();
    };
  }, [declaredSvg, decodeSize, enabled, index, mediaContext, nodeSeekUserAgent, onError, onStart, referrerPolicy, uri]);
  if (!progress) return null;
  const heightLimit = Math.min(Number(tnode.attributes['data-share-height']) || Infinity, MAX_SHARE_IMAGE_HEIGHT);
  const aspect = size.width ? size.height / size.width : 0;
  const decodedToBudget =
    !asset?.dimensions &&
    ((progress.decodeSize.maxWidth < MAX_SHARE_IMAGE_WIDTH && size.width >= progress.decodeSize.maxWidth - 1) ||
      (progress.decodeSize.maxHeight < MAX_SHARE_IMAGE_HEIGHT && size.height >= progress.decodeSize.maxHeight - 1));
  // A raster resized by the decoder still fills its allotted column using the original aspect ratio.
  const layoutWidth = Number(tnode.attributes['data-share-width']) || (decodedToBudget ? 0 : size.width);
  const width = Math.min(
    containerWidth || contentWidth,
    contentWidth,
    layoutWidth || progress.width,
    aspect > 0 ? heightLimit / aspect : Infinity
  );
  const height = aspect > 0 ? Math.min(width * aspect, heightLimit) : 120;
  const inline = tnode.tagName === INLINE_FORUM_IMAGE_TAG;
  const sticker = tnode.tagName === FORUM_STICKER_TAG;
  const renderedImage = (
    <Image
      accessibilityLabel={tnode.attributes.alt || '正文图片'}
      source={asset?.image ?? null}
      style={{ width, height }}
      contentFit="contain"
      transition={0}
      autoplay={false}
      onLoadStart={() => {
        // A native relayout can redisplay the same decoded image without reporting its dimensions again.
        observed.current.displayed = false;
        progress.onStart(index);
      }}
      onLoad={({ source }) => {
        if (!asset) return;
        const dimensions = asset.dimensions || source;
        if (
          !Number.isFinite(source.width) ||
          !Number.isFinite(source.height) ||
          source.width <= 0 ||
          source.height <= 0
        ) {
          progress.onError();
          return;
        }
        setSize(dimensions);
        observed.current.loaded = true;
        if (observed.current.displayed) progress.onComplete(index);
      }}
      onDisplay={() => {
        if (!asset) return;
        observed.current.displayed = true;
        if (observed.current.loaded) progress.onComplete(index);
      }}
      onError={progress.onError}
    />
  );
  if (inline) return renderedImage;
  return (
    <View
      style={{ maxWidth: '100%', alignSelf: sticker ? 'flex-start' : 'stretch' }}
      onLayout={({ nativeEvent }) => setContainerWidth(nativeEvent.layout.width)}
    >
      {renderedImage}
    </View>
  );
}

const ShareTableCell: CustomBlockRenderer = ({ TDefaultRenderer, ...props }) => {
  const [width, setWidth] = useState(0);
  return (
    <TDefaultRenderer {...props}>
      <View testID="topic-share-cell-content" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
        <ForumContentWidthBoundary width={width}>
          <TChildrenRenderer tchildren={props.tnode.children} />
        </ForumContentWidthBoundary>
      </View>
    </TDefaultRenderer>
  );
};

const defaultTextProps = { selectable: false };
const renderersProps = { a: { onPress: () => undefined } };

/** Admission and cancellation belong to one export; preview readiness remains an independent native observation. */
class TopicShareCaptureSession {
  private run: AbortController | null = null;
  private mounted = true;
  private preview = 0;
  private ready = false;

  constructor(private publishOperation: (action: 'share' | 'save' | null) => void) {}

  mount() {
    this.mounted = true;
  }
  close() {
    this.mounted = false;
    this.invalidateCapture();
  }
  acceptsPreview(preview: number) {
    return this.mounted && preview === this.preview;
  }
  observeReady(ready: boolean) {
    this.ready = ready;
  }
  invalidateCapture() {
    this.run?.abort();
  }

  retryPreview() {
    if (!this.mounted || this.run) return null;
    this.preview += 1;
    return this.preview;
  }

  claim(action: 'share' | 'save') {
    if (!this.ready || !this.mounted || this.run) return null;
    const run = new AbortController();
    this.run = run;
    this.publishOperation(action);
    return run;
  }

  owns(run: AbortController) {
    return this.run === run && !run.signal.aborted;
  }

  canCapture(run: AbortController) {
    return this.owns(run) && this.ready;
  }

  finish(run: AbortController) {
    if (this.run !== run) return;
    this.run = null;
    if (this.mounted) this.publishOperation(null);
  }
}

export function TopicShareSheet({
  topic,
  mediaContext,
  nodeSeekUserAgent,
  onClose,
  onBack
}: {
  topic: TopicDetail;
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const { styles, theme, settings } = useReaderThemeStyles(createStyles);
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth - 32, 480);
  const contentWidth = width - 48;
  const { htmlBaseStyle, htmlClassesStyles, htmlIgnoredStyles, htmlTagsStyles } = useMemo(
    () =>
      buildHtmlRenderingStyles({
        settings,
        theme: createTheme({ theme: 'light' }),
        enableDiscourseCallouts: isDiscourseSource(topic.source)
      }),
    [settings, topic.source]
  );
  const tagsStyles = useMemo(
    () => ({
      ...htmlTagsStyles,
      pre: { ...htmlTagsStyles.pre, fontFamily: 'monospace', whiteSpace: 'pre' as const },
      table: { ...htmlTagsStyles.table, marginBottom: 12 },
      td: { ...htmlTagsStyles.td, flex: 1, flexShrink: 1, minWidth: 0 },
      th: { ...htmlTagsStyles.th, flex: 1, flexShrink: 1, minWidth: 0 }
    }),
    [htmlTagsStyles]
  );
  const models = useMemo(
    () => ({ ...createHtmlCustomElementModels(settings.lineHeight), ...tableModels }),
    [settings.lineHeight]
  );
  const renderers = useMemo(
    () => ({
      ...createForumStickerRenderers({
        fontScale: settings.fontScale,
        mediaContext,
        mediaSessionIdentity: mediaContext.sessionIdentity,
        nodeSeekMediaUserAgent: nodeSeekUserAgent
      }),
      td: ShareTableCell,
      th: ShareTableCell,
      img: ShareImage,
      [INLINE_FORUM_IMAGE_TAG]: ShareImage,
      [FORUM_STICKER_TAG]: ShareImage
    }),
    [mediaContext, nodeSeekUserAgent, settings.fontScale]
  );
  const stackActions = windowWidth < 360 || settings.fontScale * PixelRatio.getFontScale() > 1.3;
  const scrollRef = useRef<ScrollView>(null);
  const [operation, setOperation] = useState<'share' | 'save' | null>(null);
  const [capture] = useState(() => new TopicShareCaptureSession(setOperation));
  const [saved, setSaved] = useState(false);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [completed, setCompleted] = useState<ReadonlySet<number>>(new Set());
  const [height, setHeight] = useState(0);
  const [imageProblem, setImageProblem] = useState<'failed' | 'timeout' | null>(null);
  const [shareError, setShareError] = useState('');
  const document = useMemo(() => {
    try {
      return { kind: 'ready' as const, ...prepareTopicShareContent(topic) };
    } catch (error) {
      return { kind: 'error' as const, message: errorMessage(error) };
    }
  }, [topic]);
  const imageCount = document.kind === 'ready' ? document.imageCount : 0;
  const decodeSize = useMemo(() => shareImageDecodeSize(imageCount), [imageCount]);
  const source = useMemo(() => ({ html: document.kind === 'ready' ? document.html : '' }), [document]);
  const onImageComplete = useCallback(
    (index: number) => {
      if (!capture.acceptsPreview(attempt)) return;
      setCompleted((current) => (current.has(index) ? current : new Set([...current, index])));
    },
    [attempt, capture]
  );
  const onImageStart = useCallback(
    (index: number) => {
      if (!capture.acceptsPreview(attempt)) return;
      capture.invalidateCapture();
      setCompleted((current) => {
        if (!current.has(index)) return current;
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    },
    [attempt, capture]
  );
  const onImageError = useCallback(() => {
    if (capture.acceptsPreview(attempt)) setImageProblem('failed');
  }, [attempt, capture]);
  const progress = useMemo(
    () => ({
      completed,
      decodeSize,
      mediaContext,
      nodeSeekUserAgent,
      onComplete: onImageComplete,
      onStart: onImageStart,
      onError: onImageError,
      width: contentWidth
    }),
    [completed, contentWidth, decodeSize, mediaContext, nodeSeekUserAgent, onImageComplete, onImageError, onImageStart]
  );
  useLayoutEffect(() => {
    capture.mount();
    return () => capture.close();
  }, [capture]);
  useEffect(() => {
    if (completed.size >= imageCount) {
      if (imageProblem === 'timeout') setImageProblem(null);
      return;
    }
    if (imageProblem) return;
    const timeout = setTimeout(() => {
      if (capture.acceptsPreview(attempt)) setImageProblem((current) => current || 'timeout');
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [attempt, capture, completed.size, imageCount, imageProblem]);

  const density = PixelRatio.get();
  // Android always redraws at export resolution; view-shot retains the full native bitmap on other platforms.
  const needsBoundedCapture = width * height * density * density > 24_000_000 || height * density > 32_000;
  const tooLarge = Platform.OS !== 'android' && needsBoundedCapture;
  const imageError =
    imageProblem === 'failed' ? '有图片未能加载，请重试。' : imageProblem === 'timeout' ? '图片加载超时，请重试。' : '';
  const error =
    document.kind === 'error'
      ? document.message
      : tooLarge
        ? '正文过长，无法安全生成单张图片，请使用链接分享。'
        : imageError;
  const ready = !error && height > 0 && completed.size === imageCount;
  capture.observeReady(ready);
  useEffect(() => {
    if (!ready) capture.invalidateCapture();
  }, [capture, ready]);
  const close = () => {
    capture.close();
    onClose();
  };
  const back = () => {
    capture.close();
    (onBack || onClose)();
  };
  const retry = () => {
    const nextAttempt = capture.retryPreview();
    if (nextAttempt === null) return;
    setAttempt(nextAttempt);
    setCompleted(new Set());
    setHeight(0);
    setImageProblem(null);
    setShareError('');
    setSaved(false);
  };
  const exportImage = async (action: 'share' | 'save') => {
    const run = capture.claim(action);
    if (!run) return;
    setShareError('');
    let uri: string | undefined;
    let release: (() => void) | undefined;
    try {
      // Wait for the layout after the final decoded image before reading native pixels.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!capture.canCapture(run)) return;
      if (Platform.OS === 'android') {
        const captured = await captureLongTopicImage(scrollRef.current, run.signal);
        uri = captured.uri;
        release = captured.release;
      } else {
        // Keep the native module outside the read-only Topic import path, including older development APKs.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const viewShot: typeof import('react-native-view-shot') = require('react-native-view-shot');
        uri = await viewShot.captureRef(scrollRef, {
          format: 'png',
          result: 'tmpfile',
          snapshotContentContainer: true
        });
        const capturedUri = uri;
        release = () => viewShot.releaseCapture(capturedUri);
      }
      if (!capture.owns(run)) return;
      if (action === 'share') await shareTopicImageFile(uri, topic.title, () => capture.owns(run));
      else {
        // Load the gallery module only when the user chooses to save.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const imageSave: typeof import('@/platform/media/imageSave') = require('@/platform/media/imageSave');
        await imageSave.saveLocalImageFileToLibrary(uri, () => {
          if (!capture.owns(run)) throw new Error('图片保存已取消');
        });
        if (capture.owns(run)) {
          setSaved(true);
          AccessibilityInfo.announceForAccessibility('已保存到相册');
        }
      }
    } catch (cause) {
      if (capture.owns(run)) setShareError(`${action === 'share' ? '分享' : '保存'}失败：${errorMessage(cause)}`);
    } finally {
      release?.();
      capture.finish(run);
    }
  };

  return (
    <Modal visible backdropColor={theme.surface} animationType="slide" onRequestClose={back}>
      <NavigationBackdropProvider>
        <SafeAreaView style={styles.root}>
          <View
            style={[styles.toolbar, { zIndex: 1 }]}
            onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}
          >
            <IconButton
              icon={onBack ? ArrowLeft : X}
              label={onBack ? '返回分享方式' : '关闭'}
              iconOnly
              ghost
              onPress={back}
            />
            <View style={styles.headingGroup}>
              <Text accessibilityRole="header" style={styles.heading}>
                正文长图
              </Text>
              {imageCount ? <Text style={styles.subtitle}>{imageCount} 张图片</Text> : null}
            </View>
            {onBack ? (
              <IconButton icon={X} label="关闭" iconOnly ghost onPress={close} />
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </View>
          <NavigationBackdropTarget active testID="share-glass-content" topInset={topBarHeight}>
            <View style={styles.preview}>
              {document.kind === 'ready' && !tooLarge ? (
                <ScrollView
                  overScrollMode="never"
                  key={attempt}
                  ref={scrollRef}
                  testID="topic-share-content"
                  style={[styles.paper, { width }]}
                  contentContainerStyle={styles.card}
                  removeClippedSubviews={false}
                  onContentSizeChange={(_width, nextHeight) => {
                    if (capture.acceptsPreview(attempt)) setHeight(nextHeight);
                  }}
                >
                  <View style={styles.brandRow}>
                    <Text style={styles.source}>{sourceLabel(topic.source)}</Text>
                    <Text style={styles.brand}>阅坛</Text>
                  </View>
                  <Text style={styles.title}>{topic.title}</Text>
                  <Text style={styles.date}>
                    {topic.author} · {formatDateTime(topic.createdAt)}
                  </Text>
                  <ImageProgressContext.Provider value={progress}>
                    <RenderHTML
                      contentWidth={contentWidth}
                      source={source}
                      baseStyle={htmlBaseStyle}
                      emSize={typeof htmlBaseStyle.fontSize === 'number' ? htmlBaseStyle.fontSize : 16}
                      tagsStyles={tagsStyles}
                      classesStyles={htmlClassesStyles}
                      allowedStyles={HTML_ALLOWED_INLINE_STYLES}
                      ignoredStyles={htmlIgnoredStyles}
                      customHTMLElementModels={models}
                      renderers={renderers}
                      defaultTextProps={defaultTextProps}
                      renderersProps={renderersProps}
                    />
                  </ImageProgressContext.Provider>
                  <View style={styles.footer}>
                    <Text style={styles.source}>阅读原帖</Text>
                    <Text style={styles.link}>{topic.url}</Text>
                  </View>
                </ScrollView>
              ) : null}
              {!error && !shareError && !ready ? (
                <View pointerEvents="none" style={styles.statusOverlay}>
                  <ActivityIndicator accessible={false} size={15} color={theme.primary} />
                  <Text accessibilityLiveRegion="polite" style={styles.status}>
                    {imageCount ? `加载图片 ${completed.size}/${imageCount}` : '生成预览中'}
                  </Text>
                </View>
              ) : null}
            </View>
          </NavigationBackdropTarget>
          <View testID="topic-share-actions" style={styles.actions}>
            {error || shareError ? (
              <View style={styles.errorRow}>
                <Text accessibilityRole="alert" style={styles.error}>
                  {error || shareError}
                </Text>
                {imageError && !tooLarge ? <AppButton compact label="重新加载图片" onPress={retry} /> : null}
              </View>
            ) : null}
            <View style={[styles.actionRow, stackActions && styles.stackedActions]}>
              <View style={[styles.actionSlot, stackActions && styles.stackedButton]}>
                <AppButton
                  accessibilityLabel={saved ? '已保存到相册' : '保存到相册'}
                  icon={saved ? Check : Download}
                  label={operation === 'save' ? '保存中' : saved ? '已保存到相册' : '保存到相册'}
                  loading={operation === 'save'}
                  disabled={!ready || operation !== null || saved}
                  onPress={() => void exportImage('save')}
                />
              </View>
              <View style={[styles.actionSlot, stackActions && styles.stackedButton]}>
                <AppButton
                  accessibilityLabel="分享图片"
                  variant="solid"
                  icon={Share2}
                  label={operation === 'share' ? '准备中' : '分享图片'}
                  loading={operation === 'share'}
                  disabled={!ready || operation !== null}
                  onPress={() => void exportImage('share')}
                />
              </View>
            </View>
          </View>
        </SafeAreaView>
      </NavigationBackdropProvider>
    </Modal>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = createReaderFontSizer(settings);
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.surface },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8
    },
    headingGroup: { flex: 1, gap: 2, alignItems: 'center' },
    heading: { fontFamily, color: theme.ink, fontSize: font(17), fontWeight: '600' },
    subtitle: { fontFamily, color: theme.muted, fontSize: font(12) },
    headerSpacer: { width: 48 },
    preview: { flex: 1, backgroundColor: theme.background, paddingVertical: 16 },
    paper: { flex: 1, alignSelf: 'center', borderRadius: readerRadii.surface, backgroundColor: '#ffffff' },
    card: { padding: 24, backgroundColor: '#ffffff' },
    brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    brand: { fontFamily, fontSize: font(12), fontWeight: '700', color: '#65717b', letterSpacing: 2 },
    source: { fontFamily, color: '#52606c', fontSize: font(13), lineHeight: font(20) },
    title: {
      fontFamily,
      color: '#20252b',
      fontSize: font(22),
      fontWeight: '700',
      lineHeight: font(31),
      marginTop: 16,
      marginBottom: 10
    },
    date: { fontFamily, color: '#65717b', fontSize: font(12), lineHeight: font(19), marginBottom: 24 },
    footer: { marginTop: 20, borderTopWidth: 1, borderTopColor: '#e3e7eb', paddingTop: 16, gap: 6 },
    link: { fontFamily, color: '#285f86', fontSize: font(12), lineHeight: font(18) },
    actions: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line
    },
    actionRow: { flexDirection: 'row', gap: 12 },
    stackedActions: { flexDirection: 'column' },
    actionSlot: { flex: 1 },
    stackedButton: { flex: 0 },
    errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    statusOverlay: {
      position: 'absolute',
      bottom: 16,
      alignSelf: 'center',
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: readerRadii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 6
    },
    status: {
      flexShrink: 1,
      fontFamily,
      color: theme.muted,
      fontSize: font(12),
      lineHeight: font(18),
      fontVariant: ['tabular-nums']
    },
    error: { flex: 1, fontFamily, color: theme.danger, fontSize: font(13), lineHeight: font(19) }
  });
}
