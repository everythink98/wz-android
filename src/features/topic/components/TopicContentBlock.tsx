import { memo, type ReactNode, useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View, type ViewStyle } from 'react-native';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react-native';
import { RenderHTMLSource } from 'react-native-render-html';
import type {
  CompiledForumContentRow,
  ForumCodeTextRun,
  ForumContentAncestorFrame,
  ForumContentPart
} from '@/domain/forum/topicContentSplit';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import { ForumCallout, forumCalloutPalette } from '@/ui/content/ForumCallout';
import { androidRipple, lineHeightMultiplier } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from '../styles';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';
import { useTopicSplitDisclosure, useTopicTerminalReport } from '../rendering/TopicSplitDisclosure';
import { TopicHorizontalScroll, TopicTableSemanticBoundary } from '../rendering/topicTableRenderers';

export type TopicRenderableContentRow = Exclude<CompiledForumContentRow, { type: 'poll' | 'quote' }>;

type TopicContentBlockProps = {
  contentWidth: number;
  html?: string;
  originalImageUpgradeEnabled?: boolean;
  query?: string;
  row: TopicRenderableContentRow;
  trimTrailingBlockSpacing?: boolean;
};

function continuationFrameStyle(part: ForumContentPart, radius: number): ViewStyle {
  if (part === 'only') {
    return {
      borderBottomLeftRadius: radius,
      borderBottomRightRadius: radius,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      borderTopWidth: StyleSheet.hairlineWidth
    };
  }
  return {
    borderBottomLeftRadius: part === 'last' ? radius : 0,
    borderBottomRightRadius: part === 'last' ? radius : 0,
    borderBottomWidth: part === 'last' ? StyleSheet.hairlineWidth : 0,
    borderTopLeftRadius: part === 'first' ? radius : 0,
    borderTopRightRadius: part === 'first' ? radius : 0,
    borderTopWidth: part === 'first' ? StyleSheet.hairlineWidth : 0,
    marginBottom: part === 'first' || part === 'middle' ? 0 : undefined,
    marginTop: part === 'middle' || part === 'last' ? 0 : undefined
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
  row
}: {
  contentWidth: number;
  query: string;
  row: Extract<CompiledForumContentRow, { type: 'codeBlock' }>;
}) {
  const { settings, theme } = useReaderThemeStyles(createTopicStyles);
  const terminal = row.variant === 'terminal';
  const radius = terminal ? 10 : 8;
  const copy = () => {
    if (row.copyText === undefined) return;
    void Clipboard.setStringAsync(row.copyText)
      .then(() => ToastAndroid.show('代码已复制', ToastAndroid.SHORT))
      .catch(() => ToastAndroid.show('复制失败', ToastAndroid.SHORT));
  };
  return (
    <View
      style={{
        marginBottom: row.part === 'first' || row.part === 'middle' ? 0 : terminal ? 12 : 10,
        marginTop: row.part === 'middle' || row.part === 'last' ? 0 : terminal ? 12 : 10
      }}
    >
      <TopicHorizontalScroll
        accessibilityHint="横向滑动查看完整代码"
        accessibilityLabel="代码块"
        contentContainerStyle={{ minWidth: contentWidth }}
        semanticId={row.semanticId}
        showsHorizontalScrollIndicator={row.part === 'only' || row.part === 'last'}
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
              padding: terminal ? 14 : 12,
              paddingRight: row.copyText === undefined ? (terminal ? 14 : 12) : 68
            },
            continuationFrameStyle(row.part, radius)
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
            {codeRunNodes(row.runs, query, theme.primarySoft)}
          </Text>
        </View>
      </TopicHorizontalScroll>
      {row.copyText !== undefined ? (
        <Pressable
          accessibilityLabel="复制完整代码"
          accessibilityRole="button"
          android_ripple={androidRipple(theme.primarySoft)}
          hitSlop={12}
          style={{
            alignItems: 'center',
            backgroundColor: terminal ? '#1f2937' : theme.surface,
            borderColor: terminal ? 'rgba(255,255,255,0.2)' : theme.line,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            justifyContent: 'center',
            minHeight: 48,
            minWidth: 48,
            position: 'absolute',
            right: 6,
            top: 6
          }}
          onPress={copy}
        >
          <Copy color={terminal ? '#e5e7eb' : theme.muted} size={18} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TerminalReportHeader({ row }: { row: Extract<CompiledForumContentRow, { type: 'terminalReportHeader' }> }) {
  const { theme } = useReaderThemeStyles(createTopicStyles);
  const report = useTopicTerminalReport({ defaultTabId: row.defaultTabId, semanticId: row.semanticId });
  return (
    <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {row.tabs.map((tab, index) => {
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
                borderTopRightRadius: index === row.tabs.length - 1 ? 8 : 0,
                borderWidth: StyleSheet.hairlineWidth,
                justifyContent: 'center',
                marginRight: index === row.tabs.length - 1 ? 0 : -StyleSheet.hairlineWidth,
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

function DisclosureHeader({ row }: { row: Extract<CompiledForumContentRow, { type: 'disclosureHeader' }> }) {
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const disclosure = useTopicSplitDisclosure({
    defaultExpanded: row.defaultExpanded,
    kind: row.disclosureKind,
    semanticId: row.semanticId
  });
  const visualPart = row.hasBody && disclosure.expanded ? row.part : 'only';
  if (row.calloutType) {
    return (
      <ForumCallout
        boundarySpacing={[
          continuationFrameStyle(visualPart, 8),
          { marginBottom: visualPart === 'first' ? 0 : 12, paddingBottom: visualPart === 'first' ? 0 : 12 }
        ]}
        expanded={disclosure.expanded}
        foldable={row.hasBody}
        onExpandedChange={disclosure.toggle}
        theme={theme}
        title={
          <Text selectable style={styles.detailsPanelSummaryText}>
            {row.titleLabel}
          </Text>
        }
        titleLabel={row.titleLabel}
        type={row.calloutType}
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
            {row.titleLabel}
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
            marginBottom: frame.part === 'last' || frame.part === 'only' ? 12 : 0,
            padding: 8
          },
          continuationFrameStyle(frame.part, 8)
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
          marginBottom: frame.part === 'last' || frame.part === 'only' ? 10 : 0,
          marginTop: frame.part === 'first' || frame.part === 'only' ? 6 : 0
        }}
      >
        {children}
      </View>
    );
  }
  if (frame.kind === 'listItem') {
    const marker = frame.marker === undefined ? '•' : `${frame.marker}.`;
    return (
      <View style={{ flexDirection: 'row', marginBottom: frame.part === 'last' || frame.part === 'only' ? 2 : 0 }}>
        <Text
          selectable
          style={{
            color: theme.ink,
            fontSize: Math.round(16 * settings.fontScale),
            lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight)),
            width: Math.round(28 * settings.fontScale)
          }}
        >
          {frame.part === 'first' || frame.part === 'only' ? marker : ''}
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
            marginBottom: frame.part === 'last' || frame.part === 'only' ? 12 : 0,
            marginTop: 0,
            overflow: 'hidden',
            paddingBottom: 12,
            paddingLeft: 24,
            paddingRight: 12,
            paddingTop: 8
          },
          continuationFrameStyle(frame.part, 8)
        ]}
        testID="forum-callout-body"
      >
        {children}
      </View>
    );
  }
  if (frame.kind === 'details') {
    return (
      <View style={[styles.detailsPanel, continuationFrameStyle(frame.part, 8)]}>
        <View style={styles.detailsPanelBody}>{children}</View>
      </View>
    );
  }
  return (
    <View
      style={{
        borderLeftColor: theme.lineStrong,
        borderLeftWidth: 3,
        marginBottom: frame.part === 'last' || frame.part === 'only' ? 10 : 0,
        marginTop: frame.part === 'first' || frame.part === 'only' ? 10 : 0,
        paddingBottom: frame.part === 'last' || frame.part === 'only' ? 2 : 0,
        paddingLeft: 12,
        paddingRight: 4,
        paddingTop: frame.part === 'first' || frame.part === 'only' ? 2 : 0
      }}
      testID="topic-blockquote-frame"
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

export function TopicContentBlock({
  contentWidth,
  html,
  originalImageUpgradeEnabled = true,
  query = '',
  row,
  trimTrailingBlockSpacing = false
}: TopicContentBlockProps) {
  const source = useMemo(() => ({ html: html ?? ('html' in row ? row.html : '') }), [html, row]);
  let content: ReactNode;
  if (row.type === 'codeBlock') {
    content = <CodeBlock contentWidth={contentWidth} query={query} row={row} />;
  } else if (row.type === 'disclosureHeader') {
    content = <DisclosureHeader row={row} />;
  } else if (row.type === 'terminalReportHeader') {
    content = <TerminalReportHeader row={row} />;
  } else {
    const rendered = (
      <TopicContentPresentationProvider continuation={row.part} trimTrailing={trimTrailingBlockSpacing}>
        <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
          <RenderHTMLSource contentWidth={contentWidth} source={source} />
        </OriginalImageUpgradeBoundary>
      </TopicContentPresentationProvider>
    );
    content =
      row.type === 'table' ? (
        <TopicTableSemanticBoundary columns={row.columns} part={row.part} semanticId={row.semanticId}>
          {rendered}
        </TopicTableSemanticBoundary>
      ) : (
        rendered
      );
  }
  return <>{wrapAncestorFrames(content, row.ancestorFrames)}</>;
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
