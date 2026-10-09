import { memo, type ReactNode, useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  type ViewStyle,
  type ViewProps
} from 'react-native';
import { Copy } from 'lucide-react-native';
import { RenderHTMLSource } from 'react-native-render-html';
import type {
  CompiledForumContentRow,
  ForumCodeTextRun,
  ForumContentAncestorFrame,
  ForumContentPart
} from '@/domain/forum/topicContentSplit';
import { ForumCallout, forumCalloutPalette } from '@/ui/content/ForumCallout';
import { fontFamilyValue, lineHeightMultiplier } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from '../styles';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';
import { useTopicSplitDisclosure, useTopicTerminalReport } from '../rendering/TopicSplitDisclosure';
import { TopicHorizontalScroll, TopicTableSemanticBoundary } from '../rendering/topicTableRenderers';
import { useTopicSelectionRowActive } from '../selection/TopicSelectionSurface';
import { ForumContentWidthBoundary, useForumContentWidth } from '@/ui/content/ForumContentWidth';
import { DisclosureChevron } from '@/ui/controls/ExpandableControls';

export type TopicRenderableContentRow = Exclude<CompiledForumContentRow, { type: 'poll' | 'quote' }>;

type TopicContentBlockProps = {
  contentWidth: number;
  html?: string;
  query?: string;
  row: TopicRenderableContentRow;
  selectable?: boolean;
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
  row,
  selectable
}: {
  contentWidth: number;
  query: string;
  row: Extract<CompiledForumContentRow, { type: 'codeBlock' }>;
  selectable: boolean;
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
      style={[
        {
          backgroundColor: terminal ? '#111827' : theme.surface2,
          borderColor: terminal ? 'rgba(255,255,255,0.16)' : theme.line,
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          marginBottom: terminal ? 12 : 10,
          marginTop: terminal ? 12 : 10,
          overflow: 'hidden'
        },
        continuationFrameStyle(row.part, radius)
      ]}
    >
      {row.copyText !== undefined ? (
        <View
          style={{
            alignItems: 'center',
            borderBottomColor: terminal ? 'rgba(255,255,255,0.16)' : theme.line,
            borderBottomWidth: StyleSheet.hairlineWidth,
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingLeft: 12
          }}
        >
          <Text
            style={{
              color: terminal ? '#9ca3af' : theme.muted,
              fontFamily: fontFamilyValue(settings.fontFamily),
              fontSize: Math.round(12 * settings.fontScale),
              lineHeight: Math.round(18 * settings.fontScale)
            }}
          >
            {terminal ? '终端' : '代码'}
          </Text>
          <Pressable
            accessibilityLabel="复制完整代码"
            accessibilityRole="button"
            hitSlop={12}
            style={{ alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 48 }}
            onPress={copy}
          >
            <Copy color={terminal ? '#e5e7eb' : theme.muted} size={17} strokeWidth={1.8} />
          </Pressable>
        </View>
      ) : null}
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
          style={{
            minWidth: contentWidth,
            paddingHorizontal: terminal ? 14 : 12,
            paddingTop: row.part === 'first' || row.part === 'only' ? 12 : 0,
            paddingBottom: row.part === 'last' || row.part === 'only' ? 12 : 0
          }}
          testID="topic-code-frame"
        >
          <Text
            selectable={selectable}
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
    </View>
  );
}

