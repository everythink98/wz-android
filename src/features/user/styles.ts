import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, fontFamilyValue } from '@/ui/theme/tokens';

export function createUserStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const titleFontScale = Math.min(settings.fontScale, 1.12);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.surface;
  const warningColor = theme.warning;
  const radiusMd = 14;
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    articleTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(22 * titleFontScale),
      fontWeight: '700',
      lineHeight: Math.round(31 * titleFontScale)
    },
    authNoticeBox: {
      gap: 8,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    authNoticeBoxDanger: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxNeutral: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxWarning: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeText: {
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    authNoticeTextDanger: {
      color: theme.danger
    },
    authNoticeTextNeutral: {
      color: theme.muted
    },
    authNoticeTextWarning: {
      color: warningColor
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
      fontSize: 12,
      lineHeight: 17
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
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
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
      gap: 10,
      padding: 16,
      paddingTop: 8,
      paddingBottom: 96
    },
    userProfileHeader: {
      gap: 16,
      padding: 16,
      paddingTop: 8,
      paddingBottom: 10,
      backgroundColor: theme.background,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    profileStatRail: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    profileStatPill: {
      minHeight: 34,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 5
    },
    profileStatLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16
    },
    profileStatValue: {
      maxWidth: 160,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16
    }
  });
}

export type UserStyles = ReturnType<typeof createUserStyles>;
