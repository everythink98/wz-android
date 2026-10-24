import { StyleSheet } from 'react-native';
import {
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme,
  alphaColor,
  fontFamilyValue
} from '@/ui/theme/tokens';

export function createMoreSiteSettingStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    row: { paddingVertical: 0, paddingRight: 0 },
    rowContainer: { alignItems: 'center', minHeight: 64, marginVertical: 0 },
    rowContent: { paddingLeft: 0, paddingRight: 12, minWidth: 0 },
    title: { color: theme.ink, fontFamily, fontSize: fontSize(14), fontWeight: '500', lineHeight: fontSize(20) },
    description: { color: theme.muted, fontFamily, fontSize: fontSize(12), lineHeight: fontSize(18) },
    button: { alignSelf: 'center', borderRadius: readerRadii.control, minWidth: 0 },
    buttonContent: { minHeight: 44, flexDirection: 'row-reverse' },
    buttonLabel: {
      fontFamily,
      fontSize: fontSize(13),
      fontWeight: '500',
      letterSpacing: 0,
      marginHorizontal: 12,
      marginVertical: 8
    },
    input: { backgroundColor: theme.surface, fontFamily, fontSize: fontSize(14) },
    divider: { backgroundColor: theme.line, marginVertical: 4 },
    actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
    section: { gap: 8, paddingBottom: 8 },
    menu: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: readerRadii.control
    }
  });
}

export function createMoreAccountStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const levelRiskSafe = theme.dark ? '#78D69C' : '#2F7D4C';
  return StyleSheet.create({
    levelSummary: {
      gap: 7,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.09 : 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.1),
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 11
    },
    levelSummaryHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    levelTitleBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    levelRefreshSlot: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center'
    },
    levelEyebrow: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      lineHeight: 16
    },
    levelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(18 * settings.fontScale),
      fontWeight: '600',
      letterSpacing: 0,
      lineHeight: Math.round(24 * settings.fontScale)
    },
    levelMetaRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7
    },
    levelBadge: {
      overflow: 'hidden',
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '700',
      lineHeight: 16,
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.22 : 0.16),
      borderRadius: readerRadii.badge,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    levelTabRail: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 22
    },
    levelTab: {
      minHeight: 48,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingHorizontal: 1
    },
    levelTabActive: {
      borderBottomColor: theme.primary
    },
    levelTabText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * settings.fontScale),
      fontWeight: '500',
      lineHeight: Math.round(18 * settings.fontScale)
    },
    levelTabTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    levelRequirementList: {
      gap: 10
    },
    levelRequirementRow: {
      gap: 7
    },
    levelRequirementHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    levelRequirementLabel: {
      flex: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    levelRequirementValue: {
      flexShrink: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      textAlign: 'right'
    },
    levelProgressTrack: {
      width: '100%',
      height: 4,
      overflow: 'hidden',
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.08),
      borderRadius: readerRadii.pill
    },
    levelProgressFill: {
      height: '100%',
      minWidth: 2,
      backgroundColor: theme.primary,
      borderRadius: readerRadii.pill
    },
    levelProgressFillDone: {
      backgroundColor: theme.success
    },
    levelRiskTrack: {
      width: '100%',
      height: 8,
      flexDirection: 'row',
      gap: 4
    },
    levelRiskSegment: {
      height: '100%',
      flex: 1,
      borderRadius: 2
    },
    levelRiskSegmentUsed: {
      backgroundColor: theme.danger
    },
    levelRiskSegmentRemaining: {
      backgroundColor: alphaColor(levelRiskSafe, theme.dark ? 0.32 : 0.16)
    },
    levelRequirementFooter: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 10
    },
    levelChangeText: {
      flexShrink: 1,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      textAlign: 'right'
    },
    levelChangeDanger: {
      color: theme.danger
    },
    levelChangeSuccess: {
      color: levelRiskSafe
    },
    levelVetoCard: {
      minHeight: 52,
      alignItems: 'stretch',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 2,
      borderRadius: readerRadii.content,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    levelVetoCardPassed: {
      backgroundColor: alphaColor(levelRiskSafe, theme.dark ? 0.12 : 0.06),
      borderColor: alphaColor(levelRiskSafe, theme.dark ? 0.32 : 0.2)
    },
    levelVetoCardFailed: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.12 : 0.06),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.32 : 0.2)
    },
    levelStatGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingTop: 2
    },
    levelStatItem: {
      width: '48%',
      minHeight: 58,
      justifyContent: 'center',
      gap: 3,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.075 : 0.028),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.15 : 0.08),
      borderRadius: readerRadii.content,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    levelStatLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '500',
      lineHeight: 15
    },
    levelStatValue: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20
    },
    levelEmptyState: {
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.07 : 0.025),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.08),
      borderRadius: readerRadii.content,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    statusOk: {
      color: theme.success
    },
    statusDanger: {
      color: theme.danger
    },
    levelStatusSafe: {
      color: levelRiskSafe
    }
  });
}
