import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { TChildrenRenderer, type CustomBlockRenderer } from 'react-native-render-html';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { FORUM_TERMINAL_REPORT_TAG, FORUM_TERMINAL_TAB_TAG } from '@/domain/forum/html';

function domText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { children?: unknown; data?: unknown };
  const ownText = typeof record.data === 'string' ? record.data : '';
  const childText = Array.isArray(record.children) ? record.children.map(domText).join('') : '';
  return `${ownText}${childText}`;
}

export function tnodeText(tnode: unknown) {
  return (domText(tnode) || domText((tnode as { domNode?: unknown }).domNode)).replace(/\u00a0/g, ' ').trim();
}

function terminalNodeAttribute(node: unknown, name: string) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as {
    attribs?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    getAttribute?: (name: string) => unknown;
  };
  return String(record.attributes?.[name] || record.attribs?.[name] || record.getAttribute?.(name) || '');
}

function terminalNodeChildren(node: unknown) {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const record = node as { childNodes?: unknown[]; children?: unknown[] };
  return Array.isArray(record.childNodes) ? record.childNodes : Array.isArray(record.children) ? record.children : [];
}

export function terminalNodeTagName(node: unknown) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { name?: unknown; tagName?: unknown };
  return String(record.tagName || record.name || '').toLowerCase();
}

export function terminalNodeHasClass(node: unknown, className: string) {
  return terminalNodeAttribute(node, 'class').split(/\s+/).includes(className);
}

function terminalTextStyle(tnode: unknown) {
  const style = terminalNodeAttribute(tnode, 'style');
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1].trim();
  const backgroundColor = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i)?.[1].trim();
  return {
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {})
  };
}

function terminalTextChildren(tnode: unknown, key: string, style: TextStyle = {}): ReactNode[] {
  if (!tnode || typeof tnode !== 'object') {
    return [];
  }
  const record = tnode as { children?: unknown; data?: unknown; tagName?: unknown; type?: unknown };
  if (record.type === 'text') {
    const text = typeof record.data === 'string' ? record.data : '';
    return text
      ? [
          Object.keys(style).length ? (
            <Text key={key} style={style}>
              {text}
            </Text>
          ) : (
            text
          )
        ]
      : [];
  }
  if (terminalNodeTagName(tnode) === 'br') {
    return ['\n'];
  }
  const nextStyle = { ...style, ...terminalTextStyle(tnode) };
  return terminalNodeChildren(tnode).flatMap((child, index) =>
    terminalTextChildren(child, `${key}.${index}`, nextStyle)
  );
}

const terminalStyles = StyleSheet.create({
  report: {
    alignSelf: 'stretch',
    marginBottom: 12,
    marginTop: 8
  },
  tabRow: {
    paddingBottom: 0,
    paddingHorizontal: 0
  },
  tabButton: {
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: -StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    zIndex: 1
  },
  tabButtonFirst: {
    borderTopLeftRadius: 8
  },
  tabButtonLast: {
    borderTopRightRadius: 8,
    marginRight: 0
  },
  tabButtonActive: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: -StyleSheet.hairlineWidth,
    zIndex: 2
  },
  tabButtonInactive: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18
  },
  contentPanel: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderTopLeftRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: -StyleSheet.hairlineWidth,
    padding: 8
  },
  codePanel: {
    alignSelf: 'stretch',
    backgroundColor: '#111827',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
    marginTop: 0,
    padding: 12
  },
  codeText: {
    color: '#d1d5db',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19
  }
});

export function createTerminalRenderers(theme: ReaderTheme): HtmlRenderers {
  const TerminalReportRenderer: CustomBlockRenderer = (props) => {
    const tabNodes = props.tnode.children.filter(
      (child) => String((child as { tagName?: unknown }).tagName || '').toLowerCase() === FORUM_TERMINAL_TAB_TAG
    );
    const [activeIndex, setActiveIndex] = useState(0);
    if (!tabNodes.length) {
      return <TChildrenRenderer tchildren={props.tnode.children} />;
    }
    const activeTab = tabNodes[Math.min(activeIndex, tabNodes.length - 1)];
    return (
      <View style={terminalStyles.report}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={terminalStyles.tabRow}>
          {tabNodes.map((tabNode, index) => {
            const title = String(
              (tabNode as { attributes?: Record<string, string | undefined> }).attributes?.title || `Tab ${index + 1}`
            );
            const active = index === activeIndex;
            return (
              <Pressable
                key={`${title}:${index}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`切换到${title}`}
                android_ripple={androidRipple(theme.primarySoft)}
                style={[
                  terminalStyles.tabButton,
                  index === 0 ? terminalStyles.tabButtonFirst : null,
                  index === tabNodes.length - 1 ? terminalStyles.tabButtonLast : null,
                  active ? terminalStyles.tabButtonActive : terminalStyles.tabButtonInactive,
                  {
                    backgroundColor: active ? theme.surface : theme.surface2,
                    borderColor: theme.line,
                    borderBottomColor: active ? theme.surface : theme.line
                  }
                ]}
                onPress={() => setActiveIndex(index)}
              >
                <Text
                  numberOfLines={1}
                  style={[terminalStyles.tabText, { color: active ? theme.primaryStrong : theme.ink }]}
                >
                  {title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[terminalStyles.contentPanel, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <TChildrenRenderer tchildren={(activeTab as { children?: typeof props.tnode.children }).children || []} />
        </View>
      </View>
    );
  };

  const TerminalDivRenderer: CustomBlockRenderer = (props) => {
    const className = String(props.tnode.attributes?.class || '');
    if (!className.split(/\s+/).includes('forum-terminal-code')) {
      const { InternalRenderer, ...internalRendererProps } = props;
      return <InternalRenderer {...internalRendererProps} />;
    }
    const textChildren = terminalTextChildren(
      (props.tnode as { domNode?: unknown }).domNode || props.tnode,
      'terminal'
    );
    return (
      <View style={terminalStyles.codePanel}>
        <ScrollView horizontal>
          <Text selectable style={terminalStyles.codeText}>
            {textChildren.length ? textChildren : tnodeText(props.tnode)}
          </Text>
        </ScrollView>
      </View>
    );
  };
  return {
    div: TerminalDivRenderer,
    [FORUM_TERMINAL_REPORT_TAG]: TerminalReportRenderer
  };
}
