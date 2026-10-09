import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Bug,
  Check,
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
  type DiscourseCalloutTone,
  type DiscourseCalloutType
} from '@/domain/forum/callouts';
import { alphaColor, type ReaderTheme } from '@/ui/theme/tokens';
import { DisclosureChevron } from '@/ui/controls/ExpandableControls';

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
    backgroundColor: alphaColor(color, theme.dark ? 0.12 : 0.08),
    borderColor: alphaColor(color, theme.dark ? 0.28 : 0.22),
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
      {foldable ? <DisclosureChevron expanded={expanded} color={palette.color} /> : null}
    </>
  );

  return (
    <View style={[calloutStyles.callout, palette, boundarySpacing]} testID="forum-callout">
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
    </View>
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
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4
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
