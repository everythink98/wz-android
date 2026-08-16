import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  type NativeSyntheticEvent,
  type ViewStyle
} from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { RenderHTMLSource, TNodeRenderer, useAmbientTRenderEngine } from 'react-native-render-html';
import type {
  CompiledForumContentSegment,
  ForumCodeTextRun,
  ForumContentAncestorFrame,
  ForumContentMaterializationRegion,
  ForumContentSemanticContinuation,
  ForumContentSelectableRegion
} from '@/domain/forum/topicContentSplit';
import {
  NativeForumSelectionSurface,
  type ForumSelectionContentSizeEvent,
  type ForumSelectionLinkEvent,
  type ForumSelectionTableScrollEvent
} from '@/platform/android/forumContentSelection';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import { ForumCallout, forumCalloutPalette } from '@/ui/content/ForumCallout';
import { androidRipple, fontFamilyValue, lineHeightMultiplier } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from '../styles';
import { stableTextHash } from '../model/contentIdentity';
import { useTopicSplitDisclosure, useTopicTerminalReport } from '../rendering/TopicSplitDisclosure';
import { TopicHorizontalScroll, useTopicNativeTableScroll } from '../rendering/topicTableRenderers';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';
import { buildForumSelectionDocument } from '../rendering/forumSelectionDocument';

import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';

type TopicContentBlockProps = {
  contentWidth: number;
  inlineSizedImageUrls?: Readonly<Record<string, boolean | undefined>>;
  isInlineSizedImage?: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    identities: Readonly<Record<string, boolean | undefined>>
  ) => boolean;
  onLinkPress?: (href: string) => void;
  originalImageUpgradeEnabled?: boolean;
  query?: string;
  region: ForumContentMaterializationRegion;
  trimTrailingBlockSpacing?: boolean;
};

function continuationFrameStyle(continuation: ForumContentSemanticContinuation, radius: number): ViewStyle {
  if (continuation === 'only') return {};
  return {
    borderBottomLeftRadius: continuation === 'last' ? radius : 0,
    borderBottomRightRadius: continuation === 'last' ? radius : 0,
    borderBottomWidth: continuation === 'last' ? StyleSheet.hairlineWidth : 0,
    borderTopLeftRadius: continuation === 'first' ? radius : 0,
    borderTopRightRadius: continuation === 'first' ? radius : 0,
    borderTopWidth: continuation === 'first' ? StyleSheet.hairlineWidth : 0,
    ...(continuation === 'first' || continuation === 'middle' ? { marginBottom: 0 } : {}),
    ...(continuation === 'middle' || continuation === 'last' ? { marginTop: 0 } : {})
  };
}

