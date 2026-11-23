import { StyleSheet } from 'react-native';
import {
  createReaderFontSizer,
  createUiFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  fontFamilyValue,
  textSizeStyle,
  topicListSpacing
} from '@/ui/theme/tokens';

export function createUserStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = createReaderFontSizer(settings);
  const densityPadding = topicListSpacing[settings.listDensity].padding;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.surface;
  const uiFontSize = createUiFontSizer(settings);
  const uiFontFamily = fontFamilyValue(settings.uiFontFamily);
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
      padding: 16
    },
    articleTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(20), fontSize(28)),
      fontWeight: '700'
    },
    cardTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(16), fontSize(23)),
      fontWeight: '500',
      letterSpacing: 0
    },
    content: {
      flex: 1
    },
    errorBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      color: theme.danger,
      fontFamily: uiFontFamily,
      ...textSizeStyle(uiFontSize(13), uiFontSize(19))
    },
    excerpt: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(18))
    },
    meta: {
      color: theme.muted,
      fontFamily: uiFontFamily,
      ...textSizeStyle(uiFontSize(12), uiFontSize(18))
    },
    bioSection: {
      gap: 4
    },
    bioTextContainer: {
      minWidth: 0,
      position: 'relative'
    },
    bio: {
      color: theme.ink,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(14), fontSize(21))
    },
    bioMeasure: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      opacity: 0
    },
    bioToggle: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 3,
      justifyContent: 'center',
      minHeight: 36,
      paddingVertical: 4
    },
    bioToggleText: {
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: uiFontFamily,
      ...textSizeStyle(uiFontSize(12)),
      fontWeight: '600'
    },
    profileActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      marginLeft: 'auto'
    },
    profileFooter: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    followTouchSlot: {
      minHeight: 48,
      minWidth: 48,
      justifyContent: 'center'
    },
    profileIdentityRow: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12
    },
    initialLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 16
    },
    activityTabs: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 24,
      paddingHorizontal: 16,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    activityTab: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 48,
      minHeight: 48,
      paddingVertical: 12,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent'
    },
    toolbarAction: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center'
    },
    activityTabSelected: {
      borderBottomColor: theme.primary
    },
    activityTabText: {
      color: theme.muted,
      fontFamily: uiFontFamily,
      ...textSizeStyle(uiFontSize(14)),
      fontWeight: '500'
    },
    activityTabTextSelected: {
      color: theme.ink,
      fontWeight: '700'
    },
    emptyActivity: {
      alignItems: 'center',
      paddingHorizontal: 16
    },
    screen: {
      flex: 1,
      backgroundColor: theme.surface
    },
    replyMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      ...textSizeStyle(fontSize(12), fontSize(17)),
      fontVariant: ['tabular-nums']
    },
    topicAuthorMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    topicAuthorRow: {
      flexBasis: 180,
      minWidth: 180,
      flexGrow: 1,
      flexShrink: 1,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
    },
    topicCardPressable: {
      gap: 5,
      paddingHorizontal: 16,
      paddingTop: densityPadding + 2,
      paddingBottom: 14
    },
    topicRowShell: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    topicRowSurface: { backgroundColor: topicRowBackground },
    topicSourceBadge: {
      overflow: 'hidden',
      color: theme.ink,
      fontFamily: uiFontFamily,
      ...textSizeStyle(uiFontSize(11), uiFontSize(16)),
      fontWeight: '600',
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderRadius: readerRadii.badge,
      borderWidth: 0,
      paddingHorizontal: 0,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    userContentInner: {
      paddingBottom: 96
    },
    userProfileHeader: {
      gap: 12,
      padding: 16,
      paddingBottom: 12,
      backgroundColor: theme.surface
    },
    profileStatRail: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 24,
      rowGap: 8
    },
    profileStat: {
      maxWidth: '100%',
      alignItems: 'baseline',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4
    },
    profileStatStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 2
    },
    profileStatLabel: {
      color: theme.muted,
      fontFamily: uiFontFamily,
      fontSize: uiFontSize(12),
      fontWeight: '400',
      includeFontPadding: false,
      lineHeight: uiFontSize(18)
    },
    profileStatValue: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: uiFontFamily,
      fontSize: uiFontSize(16),
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: uiFontSize(22),
      fontVariant: ['tabular-nums']
    }
  });
}

export type UserStyles = ReturnType<typeof createUserStyles>;
