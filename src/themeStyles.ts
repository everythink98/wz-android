import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { type ReaderSettings } from './readerData';
import { createNavigationStyles, createPanelStyles, createTopicStyles } from './themeParts';
import { alphaColor, fontFamilyValue, LINK_COLOR, type ReaderTheme } from './themeCore';

export function createStyles(theme: ReaderTheme, settings: ReaderSettings, windowHeight: number) {
  const fontScale = settings.fontScale;
  const titleFontScale = Math.min(fontScale, 1.12);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  const loginWebViewHeight = Math.min(480, Math.max(320, Math.round(windowHeight * 0.58)));
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.surface;
  const warningColor = theme.warning;
  const radiusSm = 10;
  const radiusMd = 14;
  const radiusLg = 18;
  const neutralBase = theme.dark ? '#ffffff' : '#000000';
  const replyNeutralSurface = alphaColor(neutralBase, theme.dark ? 0.06 : 0.035);
  const replyNeutralSurfaceStrong = alphaColor(neutralBase, theme.dark ? 0.11 : 0.065);
  const replyNeutralBorder = alphaColor(neutralBase, theme.dark ? 0.12 : 0.09);
  const replyNeutralBorderStrong = alphaColor(neutralBase, theme.dark ? 0.24 : 0.16);
  const navigationStyles = createNavigationStyles(theme, appFontFamily);
  const topicStyles = createTopicStyles(theme, appFontFamily, fontScale, alphaColor);
  const panelStyles = createPanelStyles(theme, appFontFamily);
  const baseStyles = StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    statusBarScrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: NativeStatusBar.currentHeight ?? 0,
      backgroundColor: theme.background,
      zIndex: 20,
      elevation: 0
    },
    statusBarScrimBelowOverlay: {
      zIndex: 0,
      elevation: 0
    },
    content: {
      flex: 1
    },
    topicContent: {
      backgroundColor: theme.surface
    },
    topicScreenRoot: {
      flex: 1
    },
    contentInner: {
      gap: 10,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 96
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
    libraryContentInner: {
      gap: 0,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 96
    },
    moreContentInner: {
      gap: 10,
      padding: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 4,
      paddingBottom: 124
    },
    topicContentInner: {
      alignItems: 'center',
      gap: 10,
      padding: 16,
      paddingTop: 18,
      paddingBottom: 96
    },
    topicListItemFrame: {
      width: '100%',
      alignItems: 'center'
    },
    topicHeaderStack: {
      width: '100%',
      alignItems: 'center',
      gap: 20
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
    countText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    feedList: {
      borderTopColor: theme.line,
      borderTopWidth: 0
    },
    feedFloatingActions: {
      position: 'absolute',
      right: 16,
      bottom: 92,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      backgroundColor: 'transparent',
      zIndex: 4,
      elevation: 2
    },
    feedFixedHeader: {
      gap: 6,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 8,
      paddingBottom: 6,
      zIndex: 3,
      elevation: 0
    },
    feedPager: {
      flex: 1
    },
    feedListContentInner: {
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 0,
      paddingBottom: 96
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
    topicListSeparator: {
      width: '100%',
      height: 1,
      backgroundColor: theme.line
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
    sourceText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
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
    replyInput: {
      borderColor: replyNeutralBorder,
      maxHeight: 180,
      minHeight: 92,
      textAlignVertical: 'top'
    },
    replyFormatToolbarScroll: {
      flexGrow: 0,
      backgroundColor: replyNeutralSurface,
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      maxWidth: '100%',
      minHeight: 48,
      width: '100%'
    },
    replyFormatToolbar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      minHeight: 46,
      paddingHorizontal: 6,
      paddingRight: 14,
      paddingVertical: 4
    },
    replyExpressionSelected: {
      alignSelf: 'flex-start',
      backgroundColor: replyNeutralSurfaceStrong,
      borderColor: replyNeutralBorderStrong,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 18,
      paddingHorizontal: 9,
      paddingVertical: 3
    },
    replyExpressionPanel: {
      maxHeight: 238,
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      backgroundColor: replyNeutralSurface
    },
    replyExpressionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      padding: 10
    },
    replyExpressionChip: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 7
    },
    replyExpressionChipActive: {
      backgroundColor: replyNeutralSurfaceStrong,
      borderColor: replyNeutralBorderStrong
    },
    replyExpressionPreview: {
      height: 26,
      resizeMode: 'contain',
      width: 26
    },
    replyExpressionChipText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      maxWidth: 96
    },
    replyLinuxDoEmojiList: {
      maxHeight: 238,
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
      backgroundColor: replyNeutralSurface
    },
    replyLinuxDoEmojiListContent: {
      padding: 10,
      paddingBottom: 2
    },
    replyLinuxDoEmojiRow: {
      gap: 8,
      marginBottom: 8
    },
    replyLinuxDoEmojiItem: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'flex-start',
      flexDirection: 'row',
      flex: 1,
      gap: 6,
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    replyLinuxDoEmojiItemText: {
      color: theme.ink,
      flex: 1,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    replyStickerCategoryRail: {
      alignItems: 'center',
      borderBottomColor: replyNeutralBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      minHeight: 42,
      paddingHorizontal: 8,
      paddingVertical: 4
    },
    replyStickerCategoryTab: {
      borderRadius: radiusSm,
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    replyStickerCategoryTabActive: {
      backgroundColor: replyNeutralSurfaceStrong
    },
    replyStickerCategoryTabText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
    },
    replyStickerCategoryTabTextActive: {
      color: theme.ink
    },
    replyStickerGridScroll: {
      maxHeight: 198
    },
    replyStickerChip: {
      width: 56,
      height: 60,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: replyNeutralBorder,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      padding: 3
    },
    replyStickerPreview: {
      height: 46,
      resizeMode: 'contain',
      width: 46
    },
    replyComposerActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-end'
    },
    searchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7
    },
    searchInputShell: {
      minHeight: 46,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      paddingLeft: 12,
      paddingRight: 6
    },
    searchInputIcon: {
      opacity: 0.76
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    searchInlineButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 18
    },
    searchSubmitInlineButton: {
      width: 38,
      height: 32,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.08),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.16),
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth
    },
    searchFilterEntry: {
      minHeight: 42,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    searchFilterEntryIcon: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      backgroundColor: 'transparent'
    },
    searchFilterEntryText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 18
    },
    searchFilterEntrySummary: {
      flex: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchSessionStatusBar: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    searchSessionStatusChip: {
      minHeight: 34,
      maxWidth: '100%',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    searchSessionStatusChipNeutral: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    searchSessionStatusChipWarning: {
      backgroundColor: alphaColor(warningColor, theme.dark ? 0.14 : 0.07),
      borderColor: alphaColor(warningColor, theme.dark ? 0.32 : 0.18)
    },
    searchSessionStatusChipDanger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.14 : 0.07),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.32 : 0.22)
    },
    searchSessionStatusDot: {
      width: 7,
      height: 7,
      borderRadius: 4
    },
    searchSessionStatusDotNeutral: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.48 : 0.34)
    },
    searchSessionStatusDotSuccess: {
      backgroundColor: theme.success
    },
    searchSessionStatusDotWarning: {
      backgroundColor: warningColor
    },
    searchSessionStatusDotDanger: {
      backgroundColor: theme.danger
    },
    searchSessionStatusSource: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchSessionStatusText: {
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchSessionStatusTextNeutral: {
      color: theme.muted
    },
    searchSessionStatusTextWarning: {
      color: warningColor
    },
    searchSessionStatusTextDanger: {
      color: theme.danger
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
    searchFilterField: {
      gap: 8
    },
    searchFilterLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18
    },
    searchFilterMoreButton: {
      minHeight: 38,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    searchFilterMoreText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18
    },
    searchFilterOptionWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    searchFilterOptionRow: {
      flexDirection: 'row',
      gap: 8,
      paddingRight: 4
    },
    searchFilterOption: {
      minHeight: 36,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 11,
      paddingVertical: 3
    },
    searchFilterOptionActive: {
      backgroundColor: theme.mist,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.36 : 0.22)
    },
    searchFilterOptionText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchFilterOptionTextActive: {
      color: theme.primary,
      fontWeight: '700'
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
    searchGroupHeader: {
      minHeight: 44,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingTop: 12,
      paddingBottom: 7
    },
    searchGroupTitleRow: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10
    },
    searchGroupTitleText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 18
    },
    searchGroupMetaText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17
    },
    searchGroupChevron: {
      opacity: 0.78
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
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.10 : 0.045),
      borderColor: theme.line,
      paddingHorizontal: 10,
      paddingVertical: 0
    },
    detailActionButton: {
      minHeight: 48,
      minWidth: 72,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 5,
      backgroundColor: 'transparent',
      borderRadius: 8,
      paddingHorizontal: 4,
      paddingVertical: 4
    },
    detailActionButtonActive: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.13 : 0.07)
    },
    replyDetailActionButton: {
      justifyContent: 'flex-start',
      paddingHorizontal: 0
    },
    replyCompactActionButton: {
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'flex-start',
      gap: 2,
      paddingHorizontal: 0
    },
    replyDetailActionButtonActive: {
      backgroundColor: 'transparent'
    },
    detailActionIconSlot: {
      alignItems: 'center',
      height: 22,
      justifyContent: 'center',
      width: 22
    },
    replyCompactActionIconSlot: {
      height: 20,
      width: 18
    },
    detailActionTextBlock: {
      alignItems: 'center',
      flexShrink: 1,
      flexDirection: 'row',
      gap: 3,
      minWidth: 0
    },
    detailActionCompactTextBlock: {
      flexShrink: 1,
      gap: 1
    },
    detailActionLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      flexShrink: 1,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16
    },
    detailActionCount: {
      color: theme.muted,
      fontFamily: appFontFamily,
      flexShrink: 1,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16
    },
    detailActionCompactLabel: {
      fontSize: 11,
      lineHeight: 15
    },
    detailActionCompactCount: {
      fontSize: 11,
      lineHeight: 15
    },
    detailActionLabelActive: {
      color: theme.primary,
      fontWeight: '700'
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
    endOfListText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17,
      paddingVertical: 18,
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
      height: 30,
      borderRadius: radiusSm,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.13 : 0.07)
    },
    menuLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600'
    },
    updateBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.07),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.38 : 0.20),
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
      width: 32,
      height: 32,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface2
    },
    expandableBody: {
      gap: 10,
      overflow: 'hidden'
    },
    categoryGroup: {
      gap: 8,
      paddingTop: 4
    },
    categoryItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    categoryName: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '600'
    },
    settingGroup: {
      gap: 7
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    removableChip: {
      maxWidth: 240,
      minHeight: 38,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 5
    },
    removableChipPadded: {
      paddingRight: 24
    },
    removableChipText: {
      maxWidth: 198
    },
    removableChipShell: {
      position: 'relative',
      justifyContent: 'center',
      paddingRight: 4,
      paddingTop: 4
    },
    removableChipClose: {
      position: 'absolute',
      top: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      width: 21,
      height: 21,
      borderRadius: 11,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
    },
    loginPanel: {
      gap: 10
    },
    webViewShell: {
      height: loginWebViewHeight,
      overflow: 'hidden',
      borderColor: theme.line,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface
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
    loginWebViewTitleBlock: {
      flex: 1,
      gap: 2
    },
    loginWebViewTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700'
    },
    loginWebViewSubtitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    loginWebViewToolbar: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loginWebViewBody: {
      flex: 1,
      backgroundColor: theme.surface
    },
    hiddenBrowserWebViewHost: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 1,
      height: 1,
      overflow: 'hidden',
      opacity: 0,
      zIndex: -1,
      elevation: -1
    },
    hiddenBrowserWebView: {
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    },
    loading: {
      position: 'absolute',
      zIndex: 1,
      top: 14,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 1,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loadingText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    libraryItem: {
      gap: 8,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: 10
    },
    libraryInlineAction: {
      alignItems: 'center',
      flexShrink: 0,
      justifyContent: 'center',
      minHeight: 32,
      paddingHorizontal: 2,
      paddingVertical: 4
    },
    libraryInlineActionText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
    },
    libraryIconAction: {
      alignItems: 'center',
      flexShrink: 0,
      height: 32,
      justifyContent: 'center',
      width: 32
    },
    librarySectionTitle: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0,
      paddingTop: 12,
      paddingBottom: 2
    },
    libraryFirstSectionTitle: {
      paddingTop: 10
    },
    libraryUserRow: {
      alignItems: 'center',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      paddingBottom: 10
    },
    libraryUserButton: {
      flex: 1,
      minWidth: 0
    },
    libraryUserAction: {
      flexShrink: 0
    },
    libraryUserListSpacer: {
      height: 6
    },
    noticeText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
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
    topicOverflowMenu: {
      position: 'absolute',
      top: (NativeStatusBar.currentHeight ?? 0) + 58,
      right: 12,
      minWidth: 154,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 4
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
    article: {
      width: '100%',
      gap: 16,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      padding: 0
    },
    topicMetaStack: {
      gap: 10,
      paddingTop: 2
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
    },
    topicAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21
    },
    topicPrimaryActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-start',
      minHeight: 48,
      paddingTop: 2
    },
    topicPostActionArea: {
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 2,
      paddingTop: 12,
      paddingBottom: 4
    },
    pollStack: {
      gap: 14,
      paddingTop: 6
    },
    pollBlock: {
      gap: 10,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 14,
      paddingBottom: 2
    },
    pollBlockFirstInArticle: {
      borderTopWidth: 0,
      paddingTop: 0
    },
    pollHeader: {
      alignItems: 'flex-start',
      gap: 8
    },
    pollTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
      width: '100%'
    },
    pollMetaWrap: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      justifyContent: 'flex-start',
      width: '100%'
    },
    pollParticipationPill: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 5,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.15 : 0.075),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.28 : 0.18),
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      minHeight: 26,
      paddingHorizontal: 9,
      paddingVertical: 3
    },
    pollParticipationText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16
    },
    pollMetaPill: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.06),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.12),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16,
      paddingHorizontal: 7,
      paddingVertical: 3
    },
    pollStatePill: {
      backgroundColor: alphaColor(theme.ink, theme.dark ? 0.10 : 0.04),
      borderColor: alphaColor(theme.ink, theme.dark ? 0.16 : 0.08),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16,
      paddingHorizontal: 7,
      paddingVertical: 3
    },
    pollOptionList: {
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.ink, theme.dark ? 0.12 : 0.09),
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth
    },
    pollOptionRow: {
      minHeight: 46,
      backgroundColor: 'transparent',
      overflow: 'hidden',
      position: 'relative'
    },
    pollOptionDivider: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    pollOptionRowSelected: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.06)
    },
    pollOptionProgress: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.08)
    },
    pollOptionContent: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      minHeight: 46,
      paddingHorizontal: 10,
      paddingVertical: 8,
      position: 'relative',
      width: '100%',
      zIndex: 1
    },
    pollOptionIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      marginTop: 1
    },
    pollOptionTextBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    pollOptionText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      lineHeight: 20
    },
    pollOptionCount: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 17,
      textAlign: 'left'
    },
    pollFooter: {
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 2
    },
    pollSubmitRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-start',
      paddingTop: 0
    },
    topicStatRail: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      minHeight: 34
    },
    nodeSeekStatPill: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 34,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 0
    },
    nodeSeekStatCompact: {
      minHeight: 30,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      paddingHorizontal: 9
    },
    nodeSeekStatText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17,
      textAlignVertical: 'center'
    },
    nodeSeekStatLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 17,
      textAlignVertical: 'center'
    },
    nodeSeekStatValue: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 17,
      textAlignVertical: 'center'
    },
    linuxDoReactionPill: {
      minHeight: 30,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 5,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.055),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.12),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 0
    },
    linuxDoReactionPillCompact: {
      minHeight: 28,
      paddingHorizontal: 7
    },
    linuxDoReactionImage: {
      width: 18,
      height: 18
    },
    linuxDoReactionLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      maxWidth: 92,
      textAlignVertical: 'center'
    },
    linuxDoReactionCount: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 17,
      textAlignVertical: 'center'
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
    topicStatusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingTop: 2
    },
    topicStatusBadge: {
      alignItems: 'center',
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.12 : 0.07),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.34 : 0.2),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 24,
      paddingHorizontal: 8,
      paddingVertical: 0
    },
    topicStatusBadgeText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      textAlignVertical: 'center'
    },
    articleBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 2,
      paddingTop: 16
    },
    htmlTableScroll: {
      marginBottom: 12,
      marginTop: 10
    },
    htmlTableScrollContent: {
      paddingRight: 12
    },
    htmlTableFrame: {
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden'
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
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.08)
    },
    loadingPlaceholderLineShort: {
      width: '42%'
    },
    loadingPlaceholderLineMuted: {
      width: '68%'
    },
    errorBox: {
      gap: 8,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
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
    infoBox: {
      gap: 8,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.3 : 0.16),
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    infoText: {
      color: theme.primary,
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
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.09 : 0.04),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.10)
    },
    authNoticeBoxWarning: {
      backgroundColor: alphaColor(warningColor, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(warningColor, theme.dark ? 0.38 : 0.22)
    },
    authNoticeBoxDanger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34)
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
    levelSummary: {
      gap: 7,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.09 : 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.10),
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
    replyBox: {
      width: '100%',
      gap: 10,
      backgroundColor: theme.surface,
      borderColor: replyNeutralBorder,
      borderRadius: radiusMd,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    replyComposerSheetBox: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      paddingTop: 14,
      paddingRight: 16,
      paddingBottom: 0,
      paddingLeft: 16
    },
    replyComposerBottomSheetBackground: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: radiusLg,
      borderTopRightRadius: radiusLg
    },
    replyComposerBottomSheetContainer: {
      zIndex: 30,
      elevation: 30
    },
    replyComposerBottomSheetContent: {
      alignItems: 'stretch',
      paddingHorizontal: 0,
      paddingTop: 0
    },
    replyHeader: {
      width: '100%',
      gap: 10,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 12
    },
    replyList: {
      width: '100%',
      overflow: 'hidden',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      backgroundColor: 'transparent'
    },
    replyListItem: {
      alignSelf: 'center'
    },
    topicFooter: {
      alignSelf: 'center',
      paddingTop: 14
    },
    replyCard: {
      gap: 10,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
      paddingVertical: 18
    },
    replyHead: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
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
    replyFloorBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 0
    },
    replyFloorText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0,
      lineHeight: 16
    },
    replyAuthorBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    replyAuthorNameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      minWidth: 0
    },
    replyAuthor: {
      color: theme.ink,
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 19
    },
    replyOpBadge: {
      overflow: 'hidden',
      borderColor: alphaColor(theme.primary, theme.dark ? 0.32 : 0.22),
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 14,
      paddingHorizontal: 6,
      textAlignVertical: 'center'
    },
    replyContextBadge: {
      overflow: 'hidden',
      borderColor: alphaColor(theme.danger, theme.dark ? 0.36 : 0.26),
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 14,
      paddingHorizontal: 6
    },
    replyTime: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      lineHeight: 15
    },
    replyContentArea: {
      gap: 10,
      paddingLeft: 42,
      paddingRight: 0
    },
    replyTargetPill: {
      alignSelf: 'flex-start',
      backgroundColor: alphaColor(LINK_COLOR, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(LINK_COLOR, theme.dark ? 0.3 : 0.16),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 5
    },
    replyTargetText: {
      color: LINK_COLOR,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16
    },
    htmlMentionLink: {
      color: LINK_COLOR,
      fontFamily: appFontFamily,
      fontSize: Math.round(15 * fontScale),
      fontWeight: '600',
      lineHeight: Math.round(24 * fontScale)
    },
    htmlFloorLink: {
      color: LINK_COLOR,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * fontScale),
      fontWeight: '600',
      lineHeight: Math.round(22 * fontScale)
    },
    htmlReplyReferenceRow: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 5,
      marginBottom: 4,
      marginTop: -1
    },
    htmlReplyReferenceLabel: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceMentionText: {
      color: LINK_COLOR,
      fontFamily: appFontFamily,
      fontSize: Math.round(13 * fontScale),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: Math.round(18 * fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceSeparator: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * fontScale),
      textAlignVertical: 'center'
    },
    htmlReplyReferenceFloorText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: Math.round(12 * fontScale),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: Math.round(18 * fontScale),
      textAlignVertical: 'center'
    },
    replyBody: {
      paddingTop: 0
    },
    replySignature: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 8
    },
    replyStatRail: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      minHeight: 40
    },
    replyThanksText: {
      alignSelf: 'flex-start',
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 16
    },
    replyActionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      justifyContent: 'flex-start',
      minHeight: 48,
      paddingTop: 2
    },
    quoteStack: {
      gap: 12
    },
    detailsPanel: {
      overflow: 'hidden',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      marginVertical: 5
    },
    detailsPanelHeader: {
      minHeight: 44,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    detailsPanelIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22
    },
    detailsPanelSummary: {
      flex: 1,
      minWidth: 0
    },
    detailsPanelSummaryText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(16 * fontScale),
      fontWeight: '600',
      lineHeight: Math.round(23 * fontScale)
    },
    detailsPanelBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    quoteBox: {
      gap: 6,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    quoteHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between'
    },
    quotePanelHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      minHeight: 44,
      justifyContent: 'space-between'
    },
    quoteAuthorSummary: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      minWidth: 0
    },
    quotePanelState: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 6
    },
    quotePanelStateText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    quotePanelStateIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface2
    },
    quoteAuthorTextBlock: {
      flex: 1,
      gap: 1,
      minWidth: 0
    },
    quoteAuthorText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    quoteBody: {
      paddingTop: 4
    },
    quotePanelBody: {
      borderTopColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.14),
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 2,
      paddingTop: 8
    },
    quoteAuthorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 4
    },
    replyMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
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
    imagePreviewTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
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
    imagePreviewScrollContent: {
      minHeight: '100%',
      alignItems: 'center',
      justifyContent: 'center'
    },
    imagePreviewVerticalScroll: {
      maxHeight: '100%'
    },
    imagePreviewVerticalContent: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    imagePreviewImage: {
      width: '100%',
      height: '100%'
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
    imagePreviewControls: {
      position: 'absolute',
      right: 18,
      bottom: 30,
      left: 18,
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewControl: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewThumbnailRail: {
      position: 'absolute',
      right: 78,
      bottom: 30,
      left: 78,
      maxHeight: 58
    },
    imagePreviewThumbnailContent: {
      gap: 8,
      alignItems: 'center'
    },
    imagePreviewThumbnail: {
      width: 52,
      height: 52,
      overflow: 'hidden',
      borderColor: alphaColor(theme.onOverlay, 0.28),
      borderRadius: 8,
      borderWidth: 1
    },
    imagePreviewThumbnailActive: {
      borderColor: theme.onOverlay,
      borderWidth: 2
    },
    imagePreviewThumbnailImage: {
      width: '100%',
      height: '100%'
    }
  });
  return Object.assign(
    baseStyles,
    StyleSheet.create(navigationStyles),
    StyleSheet.create(topicStyles),
    StyleSheet.create(panelStyles)
  );
}
