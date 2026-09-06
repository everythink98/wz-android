import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createUserStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.surface;
  const radiusMd = 14;
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
      fontSize: fontSize(20),
      fontWeight: '700',
      lineHeight: fontSize(28)
    },
    cardTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(17 * listFontScale),
      fontWeight: '600',
      letterSpacing: 0,
      lineHeight: Math.round(24 * listFontScale)
    },
    content: {
      flex: 1
    },
    errorBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    excerpt: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(18)
    },
    bioSection: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8
    },
    bioTextContainer: {
      flex: 1,
      minWidth: 0,
      position: 'relative'
    },
    bio: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      lineHeight: fontSize(21)
    },
    bioMeasure: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      opacity: 0
    },
    bioToggle: {
      alignSelf: 'flex-end',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 48
    },
    bioToggleText: {
      color: theme.dark ? theme.primary : theme.primaryStrong,
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
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
    followButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.dark ? theme.primary : theme.primaryStrong,
      backgroundColor: theme.dark ? theme.primary : theme.primaryStrong
    },
    followButtonSelected: {
      borderColor: theme.line,
      backgroundColor: theme.surface
    },
    followButtonText: {
      color: theme.onPrimary,
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      fontWeight: '600',
      lineHeight: fontSize(20)
    },
    followButtonTextSelected: {
      color: theme.ink
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
      fontFamily: appFontFamily,
      fontSize: fontSize(14),
      fontWeight: '500'
    },
    activityTabTextSelected: {
      color: theme.ink,
      fontWeight: '700'
    },
    emptyActivity: {
      paddingHorizontal: 16
    },
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    timeText: {
      flexShrink: 0,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
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
    topicBadgeRow: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6
    },
    topicCardHead: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    topicCardPressable: {
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: densityPadding + 2,
      paddingBottom: 14
    },
    topicCategoryBadge: {
      overflow: 'hidden',
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    topicRowShell: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      backgroundColor: topicRowBackground
    },
    topicSourceBadge: {
      overflow: 'hidden',
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
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
      fontFamily: appFontFamily,
      fontSize: fontSize(12),
      fontWeight: '400',
      includeFontPadding: false,
      lineHeight: fontSize(18)
    },
    profileStatValue: {
      flexShrink: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: fontSize(16),
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: fontSize(22)
    }
  });
}

export type UserStyles = ReturnType<typeof createUserStyles>;