function codeRunNodes(runs: readonly ForumCodeTextRun[], query: string, highlightColor: string) {
  const needle = query.trim();
  if (!needle) {
    return runs.map((run, index) => (
      <Text key={index} style={run.style}>
        {run.text}
      </Text>
    ));
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return runs.flatMap((run, runIndex) =>
    run.text.split(new RegExp(`(${escaped})`, 'gi')).map((text, partIndex) => (
      <Text
        key={`${runIndex}:${partIndex}`}
        style={[
          run.style,
          text.toLocaleLowerCase() === needle.toLocaleLowerCase() ? { backgroundColor: highlightColor } : undefined
        ]}
      >
        {text}
      </Text>
    ))
  );
}

function CodeBlock({
  contentWidth,
  query,
  segment
}: {
  contentWidth: number;
  query: string;
  segment: Extract<CompiledForumContentSegment, { type: 'codeBlock' }>;
}) {
  const { settings, theme } = useReaderThemeStyles(createTopicStyles);
  const radius = 10;
  const terminal = segment.variant === 'terminal';
  const copy = () => {
    if (segment.copyText === undefined) return;
    void Clipboard.setStringAsync(segment.copyText)
      .then(() => ToastAndroid.show('代码已复制', ToastAndroid.SHORT))
      .catch(() => ToastAndroid.show('复制失败', ToastAndroid.SHORT));
  };
  return (
    <View
      style={{
        marginBottom: segment.semanticContinuation === 'first' || segment.semanticContinuation === 'middle' ? 0 : 12,
        marginTop: segment.semanticContinuation === 'middle' || segment.semanticContinuation === 'last' ? 0 : 12
      }}
    >
      <TopicHorizontalScroll
        accessibilityHint="横向滑动查看完整代码"
        accessibilityLabel="代码块"
        contentContainerStyle={{ minWidth: contentWidth }}
        semanticId={segment.semanticId}
        showsHorizontalScrollIndicator={
          segment.semanticContinuation === 'only' || segment.semanticContinuation === 'last'
        }
        testID="topic-code-scroll"
        viewportWidth={contentWidth}
      >
        <View
          style={[
            {
              backgroundColor: terminal ? '#111827' : theme.surface2,
              borderColor: terminal ? 'rgba(255,255,255,0.16)' : theme.line,
              borderRadius: radius,
              borderWidth: StyleSheet.hairlineWidth,
              minWidth: contentWidth,
              padding: 12,
              paddingRight: segment.copyText === undefined ? 12 : 64
            },
            continuationFrameStyle(segment.semanticContinuation, radius)
          ]}
          testID="topic-code-frame"
        >
          <Text
            selectable
            style={{
              color: terminal ? '#d1d5db' : theme.ink,
              fontFamily: 'monospace',
              fontSize: Math.round((terminal ? 13 : 14) * settings.fontScale),
              lineHeight: Math.round((terminal ? 19 : 21) * settings.fontScale)
            }}
          >
            {codeRunNodes(segment.runs, query, theme.primarySoft)}
          </Text>
        </View>
      </TopicHorizontalScroll>
      {segment.copyText !== undefined ? (
        <Pressable
          accessibilityLabel="复制完整代码"
          accessibilityRole="button"
          android_ripple={androidRipple(theme.primarySoft)}
          hitSlop={12}
          style={{
            alignItems: 'center',
            backgroundColor: terminal ? '#1f2937' : theme.surface,
            borderColor: terminal ? 'rgba(255,255,255,0.2)' : theme.line,
            borderRadius: 6,
            borderWidth: StyleSheet.hairlineWidth,
            justifyContent: 'center',
            minHeight: 48,
            minWidth: 48,
            position: 'absolute',
            right: 4,
            top: 4
          }}
          onPress={copy}
        >
          <Text style={{ color: terminal ? '#e5e7eb' : theme.primaryStrong, fontSize: 12 }}>复制</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TerminalReportHeader({
  segment
}: {
  segment: Extract<CompiledForumContentSegment, { type: 'terminalReportHeader' }>;
}) {
  const { theme } = useReaderThemeStyles(createTopicStyles);
  const report = useTopicTerminalReport({ defaultTabId: segment.defaultTabId, semanticId: segment.semanticId });
  return (
    <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {segment.tabs.map((tab, index) => {
          const active = report.activeTabId === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityLabel={tab.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              android_ripple={androidRipple(theme.primarySoft)}
              style={{
                alignItems: 'center',
                backgroundColor: active ? theme.surface : theme.surface2,
                borderColor: theme.line,
                borderTopLeftRadius: index === 0 ? 8 : 0,
                borderTopRightRadius: index === segment.tabs.length - 1 ? 8 : 0,
                borderWidth: StyleSheet.hairlineWidth,
                justifyContent: 'center',
                marginRight: index === segment.tabs.length - 1 ? 0 : -StyleSheet.hairlineWidth,
                minHeight: 48,
                paddingHorizontal: 12,
                zIndex: active ? 2 : 1
              }}
              onPress={() => report.select(tab.id)}
            >
              <Text numberOfLines={1} style={{ color: active ? theme.primaryStrong : theme.ink, fontWeight: '700' }}>
                {tab.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function DisclosureHeader({
  segment
}: {
  segment: Extract<CompiledForumContentSegment, { type: 'disclosureHeader' }>;
}) {
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const disclosure = useTopicSplitDisclosure({
    defaultExpanded: segment.defaultExpanded,
    kind: segment.disclosureKind,
    semanticId: segment.semanticId
  });
  const visualPart = segment.hasBody && disclosure.expanded ? segment.semanticContinuation : 'only';
  if (segment.calloutType) {
    return (
      <ForumCallout
        boundarySpacing={[
          continuationFrameStyle(visualPart, 8),
          { marginBottom: visualPart === 'first' ? 0 : 12, paddingBottom: visualPart === 'first' ? 0 : 12 }
        ]}
        expanded={disclosure.expanded}
        fold={segment.fold}
        foldable={segment.hasBody}
        onExpandedChange={disclosure.toggle}
        theme={theme}
        title={
          <Text selectable style={styles.detailsPanelSummaryText}>
            {segment.titleLabel}
          </Text>
        }
        titleLabel={segment.titleLabel}
        type={segment.calloutType}
      />
    );
  }
  const StateIcon = disclosure.expanded ? ChevronDown : ChevronRight;
  return (
    <View style={[styles.detailsPanel, continuationFrameStyle(visualPart, 8)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: disclosure.expanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.detailsPanelHeader}
        onPress={disclosure.toggle}
      >
        <View style={styles.detailsPanelIcon}>
          <StateIcon size={18} color={theme.ink} strokeWidth={2.1} />
        </View>
        <View style={styles.detailsPanelSummary}>
          <Text selectable style={styles.detailsPanelSummaryText}>
            {segment.titleLabel}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function AncestorFrame({ children, frame }: { children: ReactNode; frame: ForumContentAncestorFrame }) {
  const { settings, styles, theme } = useReaderThemeStyles(createTopicStyles);
  if (frame.kind === 'terminalTab') {
    return (
      <View
        style={[
          {
            alignSelf: 'stretch',
            backgroundColor: theme.surface,
            borderColor: theme.line,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            marginBottom: frame.semanticContinuation === 'last' || frame.semanticContinuation === 'only' ? 12 : 0,
            padding: 8
          },
          continuationFrameStyle(frame.semanticContinuation, 8)
        ]}
        testID="topic-terminal-tab-panel"
      >
        {children}
      </View>
    );
  }
  if (frame.kind === 'list') {
    return (
      <View
        style={{
          marginBottom: frame.semanticContinuation === 'last' || frame.semanticContinuation === 'only' ? 10 : 0,
          marginTop: frame.semanticContinuation === 'first' || frame.semanticContinuation === 'only' ? 8 : 0
        }}
      >
        {children}
      </View>
    );
  }
  if (frame.kind === 'listItem') {
    const marker = frame.marker === undefined ? '•' : `${frame.marker}.`;
    return (
      <View
        style={{
          flexDirection: 'row',
          marginBottom: frame.semanticContinuation === 'last' || frame.semanticContinuation === 'only' ? 4 : 0
        }}
      >
        <Text
          selectable
          style={{
            color: theme.ink,
            fontSize: Math.round(16 * settings.fontScale),
            lineHeight: Math.round(24 * settings.fontScale),
            width: Math.round(28 * settings.fontScale)
          }}
        >
          {frame.semanticContinuation === 'first' || frame.semanticContinuation === 'only' ? marker : ''}
        </Text>
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
    );
  }
  if (frame.kind === 'callout') {
    const palette = forumCalloutPalette(frame.calloutType, theme);
    return (
      <View
        style={[
          {
            backgroundColor: palette.backgroundColor,
            borderColor: palette.borderColor,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            marginBottom: frame.semanticContinuation === 'last' || frame.semanticContinuation === 'only' ? 12 : 0,
            marginTop: 0,
            overflow: 'hidden',
            paddingBottom: 12,
            paddingLeft: 24,
            paddingRight: 12,
            paddingTop: 8
          },
          continuationFrameStyle(frame.semanticContinuation, 8)
        ]}
        testID="forum-callout-body"
      >
        {children}
      </View>
    );
  }
  if (frame.kind === 'details') {
    return (
      <View style={[styles.detailsPanel, continuationFrameStyle(frame.semanticContinuation, 8)]}>
        <View style={styles.detailsPanelBody}>{children}</View>
      </View>
    );
  }
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface2,
          borderColor: theme.line,
          borderRadius: 10,
          borderWidth: StyleSheet.hairlineWidth,
          marginBottom: 12,
          marginTop: 12,
          paddingHorizontal: 14,
          paddingVertical: 12
        },
        continuationFrameStyle(frame.semanticContinuation, 10)
      ]}
    >
      {children}
    </View>
  );
}

function wrapAncestorFrames(children: ReactNode, frames: readonly ForumContentAncestorFrame[]) {
  return [...frames].reverse().reduce<ReactNode>(
    (content, frame) => (
      <AncestorFrame key={`${frame.kind}:${frame.semanticId}`} frame={frame}>
        {content}
      </AncestorFrame>
    ),
    children
  );
}

const EMPTY_INLINE_IMAGE_IDENTITIES: Readonly<Record<string, boolean | undefined>> = {};
const defaultIsInlineSizedImage: NonNullable<TopicContentBlockProps['isInlineSizedImage']> = (
  url,
  _referrerPolicy,
  identities
) => Boolean(identities[url]);

function commonInteractiveAncestorFrames(segments: ForumContentSelectableRegion['segments']) {
  const first = segments[0]?.ancestorFrames || [];
  const last = segments.at(-1)?.ancestorFrames || [];
  return first.flatMap((frame) => {
    if (frame.kind !== 'callout' && frame.kind !== 'details' && frame.kind !== 'terminalTab') return [];
    if (
      !segments.every((segment) =>
        segment.ancestorFrames.some(
          (candidate) => candidate.kind === frame.kind && candidate.semanticId === frame.semanticId
        )
      )
    ) {
      return [];
    }
    const lastFrame = last.find(
      (candidate) => candidate.kind === frame.kind && candidate.semanticId === frame.semanticId
    );
    const starts = frame.semanticContinuation === 'first' || frame.semanticContinuation === 'only';
    const ends = lastFrame?.semanticContinuation === 'last' || lastFrame?.semanticContinuation === 'only';
    const semanticContinuation: ForumContentSemanticContinuation = starts
      ? ends
        ? 'only'
        : 'first'
      : ends
        ? 'last'
        : 'middle';
    return [{ ...frame, semanticContinuation }];
  });
}

export function TopicContentBlock({
  contentWidth,
  inlineSizedImageUrls = EMPTY_INLINE_IMAGE_IDENTITIES,
  isInlineSizedImage = defaultIsInlineSizedImage,
  onLinkPress,
  originalImageUpgradeEnabled = true,
  query = '',
  region,
  trimTrailingBlockSpacing = false
}: TopicContentBlockProps) {
  const { settings, theme } = useReaderThemeStyles(createTopicStyles);
  const renderEngine = useAmbientTRenderEngine();
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = Math.round(16 * settings.fontScale);
  const lineHeight = Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight));
  const tableSemanticIds = useMemo(
    () =>
      region.kind === 'selectable'
        ? region.segments.flatMap((segment) => (segment.type === 'table' ? [segment.semanticId] : []))
        : [],
    [region]
  );
  const nativeTableScroll = useTopicNativeTableScroll(tableSemanticIds);
  const nativeContent = useMemo(
    () =>
      region.kind === 'selectable'
        ? buildForumSelectionDocument({
            contentWidth,
            engine: renderEngine,
            fontScale: settings.fontScale,
            inlineSizedImageUrls,
            isInlineSizedImage,
            region,
            tableOffsets: nativeTableScroll.offsets,
            tableScrollKeys: nativeTableScroll.scrollKeys,
            trimTrailingBlockSpacing
          })
        : null,
    [
      contentWidth,
      inlineSizedImageUrls,
      isInlineSizedImage,
      nativeTableScroll.offsets,
      nativeTableScroll.scrollKeys,
      region,
      renderEngine,
      settings.fontScale,
      trimTrailingBlockSpacing
    ]
  );
  const nativeDocument = useMemo(() => (nativeContent ? JSON.stringify(nativeContent.document) : ''), [nativeContent]);
  const layoutKey = useMemo(
    () =>
      `${region.keySuffix}:${contentWidth}:${fontFamily || ''}:${fontSize}:${lineHeight}:${nativeDocument.length}:${stableTextHash(nativeDocument)}`,
    [contentWidth, fontFamily, fontSize, lineHeight, nativeDocument, region.keySuffix]
  );
  const initialSurfaceHeight = nativeContent
    ? nativeContent.media.reduce(
        (height, media) => (media.display === 'block' ? Math.max(height, media.height || 0) : height),
        lineHeight
      )
    : lineHeight;
  const [measuredSurface, setMeasuredSurface] = useState<{ height: number; layoutKey: string } | null>(null);
  const surfaceHeight = measuredSurface?.layoutKey === layoutKey ? measuredSurface.height : initialSurfaceHeight;
  const handleContentSizeChange = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<ForumSelectionContentSizeEvent>) => {
      if (nativeEvent.layoutKey !== layoutKey || !Number.isFinite(nativeEvent.height) || nativeEvent.height < 0) {
        return;
      }
      setMeasuredSurface((current) =>
        current?.layoutKey === layoutKey && current.height === nativeEvent.height
          ? current
          : { height: nativeEvent.height, layoutKey }
      );
    },
    [layoutKey]
  );

  if (region.kind === 'selectable' && nativeContent) {
    const surface = (
      <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
        <NativeForumSelectionSurface
          content={nativeDocument}
          contentWidth={contentWidth}
          fallbackText={region.fallbackText}
          fontFamily={fontFamily}
          fontSize={fontSize}
          highlightColor={theme.primarySoft}
          layoutKey={layoutKey}
          lineColor={theme.line}
          lineHeight={lineHeight}
          linkColor={theme.primaryStrong}
          query={query}
          style={{ alignSelf: 'stretch', height: surfaceHeight }}
          testID="native-forum-selection-surface"
          textColor={theme.ink}
          onContentSizeChange={handleContentSizeChange}
          onLinkPress={(event: NativeSyntheticEvent<ForumSelectionLinkEvent>) => onLinkPress?.(event.nativeEvent.href)}
          onTableScroll={(event: NativeSyntheticEvent<ForumSelectionTableScrollEvent>) => {
            nativeTableScroll.onTableScroll(event.nativeEvent.semanticId, event.nativeEvent.offset);
          }}
        >
          {nativeContent.media.map((media, index) => (
            <View
              key={`${region.keySuffix}:media:${index}`}
              style={
                media.display === 'inline'
                  ? { height: media.height, left: 0, position: 'absolute', top: 0, width: media.width }
                  : { left: 0, position: 'absolute', top: 0, width: contentWidth }
              }
            >
              <TopicContentPresentationProvider continuation="middle">
                <TNodeRenderer renderIndex={index} renderLength={nativeContent.media.length} tnode={media.tnode} />
              </TopicContentPresentationProvider>
            </View>
          ))}
        </NativeForumSelectionSurface>
      </OriginalImageUpgradeBoundary>
    );
    return <>{wrapAncestorFrames(surface, commonInteractiveAncestorFrames(region.segments))}</>;
  }

  if (region.kind === 'selectable') return null;
  const segment = region.segment;
  let content: ReactNode;
  if (segment.type === 'codeBlock') {
    content = <CodeBlock contentWidth={contentWidth} query={query} segment={segment} />;
  } else if (segment.type === 'disclosureHeader') {
    content = <DisclosureHeader segment={segment} />;
  } else if (segment.type === 'terminalReportHeader') {
    content = <TerminalReportHeader segment={segment} />;
  } else if ('html' in segment) {
    content = (
      <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
        <RenderHTMLSource contentWidth={contentWidth} source={{ html: segment.html }} />
      </OriginalImageUpgradeBoundary>
    );
  } else return null;
  return <>{wrapAncestorFrames(content, segment.ancestorFrames)}</>;
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
