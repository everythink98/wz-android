import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue } from '@/ui/theme/tokens';

export function createSharedStyles(theme: ReaderTheme, settings: ReaderSettings, windowHeight: number) {
  const fontScale = settings.fontScale;
  const titleFontScale = Math.min(fontScale, 1.12);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.surface;
  const warningColor = theme.warning;
  const radiusSm = 10;
  const radiusMd = 14;
  const radiusLg = 18;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    content: {
      flex: 1
    },
    stack: {
      gap: 10,
      width: '100%'
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sectionTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 17,
      fontWeight: '600'
    },
    floatingIconButton: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      elevation: 1
    },
    topicRowShell: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      backgroundColor: topicRowBackground
    },
    topicCardPressable: {
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: densityPadding + 2,
      paddingBottom: 14
    },
    topicCardRead: {
      opacity: 0.72
    },
    topicCardHead: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    topicCardHeadMeta: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 4
    },
    topicBadgeRow: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6
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
    timeText: {
      flexShrink: 0,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    cardTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(17 * listFontScale),
      fontWeight: '600',
      letterSpacing: 0,
      lineHeight: Math.round(24 * listFontScale)
    },
    excerpt: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    highlightText: {
      color: theme.ink,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.28 : 0.16)
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    topicAccessBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    topicFooterRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 4
    },
    topicAuthorChip: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7
    },
    feedAvatarTiny: {
      width: 24,
      height: 24,
      borderRadius: 12
    },
    topicAuthorName: {
      flexShrink: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '500',
      includeFontPadding: false
    },
    topicStatGroup: {
      flexShrink: 0,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14
    },
    topicStatItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4
    },
    topicStatText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16
    },
    pillRail: {
      gap: 2,
      paddingRight: 18,
      paddingVertical: 0
    },
    pill: {
      minHeight: 40,
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 4
    },
    pillActive: {
      backgroundColor: theme.mist,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.12)
    },
    pillText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '500'
    },
    pillTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    subtabRail: {
      gap: 20,
      paddingRight: 18,
      paddingVertical: 0
    },
    subtab: {
      minHeight: 34,
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingHorizontal: 2,
      paddingTop: 3,
      paddingBottom: 5
    },
    subtabActive: {
      borderBottomColor: theme.primary
    },
    subtabText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    subtabTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    tabRail: {
      gap: 22,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingRight: 18
    },
    tab: {
      minHeight: 40,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingBottom: 4
    },
    tabActive: {
      borderBottomColor: theme.primary
    },
    tabText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '500'
    },
    tabTextActive: {
      color: theme.primary,
      fontWeight: '600'
    },
    input: {
      minHeight: 42,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    searchFilterModalRoot: {
      flex: 1,
      justifyContent: 'flex-end'
    },
    searchFilterBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.32)'
    },
    searchFilterSheet: {
      maxHeight: '82%',
      gap: 12,
      backgroundColor: theme.surface,
      borderTopLeftRadius: radiusLg,
      borderTopRightRadius: radiusLg,
      paddingHorizontal: 16,
      paddingTop: 9,
      paddingBottom: 18
    },
    searchFilterHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.lineStrong
    },
    searchFilterHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12
    },
    searchFilterTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 17,
      fontWeight: '700',
      lineHeight: 22
    },
    searchFilterBody: {
      maxHeight: Math.max(320, Math.round(windowHeight * 0.58))
    },
    searchFilterBodyInner: {
      gap: 14,
      paddingBottom: 4
    },
    searchFilterActions: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 12
    },
    flex: {
      flex: 1
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    button: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 5
    },
    buttonCompact: {
      minHeight: 40,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    buttonIconOnly: {
      width: 44,
      minHeight: 44,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 22,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    buttonTiny: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      minHeight: 40,
      gap: 5,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.1 : 0.045),
      borderColor: theme.line,
      paddingHorizontal: 10,
      paddingVertical: 0
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    buttonDanger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.38 : 0.24)
    },
    buttonActive: {
      backgroundColor: theme.mist,
      borderColor: 'transparent'
    },
    buttonDisabled: {
      opacity: 0.45
    },
    buttonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    buttonTextCompact: {
      fontSize: 12,
      fontWeight: '500'
    },
    buttonTextTiny: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 16
    },
    buttonTextActive: {
      color: theme.primary
    },
    buttonTextDanger: {
      color: theme.danger
    },
    empty: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13,
      paddingVertical: 24,
      textAlign: 'center'
    },
    group: {
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    menuButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 44
    },
    menuIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30
    },
    menuLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600'
    },
    menuChevron: {
      marginLeft: 4,
      opacity: 0.45
    },
    menuChevronExpanded: {
      transform: [{ rotate: '180deg' }]
    },
    expandableHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 44
    },
    expandableStateIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 32
    },
    expandableBody: {
      gap: 10,
      overflow: 'hidden'
    },
    settingGroup: {
      gap: 7
    },
    loginWebViewModal: {
      flex: 1,
      backgroundColor: theme.background
    },
    loginWebViewHeader: {
      alignItems: 'center',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700'
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    },
    topicTopBar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 8,
      paddingBottom: 8,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    topicTopHint: {
      flex: 1,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0,
      textAlign: 'left'
    },
    topicTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 4
    },
    topicMenuLayer: {
      flex: 1
    },
    topicMenuDismissLayer: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    },
    topicMenuItem: {
      minHeight: 42,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 9,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    topicMenuItemLast: {
      borderBottomWidth: 0
    },
    topicMenuItemText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '600'
    },
    topicAuthorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    topicAuthorMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    topicAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21
    },
    topicTagRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingTop: 2
    },
    topicTagPill: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 6,
      borderWidth: 0,
      justifyContent: 'center',
      minHeight: 20,
      paddingHorizontal: 5,
      paddingVertical: 1
    },
    topicTagText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 14,
      textAlignVertical: 'center'
    },
    topicTagMorePill: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    topicTagMoreText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      textAlignVertical: 'center'
    },
    articleTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(22 * titleFontScale),
      fontWeight: '700',
      lineHeight: Math.round(31 * titleFontScale)
    },
    loadingState: {
      width: '100%',
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 12,
      minHeight: 156,
      backgroundColor: alphaColor(theme.primary, 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.2 : 0.12),
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 22
    },
    loadingStateHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 9
    },
    loadingStateText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13
    },
    loadingPlaceholderStack: {
      gap: 8
    },
    loadingPlaceholderLine: {
      alignSelf: 'stretch',
      height: 10,
      borderRadius: 999,
      backgroundColor: theme.line
    },
    loadingPlaceholderLineShort: {
      width: '42%'
    },
    loadingPlaceholderLineMuted: {
      width: '68%'
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
    authNoticeBox: {
      gap: 8,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    authNoticeBoxNeutral: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxWarning: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeBoxDanger: {
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    authNoticeText: {
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    authNoticeTextNeutral: {
      color: theme.muted
    },
    authNoticeTextWarning: {
      color: warningColor
    },
    authNoticeTextDanger: {
      color: theme.danger
    },
    replyAvatar: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 34,
      height: 34,
      overflow: 'hidden',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth
    },
    replyAvatarSmall: {
      width: 32,
      height: 32,
      borderRadius: 16
    },
    replyAvatarImage: {
      width: '100%',
      height: '100%'
    },
    replyAvatarText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700'
    },
    replyAvatarSmallText: {
      fontSize: 11
    },
    imagePreviewOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000'
    },
    imagePreviewTopBar: {
      position: 'absolute',
      top: (NativeStatusBar.currentHeight ?? 0) + 10,
      right: 14,
      left: 14,
      zIndex: 2,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewCount: {
      color: theme.onOverlay,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    imagePreviewTextButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 58,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewButtonText: {
      color: theme.onOverlay,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700'
    },
    imagePreviewClose: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewScroll: {
      flex: 1,
      width: '100%'
    },
    imagePreviewState: {
      position: 'absolute',
      alignSelf: 'center',
      top: '46%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 10,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    imagePreviewStateText: {
      color: theme.onOverlay,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    navItem: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 3,
      minHeight: 48,
      borderRadius: 6
    },
    navIconPill: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      minWidth: 46,
      height: 28,
      borderRadius: 999,
      paddingHorizontal: 16
    },
    navIconWrap: {
      position: 'relative' as const
    },
    navBadge: {
      position: 'absolute' as const,
      top: -2,
      right: -7,
      width: 8,
      height: 8,
      borderRadius: 999,
      borderColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.danger
    },
    navText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '600' as const,
      letterSpacing: 0
    },
    navTextActive: {
      color: theme.primary,
      fontWeight: '700' as const
    },
    groupList: {
      gap: 7,
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      paddingHorizontal: 0,
      paddingVertical: 12
    },
    buttonPrimary: {
      backgroundColor: theme.primaryStrong,
      borderColor: theme.primaryStrong
    },
    buttonTextPrimary: {
      color: theme.onPrimary,
      fontWeight: '700' as const,
      letterSpacing: 0
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600' as const
    }
  });
}

export type SharedStyles = ReturnType<typeof createSharedStyles>;
