import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';

export function createMoreAccountStyles(sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const radiusMd = 14;
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
      levelSummary: {
        gap: 7,
        backgroundColor: alphaColor(theme.primary, theme.dark ? 0.09 : 0.035),
        borderColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.1),
        borderRadius: radiusMd,
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
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 0,
        lineHeight: 27
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
        borderRadius: 6,
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
        minHeight: 40,
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
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 19
      },
      levelTabTextActive: {
        color: theme.primary,
        fontWeight: '700'
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
        flexShrink: 0,
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17
      },
      levelProgressTrack: {
        width: '100%',
        height: 8,
        overflow: 'hidden',
        backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.08),
        borderRadius: 999
      },
      levelProgressFill: {
        height: '100%',
        minWidth: 2,
        backgroundColor: theme.primary,
        borderRadius: 999
      },
      levelProgressFillDone: {
        backgroundColor: theme.success
      },
      levelRequirementFooter: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10
      },
      levelChangeText: {
        color: theme.primary,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17
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
        borderRadius: 8,
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
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 12
      },
      statusOk: {
        color: theme.success
      }
    })
  );
}

export type MoreAccountStyles = ReturnType<typeof createMoreAccountStyles>;
