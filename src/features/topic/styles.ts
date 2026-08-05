import { StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { type ReaderTheme, alphaColor, fontFamilyValue, LINK_COLOR } from '@/ui/theme/tokens';

export function createTopicStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontScale = settings.fontScale;
  const titleFontScale = Math.min(fontScale, 1.12);
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const linkColor = theme.dark ? theme.primary : LINK_COLOR;
  const warningColor = theme.warning;
  const radiusSm = 10;
  const radiusMd = 14;
  const radiusLg = 18;
  const neutralBase = theme.dark ? '#ffffff' : '#000000';
  const replyNeutralSurface = alphaColor(neutralBase, theme.dark ? 0.06 : 0.035);
  const replyNeutralBorder = alphaColor(neutralBase, theme.dark ? 0.12 : 0.09);
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
    buttonDisabled: {
      opacity: 0.45
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
    flex: {
      flex: 1
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
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600' as const
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
    topicTagRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingTop: 2
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
    topicContent: {
      backgroundColor: theme.surface
    },
    topicScreenRoot: {
      flex: 1
    },
    topicContentInner: {
      alignItems: 'center',
      gap: 0,
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
    countText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    searchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7
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
      minHeight: 48,
      paddingBottom: 0,
      paddingHorizontal: 0,
      paddingTop: 0
    },
    replyCompactActionButton: {
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 48,
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
    noticeText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
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
      backgroundColor: alphaColor(theme.ink, theme.dark ? 0.1 : 0.04),
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
    topicAcceptedAnswer: {
      width: '100%',
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.34 : 0.2),
      borderLeftWidth: 3,
      borderRadius: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    topicAcceptedAnswerHeader: {
      minHeight: 48,
      alignItems: 'center',
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.14 : 0.065),
      borderBottomColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.14),
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 13,
      paddingVertical: 9
    },
    topicAcceptedAnswerHeaderLead: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7
    },
    topicAcceptedAnswerTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 19
    },
    topicAcceptedAnswerToggle: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4
    },
    topicAcceptedAnswerToggleText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16
    },
    topicAcceptedAnswerBody: {
      gap: 9,
      paddingHorizontal: 13,
      paddingBottom: 10,
      paddingTop: 11
    },
    topicAcceptedAnswerAuthorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    topicAcceptedAnswerAuthorMeta: {
      flex: 1,
      minWidth: 0,
      gap: 1
    },
    topicAcceptedAnswerAuthor: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
    },
    topicAcceptedAnswerTime: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      lineHeight: 15
    },
    topicAcceptedAnswerPreview: {
      maxHeight: 164,
      overflow: 'hidden'
    },
    topicAcceptedAnswerReadMore: {
      minHeight: 44,
      alignItems: 'center',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 1,
      paddingTop: 8
    },
    topicAcceptedAnswerReadMoreText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18
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
    replyListItem: {
      alignSelf: 'center'
    },
    replyLocationHighlight: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.09),
      borderRadius: 10
    },
    topicFooter: {
      alignSelf: 'center',
      paddingTop: 14
    },
    replyCard: {
      gap: 8,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: 'transparent',
      paddingBottom: 8,
      paddingHorizontal: 0,
      paddingTop: 16
    },
    replyCardStart: {
      borderBottomWidth: 0,
      paddingBottom: 0
    },
    replyCardMiddle: {
      borderBottomWidth: 0,
      paddingBottom: 0,
      paddingTop: 0
    },
    replyCardEnd: {
      paddingTop: 0
    },
    replyAcceptedNotice: {
      minHeight: 28,
      alignItems: 'center',
      alignSelf: 'stretch',
      borderLeftColor: theme.primary,
      borderLeftWidth: 2,
      flexDirection: 'row',
      gap: 6,
      paddingLeft: 9,
      paddingVertical: 4
    },
    replyAcceptedNoticeText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16
    },
    replyAcceptedSolution: {
      alignItems: 'center',
      alignSelf: 'stretch',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 5,
      marginTop: 4,
      paddingTop: 8
    },
    replyAcceptedSolutionText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16
    },
    replySystemEvent: {
      paddingVertical: 12
    },
    replySystemEventText: {
      color: theme.ink,
      flexShrink: 1,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 18
    },
    replyHead: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 48
    },
    replyAuthorLink: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 10,
      minWidth: 0
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
      gap: 8,
      paddingLeft: 42,
      paddingRight: 0
    },
    replyTargetPill: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      backgroundColor: alphaColor(linkColor, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(linkColor, theme.dark ? 0.3 : 0.16),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5
    },
    replyTargetText: {
      color: linkColor,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16
    },
    replyBody: {
      paddingTop: 0
    },
    replySignature: {
      borderTopColor: theme.lineStrong,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 4,
      paddingBottom: 0,
      paddingTop: 8
    },
    replyStatRail: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4
    },
    replyThanksText: {
      alignSelf: 'flex-start',
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 4
    },
    replyActionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      justifyContent: 'flex-start',
      marginTop: -4,
      minHeight: 48,
      paddingTop: 0
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
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: radiusSm,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    replyQuoteBox: {
      backgroundColor: replyNeutralSurface,
      borderColor: replyNeutralBorder
    },
    quoteRowTop: {
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      borderBottomWidth: 0,
      paddingBottom: 8
    },
    quoteRowContinuation: {
      borderBottomWidth: 0,
      borderRadius: 0,
      borderTopWidth: 0,
      paddingBottom: 0,
      paddingTop: 0
    },
    quoteRowBottom: {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderTopWidth: 0,
      paddingTop: 0
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
      minHeight: 48,
      justifyContent: 'space-between'
    },
    quoteAuthorSummary: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      minHeight: 48,
      minWidth: 0
    },
    quotePanelState: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 6,
      minHeight: 48
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
    quoteTopicLink: {
      justifyContent: 'center',
      minHeight: 48
    },
    quoteTopicLinkText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * fontScale),
      fontWeight: '600',
      lineHeight: Math.round(21 * fontScale)
    },
    quotePreviewText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(14 * fontScale),
      lineHeight: Math.round(22 * fontScale)
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
    replyQuotePanelBody: {
      marginTop: 0,
      paddingBottom: 2,
      paddingTop: 10
    },
    replyMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    topicAccessNotice: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 12
    },
    topicAccessNoticeTitle: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700' as const,
      lineHeight: 22
    },
    topicAccessNoticeDetail: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 20
    },
    replyNewBadge: {
      alignSelf: 'flex-start' as const,
      overflow: 'hidden' as const,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600' as const,
      lineHeight: 16,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3
    }
  });
}

export type TopicStyles = ReturnType<typeof createTopicStyles>;
