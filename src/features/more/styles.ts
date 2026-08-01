import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';
import type { SharedStyles } from '@/ui/theme/sharedStyles';
import type { MoreAccountStyles } from './accountStyles';
import type { LoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';

export function createMoreStyles(sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) {
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  return Object.assign(
    {},
    sharedStyles,
    StyleSheet.create({
      updateBadge: {
        alignSelf: 'flex-start',
        overflow: 'hidden',
        color: theme.danger,
        fontFamily: appFontFamily,
        fontSize: 11,
        fontWeight: '600',
        lineHeight: 16,
        backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.07),
        borderColor: alphaColor(theme.danger, theme.dark ? 0.38 : 0.2),
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 7,
        paddingVertical: 2
      },
      updateProgressBox: {
        gap: 7,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 9
      },
      updateProgressHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10
      },
      updateProgressTitle: {
        flex: 1,
        minWidth: 0,
        color: theme.ink,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17
      },
      updateProgressPercent: {
        flexShrink: 0,
        color: theme.primary,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 17
      },
      updateProgressTrack: {
        width: '100%',
        height: 6,
        overflow: 'hidden',
        backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.08),
        borderRadius: 999
      },
      updateProgressFill: {
        height: '100%',
        backgroundColor: theme.primary,
        borderRadius: 999
      },
      updateProgressMeta: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 15
      },
      appearanceSettings: {
        gap: 20,
        paddingTop: 4
      },
      appearanceSection: {
        gap: 4
      },
      appearanceSectionTitle: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17
      },
      appearanceSettingRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        minHeight: 48
      },
      appearanceSettingRowDivided: {
        borderTopColor: theme.line,
        borderTopWidth: StyleSheet.hairlineWidth
      },
      appearanceSettingLabel: {
        flexBasis: 72,
        flexShrink: 0,
        color: theme.ink,
        fontFamily: appFontFamily,
        fontSize: 14,
        fontWeight: '500',
        lineHeight: 20
      },
      appearanceSegmentedControl: {
        flex: 1,
        flexDirection: 'row',
        minWidth: 0,
        padding: 2,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth
      },
      appearanceSegment: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        minHeight: 48,
        minWidth: 0,
        borderRadius: 6,
        paddingHorizontal: 4
      },
      appearanceSegmentActive: {
        backgroundColor: theme.primarySoft
      },
      appearanceSegmentText: {
        color: theme.muted,
        fontFamily: appFontFamily,
        fontSize: 12,
        fontWeight: '500',
        includeFontPadding: false
      },
      appearanceSegmentTextActive: {
        color: theme.primary,
        fontWeight: '600'
      },
      appearanceFontScaleBlock: {
        gap: 2,
        paddingBottom: 4
      },
      appearanceFontScaleHeader: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        minHeight: 40
      },
      appearanceFontScaleValue: {
        color: theme.primary,
        fontFamily: appFontFamily,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18
      },
      appearanceSliderRow: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12
      },
      appearanceStepButton: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: 48,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth
      },
      appearanceStepButtonText: {
        color: theme.ink,
        fontFamily: appFontFamily,
        fontSize: 20,
        fontWeight: '500',
        includeFontPadding: false
      },
      appearanceControlDisabled: {
        opacity: 0.38
      },
      appearanceSlider: {
        flex: 1,
        height: 48,
        justifyContent: 'center',
        minWidth: 0
      },
      appearanceSliderTrack: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: theme.lineStrong,
        borderRadius: 2
      },
      appearanceSliderFill: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: theme.primary,
        borderRadius: 2,
        transformOrigin: 'left center'
      },
      appearanceSliderThumb: {
        position: 'absolute',
        left: 0,
        width: 20,
        height: 20,
        marginLeft: -10,
        backgroundColor: theme.primaryStrong,
        borderColor: theme.surface,
        borderRadius: 10,
        borderWidth: 2
      }
    })
  );
}

export type MoreStyles = ReturnType<typeof createMoreStyles>;
export type MoreScreenStyles = MoreStyles & MoreAccountStyles & LoginWebViewStyles;
