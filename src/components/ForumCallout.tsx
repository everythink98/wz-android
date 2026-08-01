import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Flame,
  Lightbulb,
  List,
  Quote,
  SquarePen,
  TriangleAlert,
  X,
  Zap
} from 'lucide-react-native';

import {
  DISCOURSE_CALLOUT_REGISTRY,
  type DiscourseCalloutFold,
  type DiscourseCalloutTone,
  type DiscourseCalloutType
} from '@/discourseContent';
import { alphaColor, androidRipple, type ReaderTheme } from '@/theme';

export const FORUM_CALLOUT_TRANSITION_MS = 100;

const CALLOUT_LAYOUT = LinearTransition.duration(FORUM_CALLOUT_TRANSITION_MS).reduceMotion(ReduceMotion.System);

const CALLOUT_ICONS = {
  note: SquarePen,
  abstract: ClipboardList,
  info: Lightbulb,
  todo: CircleCheck,
  tip: Flame,
  success: Check,
  question: CircleHelp,
  warning: TriangleAlert,
  failure: X,
  danger: Zap,
  bug: Bug,
  example: List,
  quote: Quote
} satisfies Record<DiscourseCalloutType, typeof SquarePen>;

function toneColor(tone: DiscourseCalloutTone, theme: ReaderTheme) {
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  if (tone === 'muted') return theme.muted;
  return theme.primary;
}

export function forumCalloutPalette(type: DiscourseCalloutType, theme: ReaderTheme) {
  const color = toneColor(DISCOURSE_CALLOUT_REGISTRY[type].tone, theme);
  return {
    backgroundColor: alphaColor(color, theme.dark ? 0.16 : 0.1),
    borderColor: alphaColor(color, theme.dark ? 0.36 : 0.28),
    color
  };
}

export function ForumCallout({
  body,
  fold,
  theme,
  title,
  titleLabel,
  trimTrailingBlockSpacing = false,
  type
}: {
  body?: ReactNode;
  fold?: DiscourseCalloutFold;
  theme: ReaderTheme;
  title: ReactNode;
  titleLabel: string;
  trimTrailingBlockSpacing?: boolean;
  type: DiscourseCalloutType;
}) {
  const [expanded, setExpanded] = useState(fold !== 'collapsed');
  const foldable = body !== undefined && body !== null && fold !== undefined;
  const bodyVisible = Boolean(body) && (!foldable || expanded);
  const palette = forumCalloutPalette(type, theme);
  const Icon = CALLOUT_ICONS[type];
  const FoldIcon = expanded ? ChevronDown : ChevronRight;
  const header = (
    <>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={calloutStyles.icon}
        testID="forum-callout-icon"
      >
        <Icon accessible={false} color={palette.color} size={20} strokeWidth={2.2} />
      </View>
      <View style={calloutStyles.title}>{title}</View>
      {foldable ? <FoldIcon accessible={false} color={palette.color} size={18} strokeWidth={2.1} /> : null}
    </>
  );

  return (
    <Animated.View
      layout={CALLOUT_LAYOUT}
      style={[calloutStyles.callout, palette, trimTrailingBlockSpacing ? calloutStyles.trimTrailing : null]}
      testID="forum-callout"
    >
      {foldable ? (
        <Pressable
          accessibilityLabel={titleLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          android_ripple={androidRipple(palette.borderColor)}
          style={[calloutStyles.header, calloutStyles.foldableHeader]}
          onPress={() => setExpanded((value) => !value)}
        >
          {header}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={titleLabel} accessibilityRole="header" style={calloutStyles.header}>
          {header}
        </View>
      )}
      {bodyVisible ? <View style={calloutStyles.body}>{body}</View> : null}
    </Animated.View>
  );
}

const calloutStyles = StyleSheet.create({
  callout: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden',
    paddingBottom: 12,
    paddingLeft: 24,
    paddingRight: 12,
    paddingTop: 12
  },
  trimTrailing: {
    marginBottom: -4
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  foldableHeader: {
    minHeight: 48
  },
  icon: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  title: {
    flex: 1,
    minWidth: 0
  },
  body: {
    marginTop: 8
  }
});
