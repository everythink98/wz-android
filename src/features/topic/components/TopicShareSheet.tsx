import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from 'react-native-paper';
import { ArrowLeft, Download, Share2, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import RenderHTML, { defaultHTMLElementModels, type CustomBlockRenderer } from 'react-native-render-html';

import type { TopicDetail } from '@/domain/forum/models';
import { normalizeMediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { errorMessage } from '@/platform/network/errors';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, lineHeightMultiplier, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { prepareTopicShareContent } from '../topicShareContent';
import { shareTopicImageFile } from '../shareTopicImageFile';

type ImageProgress = {
  completed: ReadonlySet<number>;
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

const ShareImage: CustomBlockRenderer = ({ tnode }) => {
  const progress = useContext(ImageProgressContext);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const index = Number(tnode.attributes['data-share-image-index']);
  useEffect(() => {
    if (progress && index < progress.completed.size + 4) setEnabled(true);
  }, [index, progress]);
  if (!progress) return null;
  const uri = tnode.attributes.src;
  const requestedHeight = Number(tnode.attributes['data-share-height']);
  const width = Math.min(
    containerWidth || progress.width,
    Number(tnode.attributes['data-share-width']) || size.width || progress.width,
    requestedHeight && size.height ? (requestedHeight * size.width) / size.height : Infinity
  );
  const height = size.width ? (width * size.height) / size.width : 120;
  return (
    <View
      style={{ maxWidth: '100%', alignSelf: 'stretch' }}
      onLayout={({ nativeEvent }) => setContainerWidth(nativeEvent.layout.width)}
    >
      <Image
        accessibilityLabel={tnode.attributes.alt || '正文图片'}
        source={
          enabled
            ? {
                uri,
                ...imageSourceFromUrl(uri, {
                  mediaContext: progress.mediaContext,
                  nodeSeekUserAgent: progress.nodeSeekUserAgent,
                  referrerPolicy: normalizeMediaReferrerPolicy(tnode.attributes.referrerpolicy)
                })
              }
            : null
        }
        style={{ width, height }}
        contentFit="contain"
        transition={0}
        autoplay={false}
        onLoadStart={() => progress.onStart(index)}
        onLoad={({ source }) => {
          if (source.width <= 0 || source.height <= 0 || (progress.width * source.height) / source.width > 10_000) {
            progress.onError();
            return;
          }
          setSize({ width: source.width, height: source.height });
        }}
        onDisplay={() => progress.onComplete(index)}
        onError={progress.onError}
      />
    </View>
  );
};

const renderers = { img: ShareImage };
const defaultTextProps = { selectable: false };
const renderersProps = { a: { onPress: () => undefined } };
const tagsStyles = {
  p: { marginTop: 0, marginBottom: 12 },
  pre: { backgroundColor: '#f2f4f5', padding: 10, fontFamily: 'monospace', whiteSpace: 'pre' as const },
  code: { fontFamily: 'monospace', backgroundColor: '#f2f4f5' },
  blockquote: { borderLeftWidth: 3, borderLeftColor: '#c3c9ce', paddingLeft: 12, marginLeft: 0 },
  a: { color: '#285f86', textDecorationLine: 'underline' as const },
  table: { marginBottom: 12 },
  tr: { flexDirection: 'row' as const },
  td: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#d6dade', padding: 6 },
  th: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#d6dade', padding: 6, fontWeight: '700' as const }
};

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
  const stackActions = windowWidth < 360 || settings.fontScale * PixelRatio.getFontScale() > 1.3;
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [operation, setOperation] = useState<'share' | 'save' | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(0);
  const [completed, setCompleted] = useState<ReadonlySet<number>>(new Set());
  const [height, setHeight] = useState(0);
  const [imageError, setImageError] = useState('');
  const [shareError, setShareError] = useState('');
  const document = useMemo(() => {
    try {
      return { kind: 'ready' as const, ...prepareTopicShareContent(topic) };
    } catch (error) {
      return { kind: 'error' as const, message: errorMessage(error) };
    }
  }, [topic]);
  const imageCount = document.kind === 'ready' ? document.imageCount : 0;
  const source = useMemo(() => ({ html: document.kind === 'ready' ? document.html : '' }), [document]);
  const onImageComplete = useCallback(
    (index: number) => {
      if (!mounted.current || currentAttempt.current !== attempt) return;
      setCompleted((current) => (current.has(index) ? current : new Set([...current, index])));
    },
    [attempt]
  );
  const onImageStart = useCallback(
    (index: number) => {
      if (!mounted.current || currentAttempt.current !== attempt) return;
      setCompleted((current) => {
        if (!current.has(index)) return current;
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    },
    [attempt]
  );
  const onImageError = useCallback(() => {
    if (mounted.current && currentAttempt.current === attempt) setImageError('有图片未能加载，请重试。');
  }, [attempt]);
  const progress = useMemo(
    () => ({
      completed,
      mediaContext,
      nodeSeekUserAgent,
      onComplete: onImageComplete,
      onStart: onImageStart,
      onError: onImageError,
      width: contentWidth
    }),
    [completed, contentWidth, mediaContext, nodeSeekUserAgent, onImageComplete, onImageError, onImageStart]
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (completed.size >= imageCount) return;
    const timeout = setTimeout(() => {
      if (mounted.current && currentAttempt.current === attempt) setImageError('图片加载超时，请重试。');
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [attempt, completed.size, imageCount]);

  const density = PixelRatio.get();
  // view-shot allocates the full native bitmap before any output resizing.
  const tooLarge = width * height * density * density > 24_000_000 || height * density > 32_000;
  const error =
    document.kind === 'error'
      ? document.message
      : tooLarge
        ? '正文过长，无法安全生成单张图片，请使用链接分享。'
        : imageError;
  const ready = !error && height > 0 && completed.size === imageCount;
  const canCapture = useRef(false);
  canCapture.current = ready;
  const close = () => {
    mounted.current = false;
    onClose();
  };
  const back = () => {
    mounted.current = false;
    (onBack || onClose)();
  };
  const retry = () => {
    if (busyRef.current || !mounted.current) return;
    currentAttempt.current += 1;
    setAttempt(currentAttempt.current);
    setCompleted(new Set());
    setHeight(0);
    setImageError('');
    setShareError('');
    setSaved(false);
  };
  const exportImage = async (action: 'share' | 'save') => {
    if (!ready || busyRef.current || !mounted.current) return;
    busyRef.current = true;
    setOperation(action);
    setShareError('');
    let uri: string | undefined;
    let release: ((uri: string) => void) | undefined;
    try {
      // Wait for the layout after the final decoded image before reading native pixels.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!mounted.current || !canCapture.current) return;
      // Keep the native module outside the read-only Topic import path, including older development APKs.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const viewShot: typeof import('react-native-view-shot') = require('react-native-view-shot');
      const { captureRef, releaseCapture } = viewShot;
      release = releaseCapture;
      if (!mounted.current || !canCapture.current) return;
      uri = await captureRef(scrollRef, { format: 'png', result: 'tmpfile', snapshotContentContainer: true });
      if (!mounted.current) return;
      if (action === 'share') await shareTopicImageFile(uri, topic.title, () => mounted.current);
      else {
        // Load the gallery module only when the user chooses to save.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const imageSave: typeof import('@/platform/media/imageSave') = require('@/platform/media/imageSave');
        await imageSave.saveLocalImageFileToLibrary(uri, () => {
          if (!mounted.current) throw new Error('图片保存已取消');
        });
        if (mounted.current) setSaved(true);
      }
    } catch (cause) {
      if (mounted.current) setShareError(`${action === 'share' ? '分享' : '保存'}失败：${errorMessage(cause)}`);
    } finally {
      if (uri) release?.(uri);
      busyRef.current = false;
      if (mounted.current) setOperation(null);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={back}>
      <SafeAreaView style={styles.root}>
        <View style={styles.toolbar}>
          <IconButton icon={onBack ? ArrowLeft : X} label={onBack ? '返回分享方式' : '关闭'} iconOnly onPress={back} />
          <View style={styles.headingGroup}>
            <Text accessibilityRole="header" style={styles.heading}>
              正文长图
            </Text>
            <Text style={styles.subtitle}>完整主帖{imageCount ? ` · ${imageCount} 张图片` : ''}</Text>
          </View>
          {onBack ? (
            <IconButton icon={X} label="关闭" iconOnly onPress={close} />
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>
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
                if (mounted.current && currentAttempt.current === attempt) setHeight(nextHeight);
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
                  baseStyle={styles.body}
                  tagsStyles={tagsStyles}
                  customHTMLElementModels={tableModels}
                  renderers={renderers}
                  enableCSSInlineProcessing={false}
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
        </View>
        <View testID="topic-share-actions" style={styles.actions}>
          {error || shareError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error || shareError}
            </Text>
          ) : null}
          {imageError && !tooLarge ? <AppButton label="重新加载图片" onPress={retry} /> : null}
          {!error && !shareError ? (
            <View style={styles.statusRow}>
              {!ready || operation ? <ActivityIndicator accessible={false} size="small" color={theme.primary} /> : null}
              <Text accessibilityLiveRegion="polite" style={[styles.status, saved && styles.success]}>
                {operation === 'save'
                  ? '正在保存…'
                  : operation === 'share'
                    ? '正在准备分享…'
                    : !ready
                      ? imageCount
                        ? `正在加载图片 ${completed.size}/${imageCount}`
                        : '正在排版…'
                      : saved
                        ? '已保存到相册'
                        : '上下滑动预览，导出包含完整正文'}
              </Text>
            </View>
          ) : null}
          <View style={[styles.actionRow, stackActions && styles.stackedActions]}>
            <Button
              mode="outlined"
              icon={({ color, size }) => <Download color={color} size={size} />}
              style={[styles.actionButton, stackActions && styles.stackedButton]}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
              disabled={!ready || operation !== null || saved}
              onPress={() => void exportImage('save')}
            >
              保存到相册
            </Button>
            <Button
              mode="contained"
              icon={({ color, size }) => <Share2 color={color} size={size} />}
              style={[styles.actionButton, stackActions && styles.stackedButton]}
              contentStyle={styles.buttonContent}
              labelStyle={styles.buttonLabel}
              disabled={!ready || operation !== null}
              onPress={() => void exportImage('share')}
            >
              分享图片
            </Button>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const font = (size: number) => Math.round(size * settings.fontScale);
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
    heading: { color: theme.ink, fontSize: font(17), fontWeight: '600' },
    subtitle: { color: theme.muted, fontSize: font(12) },
    headerSpacer: { width: 44 },
    preview: { flex: 1, backgroundColor: theme.background, paddingVertical: 16 },
    paper: { flex: 1, alignSelf: 'center', borderRadius: 12, backgroundColor: '#ffffff' },
    card: { padding: 24, backgroundColor: '#ffffff' },
    brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    brand: { fontSize: font(12), fontWeight: '700', color: '#65717b', letterSpacing: 2 },
    source: { color: '#52606c', fontSize: font(13), lineHeight: font(20) },
    title: {
      color: '#20252b',
      fontSize: font(22),
      fontWeight: '700',
      lineHeight: font(31),
      marginTop: 16,
      marginBottom: 10
    },
    date: { color: '#65717b', fontSize: font(12), lineHeight: font(19), marginBottom: 24 },
    body: {
      color: '#20252b',
      fontSize: font(16),
      lineHeight: Math.round(font(16) * lineHeightMultiplier(settings.lineHeight)),
      fontFamily: fontFamilyValue(settings.fontFamily)
    },
    footer: { marginTop: 20, borderTopWidth: 1, borderTopColor: '#e3e7eb', paddingTop: 16, gap: 6 },
    link: { color: '#285f86', fontSize: font(12), lineHeight: font(18) },
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
    actionButton: { flex: 1, borderRadius: 12 },
    stackedButton: { flex: 0 },
    buttonContent: { minHeight: 48 },
    buttonLabel: { fontSize: font(14) },
    statusRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', minHeight: 22 },
    status: { flexShrink: 1, color: theme.muted, fontSize: font(12), lineHeight: font(18) },
    success: { color: theme.success },
    error: { color: theme.danger, fontSize: font(13), lineHeight: font(19) }
  });
}