function TerminalReportHeader({ row }: { row: Extract<CompiledForumContentRow, { type: 'terminalReportHeader' }> }) {
  const { theme } = useReaderThemeStyles(createTopicStyles);
  const report = useTopicTerminalReport({ defaultTabId: row.defaultTabId, semanticId: row.semanticId });
  return (
    <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
      <ScrollView overScrollMode="never" horizontal showsHorizontalScrollIndicator={false}>
        {row.tabs.map((tab, index) => {
          const active = report.activeTabId === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityLabel={tab.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
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

function DisclosureHeader({
  row,
  selectable
}: {
  row: Extract<CompiledForumContentRow, { type: 'disclosureHeader' }>;
  selectable: boolean;
}) {
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
          <Text selectable={selectable} style={styles.detailsPanelSummaryText}>
            {row.titleLabel}
          </Text>
        }
        titleLabel={row.titleLabel}
        type={row.calloutType}
      />
    );
  }
  return (
    <View style={[styles.detailsPanel, continuationFrameStyle(visualPart, 8)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: disclosure.expanded }}
        style={styles.detailsPanelHeader}
        onPress={disclosure.toggle}
      >
        <View style={styles.detailsPanelIcon}>
          <DisclosureChevron expanded={disclosure.expanded} color={theme.muted} />
        </View>
        <View style={styles.detailsPanelSummary}>
          <Text selectable={selectable} style={styles.detailsPanelSummaryText}>
            {row.titleLabel}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function ContentFrame({ children, style, ...props }: ViewProps) {
  const width = useForumContentWidth();
  const box = StyleSheet.flatten(style) || {};
  const left =
    Number(box.paddingLeft ?? box.paddingHorizontal ?? box.padding ?? 0) +
    Number(box.borderLeftWidth ?? box.borderWidth ?? 0);
  const right =
    Number(box.paddingRight ?? box.paddingHorizontal ?? box.padding ?? 0) +
    Number(box.borderRightWidth ?? box.borderWidth ?? 0);
  return (
    <View {...props} style={style}>
      <ForumContentWidthBoundary width={Math.max(1, width - left - right)}>{children}</ForumContentWidthBoundary>
    </View>
  );
}

function AncestorFrame({ children, frame }: { children: ReactNode; frame: ForumContentAncestorFrame }) {
  const { settings, styles, theme } = useReaderThemeStyles(createTopicStyles);
  const contentWidth = useForumContentWidth();
  if (frame.kind === 'terminalTab') {
    return (
      <ContentFrame
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
      </ContentFrame>
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
          style={{
            color: theme.ink,
            fontSize: Math.round(16 * settings.fontScale),
            lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight)),
            width: Math.round(28 * settings.fontScale)
          }}
        >
          {frame.part === 'first' || frame.part === 'only' ? marker : ''}
        </Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ForumContentWidthBoundary width={Math.max(1, contentWidth - Math.round(28 * settings.fontScale))}>
            {children}
          </ForumContentWidthBoundary>
        </View>
      </View>
    );
  }
  if (frame.kind === 'callout') {
    const palette = forumCalloutPalette(frame.calloutType, theme);
    return (
      <ContentFrame
        style={[
          {
            backgroundColor: palette.backgroundColor,
            borderColor: palette.borderColor,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            marginBottom: frame.part === 'last' || frame.part === 'only' ? 12 : 0,
            marginTop: 0,
            overflow: 'hidden',
            paddingBottom: frame.part === 'last' || frame.part === 'only' ? 12 : 0,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 0
          },
          continuationFrameStyle(frame.part, 8)
        ]}
        testID="forum-callout-body"
      >
        {children}
      </ContentFrame>
    );
  }
  if (frame.kind === 'details') {
    return (
      <ContentFrame style={[styles.detailsPanel, continuationFrameStyle(frame.part, 8)]}>
        <ContentFrame
          style={[styles.detailsPanelBody, { paddingBottom: frame.part === 'last' || frame.part === 'only' ? 10 : 0 }]}
        >
          {children}
        </ContentFrame>
      </ContentFrame>
    );
  }
  return (
    <ContentFrame
      style={{
        borderLeftColor: theme.lineStrong,
        borderLeftWidth: 2,
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
    </ContentFrame>
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

function ContentLeaf({ html, query = '', row, selectable, trimTrailingBlockSpacing = false }: TopicContentBlockProps) {
  const contentWidth = useForumContentWidth();
  const topicSelectionActive = useTopicSelectionRowActive();
  const textSelectable = selectable ?? !topicSelectionActive;
  const source = useMemo(() => ({ html: html ?? ('html' in row ? row.html : '') }), [html, row]);
  let content: ReactNode;
  if (row.type === 'codeBlock') {
    content = <CodeBlock contentWidth={contentWidth} query={query} row={row} selectable={textSelectable} />;
  } else if (row.type === 'disclosureHeader') {
    content = <DisclosureHeader row={row} selectable={textSelectable} />;
  } else if (row.type === 'terminalReportHeader') {
    content = <TerminalReportHeader row={row} />;
  } else {
    const rendered = (
      <TopicContentPresentationProvider continuation={row.part} trimTrailing={trimTrailingBlockSpacing}>
        <RenderHTMLSource contentWidth={contentWidth} source={source} />
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
  return <>{content}</>;
}

export function TopicContentBlock(props: TopicContentBlockProps) {
  return (
    <ForumContentWidthBoundary width={props.contentWidth}>
      {wrapAncestorFrames(<ContentLeaf {...props} />, props.row.ancestorFrames)}
    </ForumContentWidthBoundary>
  );
}

export const MemoizedTopicContentBlock = memo(TopicContentBlock);
