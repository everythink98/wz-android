import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import Bug from 'lucide-react-native/icons/bug';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleHelp from 'lucide-react-native/icons/circle-question-mark';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Flame from 'lucide-react-native/icons/flame';
import Lightbulb from 'lucide-react-native/icons/lightbulb';
import List from 'lucide-react-native/icons/list';
import Quote from 'lucide-react-native/icons/quote';
import SquarePen from 'lucide-react-native/icons/square-pen';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';
import Zap from 'lucide-react-native/icons/zap';

import {
  DISCOURSE_CALLOUT_REGISTRY,
  type DiscourseCalloutTone,
  type DiscourseCalloutType
} from '@/domain/forum/callouts';
import { alphaColor, type ReaderTheme } from '@/ui/theme/tokens';

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
  boundarySpacing,
  expanded,
  foldable,
  onExpandedChange,
  theme,
  title,
  titleLabel,
  type
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  expanded: boolean;
  foldable: boolean;
  onExpandedChange: (expanded: boolean) => void;
  theme: ReaderTheme;
  title: ReactNode;
  titleLabel: string;
  type: DiscourseCalloutType;
}) {
  const palette = forumCalloutPalette(type, theme);
  const Icon = CALLOUT_ICONS[type];
  const FoldIcon = expanded ? ChevronDown : ChevronRight;
  const toggleExpanded = () => onExpandedChange(!expanded);
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
      style={[calloutStyles.callout, palette, boundarySpacing]}
      testID="forum-callout"
    >
      {foldable ? (
        <Pressable
          accessibilityLabel={titleLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={[calloutStyles.header, calloutStyles.foldableHeader]}
          onPress={toggleExpanded}
        >
          {header}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={titleLabel} accessibilityRole="header" style={calloutStyles.header}>
          {header}
        </View>
      )}
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
  }
});
