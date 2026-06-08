import { describe, expect, it, vi } from 'vitest';
import { readAppRuntimeSource, readProjectFile, readThemeRuntimeSource, readTopicRuntimeSource } from './sourceTestUtils';
import { createStyles, createTheme } from './theme';
import type { ReaderSettings } from './readerData';

vi.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (options: Record<string, unknown>) => options.android ?? options.default
  },
  StatusBar: {
    currentHeight: 24
  },
  StyleSheet: {
    hairlineWidth: 1,
    create: (styles: unknown) => styles
  }
}));

const appSource = readAppRuntimeSource();
const hiddenBrowserFetchControllerSource = readProjectFile('src', 'app', 'useHiddenBrowserFetchController.ts');
const htmlRenderingControllerSource = readProjectFile('src', 'app', 'useHtmlRenderingController.tsx');
const topicScreenSource = readTopicRuntimeSource();
const topicScreenHelpersSource = readProjectFile('src', 'screens', 'topic', 'topicScreenHelpers.ts');
const topicPollsSource = readProjectFile('src', 'screens', 'topic', 'TopicPolls.tsx');
const topicActionBarSource = readProjectFile('src', 'screens', 'topic', 'TopicActionBar.tsx');
const topicContentBlockSource = readProjectFile('src', 'screens', 'topic', 'TopicContentBlock.tsx');
const replyItemSource = readProjectFile('src', 'screens', 'topic', 'ReplyItem.tsx');
const topicMenuSource = readProjectFile('src', 'screens', 'topic', 'TopicMenu.tsx');
const topicCardSource = readProjectFile('src', 'components', 'TopicCard.tsx');
const userScreenSource = readProjectFile('src', 'screens', 'UserScreen.tsx');
const themeSource = readThemeRuntimeSource();
const defaultSettings: ReaderSettings = {
  theme: 'light',
  fontScale: 1,
  lineHeight: 'standard',
  contentWidth: 'standard',
  fontFamily: 'sans',
  listDensity: 'standard'
};
const topicUiSource = [
  topicScreenSource,
  topicPollsSource,
  topicActionBarSource,
  topicContentBlockSource,
  replyItemSource,
  topicMenuSource
].join('\n');

describe('Android topic detail reading layout', () => {
  it('uses render-html whitespace controls for cleaner native HTML output', () => {
    expect(topicScreenSource).toContain('enableExperimentalMarginCollapsing');
    expect(topicScreenSource).toContain('enableExperimentalBRCollapsing');
    expect(topicScreenSource).toContain('enableExperimentalGhostLinesPrevention');
  });

  it('limits forum inline styles so detail HTML follows the app reading layout', () => {
    const allowedInlineStyles = topicScreenSource.match(/HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = \[([^\]]+)\]/)?.[1] || '';

    expect(topicScreenSource).toContain('HTML_ALLOWED_INLINE_STYLES');
    expect(topicScreenSource).toContain('allowedStyles={HTML_ALLOWED_INLINE_STYLES}');
    expect(allowedInlineStyles).toContain("'fontWeight'");
    expect(allowedInlineStyles).not.toContain("'fontSize'");
    expect(allowedInlineStyles).not.toContain("'backgroundColor'");
  });

  it('does not keep an empty topic action row when the topic is read-only', () => {
    expect(appSource).not.toContain('<View style={styles.actions}>\n          {canWrite ?');
  });

  it('shows restricted topic details as an access notice instead of ordinary HTML body text', () => {
    expect(topicScreenSource).toContain('topicAccessNotice');
    expect(topicScreenSource).toContain('暂无权限');
    expect(topicScreenSource).toContain('forumAccessRequirementText(topic.accessRequirement)');
    expect(topicScreenSource).toContain('if (text.length > 240)');
    expect(topicScreenSource).toContain('requires?[^.]{0,40}(?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)');
    expect(topicScreenSource).toContain('minimum (?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)');
    expect(topicScreenSource).toContain('must be (?:at least )?(?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)');
    expect(hiddenBrowserFetchControllerSource).toContain('requires?[^.]{0,40}(?:trust\\\\s+level|level\\\\s*(?:of\\\\s+|[:：#-]\\\\s*)?\\\\d+)');
    expect(hiddenBrowserFetchControllerSource).toContain('minimum (?:trust\\\\s+level|level\\\\s*(?:of\\\\s+|[:：#-]\\\\s*)?\\\\d+)');
    expect(hiddenBrowserFetchControllerSource).toContain('must be (?:at least )?(?:trust\\\\s+level|level\\\\s*(?:of\\\\s+|[:：#-]\\\\s*)?\\\\d+)');

    const theme = createTheme(defaultSettings);
    const styles = createStyles(theme, defaultSettings, 800);
    expect(styles.topicAccessNoticeTitle.color).toBe(theme.danger);
    expect(styles.topicAccessNoticeDetail.color).toBe(theme.ink);
  });

  it('hides original-site actions and reply controls on restricted topic details', () => {
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(topicListItemsBlock).toContain('if (topic && !topicShowsAccessNotice)');
    expect(topicListItemsBlock).toContain('if (canShowReplies && !topicShowsAccessNotice)');
  });

  it('defines roomier topic detail spacing tokens', () => {
    expect(topicScreenSource).toContain('topicMetaStack');
    expect(topicScreenSource).toContain('topicPrimaryActions');
    expect(topicScreenSource).toContain('topicTopActions');
    expect(topicScreenSource).toContain('topicPostActionArea');
    expect(htmlRenderingControllerSource).toContain('htmlParagraph');
  });

  it('keeps the topic top bar focused on navigation and frequent actions', () => {
    const topBar = topicScreenSource.match(/<View style=\{styles\.topicTopBar\}>[\s\S]*?<\/View>\s*<FlatList/)?.[0] || '';

    expect(topBar).toContain('label="返回"');
    expect(topBar).toContain('{sourceLabel(item.source)}');
    expect(topBar).toContain("label={topicFavorite ? '已收藏' : '收藏'}");
    expect(topBar).toContain('label="更多操作"');
    expect(topicMenuSource).toContain('topicOverflowMenu');
    expect(topicMenuSource).toContain('原站打开');
    expect(topicMenuSource).toContain('onOpenOriginal(topicUrl)');
    expect(topBar).not.toContain('label="分享"');
    expect(topBar).not.toContain('label="刷新"');
    expect(topBar).not.toContain('label="原站"');
    expect(topBar).not.toContain('Reader Mode');
    expect(topBar).not.toContain('专注模式');
    expect(topBar).not.toContain('label="楼层"');
  });

  it('does not open NodeSeek user pages when only a display name is available', () => {
    expect(topicScreenSource).toContain("from '../../userNavigation'");
    expect(topicScreenSource).toContain('userFromTopic(item)');
    expect(replyItemSource).toContain('userFromReply(reply, source)');
  });

  it('puts post interaction actions after the main post body instead of before it', () => {
    const header = topicScreenSource.match(/const listHeader = \([\s\S]*?\n  \);/)?.[0] || '';
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const contentIndex = topicListItemsBlock.indexOf('const items = [...topicContentItems];');
    const postActionIndex = topicListItemsBlock.indexOf("items.push({ type: 'topicActions'");
    const replyControlsIndex = topicListItemsBlock.indexOf("items.push({ type: 'replyControls'");

    expect(contentIndex).toBeGreaterThan(-1);
    expect(postActionIndex).toBeGreaterThan(contentIndex);
    expect(replyControlsIndex).toBeGreaterThan(postActionIndex);
    expect(header).not.toContain('topicPrimaryActions');
    expect(header).not.toContain('点赞');
    expect(header).not.toContain('感谢');
    expect(header).not.toContain('投票');
    expect(topicScreenSource).toContain('styles.topicPostActionArea');
  });

  it('renders unified poll blocks from topic polls instead of source-specific vote options', () => {
    const topicPollStart = topicScreenSource.indexOf("if (listItem.type === 'topicPolls') {");
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicPollRenderer = topicPollStart >= 0 && topicActionStart > topicPollStart
      ? topicScreenSource.slice(topicPollStart, topicActionStart)
      : '';
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';

    expect(topicScreenSource).toContain('const topicPolls = topic?.polls || [];');
    expect(topicScreenSource).toContain('onVotePoll');
    expect(topicPollRenderer).toContain('<TopicPolls');
    expect(topicActionRenderer).not.toContain('<TopicPolls');
    expect(topicPollsSource).toContain('styles.pollBlock');
    expect(topicPollsSource).toContain('styles.pollFooter');
    expect(topicPollsSource).toContain('styles.pollMetaPill');
    expect(topicPollsSource).toContain('styles.pollStatePill');
    expect(topicPollsSource).toContain('styles.pollOptionList');
    expect(topicPollsSource).toContain('styles.pollOptionDivider');
    expect(topicPollsSource).toContain('styles.pollOptionProgress');
    expect(topicPollsSource).toContain('styles.pollOptionContent');
    expect(topicActionRenderer).not.toContain('voteOptions');
  });

  it('treats main post polls as detail content instead of post actions', () => {
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const topicPollStart = topicScreenSource.indexOf("if (listItem.type === 'topicPolls') {");
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicPollRenderer = topicPollStart >= 0 && topicActionStart > topicPollStart
      ? topicScreenSource.slice(topicPollStart, topicActionStart)
      : '';
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';
    const pollItemIndex = topicListItemsBlock.indexOf("items.push({ type: 'topicPolls'");
    const actionItemIndex = topicListItemsBlock.indexOf("items.push({ type: 'topicActions'");

    expect(topicScreenSource).toContain("{ type: 'topicPolls'; key: string }");
    expect(pollItemIndex).toBeGreaterThan(-1);
    expect(actionItemIndex).toBeGreaterThan(pollItemIndex);
    expect(topicPollRenderer).toContain('styles.articleBody');
    expect(topicPollRenderer).toContain('<TopicPolls');
    expect(topicPollRenderer).toContain('embeddedInArticle');
    expect(topicActionRenderer).not.toContain('<TopicPolls');
  });

  it('keeps poll result rows readable and stable on narrow detail screens', () => {
    const topicPollStart = topicScreenSource.indexOf("if (listItem.type === 'topicPolls') {");
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const topicPollRenderer = topicPollStart >= 0 && topicActionStart > topicPollStart
      ? topicScreenSource.slice(topicPollStart, topicActionStart)
      : '';

    expect(topicPollRenderer).toContain('<TopicPolls');
    expect(topicPollsSource).toContain('styles.pollOptionTextBlock');
    expect(topicPollRenderer).not.toContain('styles.pollOptionRowDisabled');
    expect(themeSource).toContain('pollOptionList');
    expect(themeSource).toContain('pollOptionDivider');
    expect(themeSource).toContain('pollOptionTextBlock');
    expect(themeSource).toContain('pollBlockFirstInArticle');
    expect(themeSource).toMatch(/pollOptionRow: \{[\s\S]*?minHeight: 48[\s\S]*?\n    \},/);
    expect(themeSource.match(/pollOptionRow: \{[\s\S]*?\n    \},/)?.[0] || '').not.toContain('borderRadius');
    expect(themeSource).toContain('pollHeader: {\n      alignItems: \'flex-start\',\n      gap: 8');
    expect(themeSource).toContain('pollFooter:');
  });

  it('uses poll choice limits to keep multi-choice submissions valid', () => {
    expect(topicPollsSource).toContain('pollChoiceRangeLabel');
    expect(topicPollsSource).toContain('pollSelectionRangeStatus');
    expect(topicScreenSource).toContain('<TopicPolls');
    expect(topicPollsSource).toContain('selectionRangeStatus');
    expect(topicPollsSource).toContain('Boolean(selectionRangeStatus)');
  });

  it('does not repeat the original-site button at the bottom of the main post', () => {
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';

    expect(topicActionRenderer).toContain('styles.topicPostActionArea');
    expect(topicActionRenderer).toContain('accessibilityLabel="原站收藏"');
    expect(topicActionRenderer).not.toContain('label="原站"');
    expect(topicActionRenderer).not.toContain('ExternalLink');
    expect(topicActionRenderer).not.toContain('topicSecondaryActions');
  });

  it('labels NodeSeek like actions as add-chicken and keeps them out of Yaohuo actions', () => {
    const yaohuoTopicAction = topicScreenSource.match(/\{canWriteYaohuo \? \([\s\S]*?\n          \) : null\}/)?.[0] || '';
    const yaohuoReplyAction = topicScreenSource.match(/\{canWrite && source === 'yaohuo' \? \([\s\S]*?\n        \) : null\}/)?.[0] || '';

    expect(topicUiSource).toContain('Drumstick');
    expect(topicScreenSource).toContain("accessibilityLabel={topic?.liked ? '已加鸡腿' : '加鸡腿'}");
    expect(replyItemSource).toContain("accessibilityLabel={reply.liked ? '已加鸡腿' : '加鸡腿'}");
    expect(topicUiSource).toContain('label="鸡腿"');
    expect(topicUiSource).toContain('icon={Drumstick}');
    expect(topicUiSource).not.toContain("createLucideIcon('ChickenLeg'");
    expect(topicUiSource).not.toContain('icon={Heart}');
    expect(topicScreenSource).toContain("onInteract('like', topic?.commentId)");
    expect(replyItemSource).toContain("onInteract('like', reply.commentId)");
    expect(yaohuoTopicAction).not.toContain('感谢');
    expect(yaohuoReplyAction).not.toContain('感谢');
    expect(yaohuoTopicAction).not.toContain('加鸡腿');
    expect(yaohuoReplyAction).not.toContain('加鸡腿');
  });

  it('shows NodeSeek one-way reactions, collection, and reply actions when logged in', () => {
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(topicActionRenderer).toContain("accessibilityLabel={topic?.upvoted ? '已点赞' : '点赞'}");
    expect(topicActionRenderer).toContain("accessibilityLabel={topic?.disliked ? '已反对' : '反对'}");
    expect(topicActionRenderer).toContain("accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'}");
    expect(topicActionRenderer).toContain("pending={isOptimisticActionPending(topic?.id, 'collection')}");
    expect(topicActionRenderer).toContain("onInteract('dislike', topic?.commentId)");
    expect(topicActionRenderer).toContain('onNodeSeekCollection');
    expect(replyCard).toContain("accessibilityLabel={reply.upvoted ? '已点赞' : '点赞'}");
    expect(replyCard).toContain("accessibilityLabel={reply.disliked ? '已反对' : '反对'}");
    expect(replyCard).toContain("onInteract('dislike', reply.commentId)");
    expect(replyCard).toContain('<DetailActionButton alignStart accessibilityLabel="回复" icon={MessageCircle} label="回复"');
  });

  it('keeps detail action buttons visually aligned and stable', () => {
    expect(topicActionBarSource).toContain('export function TopicActionBar');
    expect(topicActionBarSource).toContain('export const DetailActionButton = TopicActionBar;');
    expect(topicScreenSource).toContain('<DetailActionButton active={Boolean(topic?.upvoted)}');
    expect(replyItemSource).toContain('<DetailActionButton alignStart active={Boolean(reply.liked)}');
    expect(topicScreenSource).not.toContain('<IconButton tiny icon={ThumbsUp}');
    expect(topicActionBarSource).toContain('styles.detailActionIconSlot');
    expect(topicActionBarSource).toContain('alignStart && styles.replyDetailActionButton');
    expect(topicActionBarSource).toContain('alignStart && active && styles.replyDetailActionButtonActive');
    expect(topicActionBarSource).toContain("fill={active ? theme.primarySoft : 'none'}");
    expect(themeSource).toMatch(/detailActionButton:\s*\{[\s\S]*minHeight:\s*48[\s\S]*width:\s*74[\s\S]*borderRadius:\s*8/);
    expect(themeSource).toMatch(/replyDetailActionButton:\s*\{[\s\S]*justifyContent:\s*'flex-start'[\s\S]*paddingHorizontal:\s*0/);
    expect(themeSource).toMatch(/replyDetailActionButtonActive:\s*\{[\s\S]*backgroundColor:\s*'transparent'/);
    expect(themeSource).toMatch(/detailActionIconSlot:\s*\{[\s\S]*height:\s*22[\s\S]*width:\s*22/);
    expect(themeSource).toMatch(/detailActionTextBlock:\s*\{[\s\S]*alignItems:\s*'center'[\s\S]*flexShrink:\s*1/);
    expect(themeSource).toMatch(/detailActionLabel:\s*\{[\s\S]*includeFontPadding:\s*false[\s\S]*lineHeight:\s*16/);
    expect(themeSource).toMatch(/topicPrimaryActions:\s*\{[\s\S]*alignItems:\s*'center'[\s\S]*minHeight:\s*48/);
    expect(themeSource).toMatch(/replyActionRow:\s*\{[\s\S]*alignItems:\s*'center'[\s\S]*minHeight:\s*48/);
    expect(themeSource).not.toContain('marginLeft: -38');
  });

  it('keeps linux.do like totals in the reaction rail instead of the action buttons', () => {
    const linuxDoTopicActions = topicScreenSource.match(/\{canWriteLinuxDo \? \([\s\S]*?\n          \) : null\}/)?.[0] || '';
    const linuxDoReplyActions = replyItemSource.match(/\{canWrite && source === 'linuxdo' \? \([\s\S]*?\n        \) : null\}/)?.[0] || '';

    expect(replyItemSource).toContain("'boostCount' | 'reactionSummary' | 'likeCount'");
    expect(linuxDoTopicActions).toContain("accessibilityLabel={topic?.liked ? '取消赞' : '点赞'}");
    expect(linuxDoTopicActions).not.toContain('count={topic?.likeCount}');
    expect(linuxDoReplyActions).toContain("accessibilityLabel={reply.liked ? '取消赞' : '点赞'}");
    expect(linuxDoReplyActions).not.toContain('count={reply.likeCount}');
  });

  it('separates reply floor, author, body, and actions for readable mobile replies', () => {
    expect(replyItemSource).toContain('replyHead');
    expect(replyItemSource).toContain('replyFloorBadge');
    expect(replyItemSource).toContain('replyAuthorBlock');
    expect(replyItemSource).toContain('replyContentArea');
    expect(replyItemSource).toContain('replyBody');
    expect(replyItemSource).toContain('replyActionRow');
  });

  it('shows forum reply context without requiring V2EX login actions', () => {
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(replyCard).toContain('reply.isOp');
    expect(replyCard).toContain('styles.replyOpBadge');
    expect(replyCard).toContain('reply.hot');
    expect(replyCard).toContain('热门');
    expect(replyCard).toContain('reply.pinned');
    expect(replyCard).toContain('置顶');
    expect(replyCard).toContain('reply.replyTargetAuthor');
    expect(replyCard).toContain('styles.replyTargetPill');
    expect(replyCard).toContain('reply.signatureHtml');
    expect(replyCard).toContain('styles.replySignature');
    expect(replyCard).toContain('reply.thanksCount');
    expect(replyCard).not.toContain('source === \'v2ex\' ? (');
    expect(themeSource).toContain('replyContextBadge');
    expect(themeSource).toContain('replySignature');
  });

  it('places targeted reply composers under the selected reply instead of above the list', () => {
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(topicScreenSource).toContain("ReplyTarget | null");
    expect(topicListItemsBlock).toContain('if (canWrite && replyComposerOpen && !replyTarget)');
    expect(topicListItemsBlock).toContain('const targetReplyVisible = replyTarget ? replyItems.some((entry) => entry.type === \'reply\' && entry.replyFloor === replyTarget.floor) : false;');
    expect(topicListItemsBlock).toContain('if (canWrite && replyComposerOpen && replyTarget && !targetReplyVisible)');
    expect(topicListItemsBlock).toContain("items.push({ type: 'replyComposer', key: `reply-composer-hidden-target-${replyTarget.floor}`, replyFloor: replyTarget.floor });");
    expect(topicListItemsBlock).toContain("const isTargetReply = replyTarget && entry.type === 'reply' && entry.replyFloor === replyTarget.floor;");
    expect(topicListItemsBlock).toContain("items.push({ type: 'replyComposer', key: `reply-composer-${entry.replyFloor}`, replyFloor: entry.replyFloor });");
  });

  it('labels linux.do special poll types instead of calling them single choice polls', () => {
    const pollBlockStart = topicPollsSource.indexOf('export function TopicPolls');
    const pollBlockEnd = topicPollsSource.length;
    const pollBlock = pollBlockStart >= 0 && pollBlockEnd > pollBlockStart
      ? topicPollsSource.slice(pollBlockStart, pollBlockEnd)
      : '';

    expect(topicPollsSource).toContain('function pollTypeLabel');
    expect(topicPollsSource).toContain("ranked_choice: '排序投票'");
    expect(topicPollsSource).toContain("number: '数字投票'");
    expect(pollBlock).toContain('pollTypeLabel(poll)');
    expect(pollBlock).not.toContain("poll.multiple ? '多选' : '单选'");
  });

  it('renders linux.do polls inside replies with the same poll block styling', () => {
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(topicPollsSource).toContain('export function TopicPolls');
    expect(replyCard).toContain('polls={reply.polls || []}');
    expect(replyCard).toContain('onVotePoll={onVotePoll}');
    expect(topicPollsSource).toContain('styles.pollBlock');
  });

  it('shows linux.do topic tags and special status badges in Android details', () => {
    const header = topicScreenSource.match(/const listHeader = \([\s\S]*?\n  \);/)?.[0] || '';

    expect(topicScreenSource).toContain('topicStatusBadges(item)');
    expect(topicScreenSource).toContain("from './topicScreenHelpers'");
    expect(topicScreenHelpersSource).toContain('export function topicStatusBadges');
    expect(topicScreenHelpersSource).toContain('export function readableTopicError');
    expect(topicScreenHelpersSource).toContain('export function isAccessNoticeHtml');
    expect(topicScreenHelpersSource).toContain('getReplyKey');
    expect(header).toContain('topicHeaderStatusBadges');
    expect(header).toContain('styles.topicTagRow');
    expect(header).toContain('styles.topicStatusRow');
    expect(topicScreenSource).toContain('acceptedAnswerFloor');
    expect(topicScreenSource).toContain('slowModeSeconds');
    expect(topicScreenSource).toContain('已解决');
    expect(topicScreenSource).toContain('慢速');
    expect(themeSource).toContain('topicStatusRow');
    expect(themeSource).toContain('topicStatusBadge');
  });

  it('shows linux.do accepted answers and special reply markers in Android replies', () => {
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(replyCard).toContain('reply.acceptedAnswer');
    expect(replyCard).toContain('已采纳');
    expect(replyCard).toContain('reply.wiki');
    expect(replyCard).toContain('Wiki');
    expect(replyCard).toContain('reply.hidden');
    expect(replyCard).toContain('已隐藏');
    expect(replyCard).toContain('reply.folded');
    expect(replyCard).toContain('已折叠');
    expect(replyCard).toContain('reply.needsApproval');
    expect(replyCard).toContain('待审批');
    expect(replyCard).toContain('reply.systemAction');
    expect(replyCard).toContain('系统');
    expect(replyCard).toContain('linuxDoReplyReactionStats');
    expect(replyCard).toContain('styles.replyStatRail');
  });

  it('shows linux.do source tags on Android topic cards', () => {
    expect(topicScreenSource).toContain('topicStatusBadges');
    expect(topicCardSource).toContain('visibleTopicTags.map');
    expect(topicCardSource).toContain('styles.topicTagPill');
  });

  it('uses richer Android chip styling for tags and status markers', () => {
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(themeSource).toContain('TOPIC_TAG_TONES');
    expect(themeSource).toContain('topicTagColorStyle');
    expect(themeSource).toContain('topicStatusBadgeColorStyle');
    expect(themeSource).toContain('topicStatusBadgeTextColorStyle');
    expect(themeSource).toContain('replyContextBadgeStyle');
    expect(themeSource).toContain('topicTagMoreText');
    expect(themeSource).toContain('topicStatusBadgeText');
    expect(topicCardSource).toContain('TOPIC_CARD_TAG_LIMIT');
    expect(topicCardSource).toContain('hiddenTopicTagCount');
    expect(topicCardSource).toContain('topicTagColorStyle(tag, theme)');
    expect(topicCardSource).toContain('styles.topicTagMoreText');
    expect(topicScreenSource).toContain('topicStatusBadgeColorStyle(badge.tone, theme)');
    expect(topicScreenSource).toContain('topicStatusBadgeTextColorStyle(badge.tone, theme)');
    expect(topicScreenSource).toContain('topicTagColorStyle(tag, theme)');
    expect(replyItemSource).toContain('linuxDoReactionLabel');
    expect(replyItemSource).toContain("open_mouth: '惊讶'");
    expect(replyCard).toContain("replyContextBadgeStyle('success', theme)");
    expect(replyCard).toContain("replyContextBadgeStyle('warning', theme)");
    expect(replyCard).toContain("replyContextBadgeStyle('danger', theme)");
  });

  it('centers Android source tag text inside stable pill containers', () => {
    expect(topicCardSource).toContain('style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}');
    expect(topicScreenSource).toContain('style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}');
    expect(topicScreenSource).toContain('style={[styles.topicStatusBadge, topicStatusBadgeColorStyle(badge.tone, theme)]}');
    expect(themeSource).toContain('topicTagPill');
    expect(themeSource).toContain('topicStatusBadgeText');
    expect(themeSource).toContain('justifyContent: \'center\'');
    expect(themeSource).toContain('textAlignVertical: \'center\'');
    expect(themeSource).toContain('includeFontPadding: false');
  });

  it('shows NodeSeek topic reaction counts without mixing them with local favorite state', () => {
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';

    expect(replyItemSource).toContain('NodeSeekStatPill');
    expect(replyItemSource).toContain('nodeSeekTopicReactionStats');
    expect(replyItemSource).toContain('collectionCount');
    expect(topicScreenSource).toContain('原站收藏');
    expect(topicScreenSource).toContain('topicStatRail');
    expect(replyItemSource).toContain('replyStatRail');
    expect(themeSource).toContain('nodeSeekStatPill');
    expect(themeSource).toContain('nodeSeekStatCompact');
    expect(themeSource).toContain('nodeSeekStatText');
    expect(themeSource).toContain('nodeSeekStatValue');
    expect(topicActionRenderer).toContain("accessibilityLabel={topic?.collected ? '取消原站收藏' : '原站收藏'}");
    expect(topicActionRenderer).toContain('count={topic?.collectionCount}');
    expect(topicActionRenderer).not.toContain('topicPassiveStats.map');
    expect(themeSource).toMatch(/nodeSeekStatPill:\s*\{[\s\S]*minHeight:\s*40[\s\S]*paddingVertical:\s*0/);
    expect(themeSource).toMatch(/nodeSeekStatCompact:\s*\{[\s\S]*minHeight:\s*32[\s\S]*paddingHorizontal:\s*9/);
    expect(themeSource).toMatch(/nodeSeekStatText:\s*\{[\s\S]*includeFontPadding:\s*false[\s\S]*textAlignVertical:\s*'center'/);
    expect(themeSource).toMatch(/topicStatRail:\s*\{[\s\S]*minHeight:\s*40/);
  });

  it('wraps detail HTML tables in a horizontal reader area', () => {
    const rendererBlock = topicScreenSource.match(/const topicHtmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?return \{ \.\.\.htmlRenderers[\s\S]*?\};/)?.[0] || '';

    expect(topicScreenSource).toContain('ScrollView');
    expect(rendererBlock).toContain('TableRenderer');
    expect(rendererBlock).toContain("htmlTagName(props.tnode) !== 'table'");
    expect(rendererBlock).toContain('horizontal');
    expect(rendererBlock).toContain('styles.htmlTableScroll');
    expect(rendererBlock).toContain('styles.htmlTableFrame');
    expect(themeSource).toContain('htmlTableScroll');
    expect(themeSource).toContain('htmlTableFrame');
  });

  it('uses a thin reply divider and aligned pending state in topic details', () => {
    expect(themeSource).not.toContain('borderTopWidth: 12');
    expect(themeSource).toMatch(/replyHeader:\s*\{[\s\S]*width:\s*'100%'[\s\S]*borderTopWidth:\s*StyleSheet\.hairlineWidth/);
    expect(themeSource).toMatch(/loadingState:\s*\{[\s\S]*width:\s*'100%'/);
  });

  it('does not show the copy-quote action in reply cards', () => {
    const replyCard = replyItemSource.match(/export function ReplyItem\([\s\S]*?\n\}/)?.[0] || '';

    expect(replyCard).not.toContain('复制楼层引用');
    expect(replyCard).not.toContain('onCopyReplyMarkdown');
    expect(replyCard).not.toContain('icon={Copy}');
  });

  it('shows the quoted author beside the quote expand control', () => {
    const replyCardStart = replyItemSource.indexOf('export function ReplyItem(');
    const replyCardEnd = replyItemSource.indexOf('export const MemoizedReplyItem', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? replyItemSource.slice(replyCardStart, replyCardEnd)
      : '';

    expect(replyCard).toContain('styles.quoteHeader');
    expect(replyCard).toContain('styles.quoteAuthorSummary');
    expect(replyCard).toContain('const quotedAuthorFromMarkup = reply.quotedAuthors?.[quotedFloor];');
    expect(replyCard).toContain("const quotedAuthorName = quotedReply?.author || quotedAuthorFromMarkup || '未知作者';");
    expect(replyCard).toContain('quotedReply ? <AuthorAvatar small name={quotedReply.author}');
    expect(replyCard).toContain('{quotedAuthorName}');
    expect(replyCard).toContain("label={loading ? '读取' : expanded ? '收起' : '展开'}");
    expect(themeSource).toContain('quoteHeader');
    expect(themeSource).toContain('quoteAuthorSummary');
    expect(themeSource).toContain('quoteAuthorText');
  });

  it('collapses native linux.do HTML quote blocks behind an expand control', () => {
    const rendererStart = topicScreenSource.indexOf('const QuoteAsideRenderer: CustomBlockRenderer');
    const rendererEnd = topicScreenSource.indexOf('const TableRenderer: CustomBlockRenderer', rendererStart);
    const quoteRenderer = rendererStart >= 0 && rendererEnd > rendererStart
      ? topicScreenSource.slice(rendererStart, rendererEnd)
      : '';

    expect(topicScreenSource).toContain('type CustomBlockRenderer');
    expect(topicScreenSource).toContain('TChildrenRenderer');
    expect(topicScreenSource).toContain('useTNodeChildrenProps');
    expect(topicScreenSource).toContain('const topicHtmlRenderers = useMemo<HtmlRenderers>');
    expect(topicScreenSource).toContain('renderers={topicHtmlRenderers}');
    expect(quoteRenderer).toContain("hasHtmlClass(props.tnode, 'quote')");
    expect(quoteRenderer).toContain('accessibilityState={{ expanded }}');
    expect(quoteRenderer).toContain('android_ripple={androidRipple(theme.primarySoft)}');
    expect(quoteRenderer).toContain('const StateIcon = expanded ? ChevronUp : ChevronDown;');
    expect(quoteRenderer).toContain('styles.quotePanelHeader');
    expect(quoteRenderer).toContain('styles.quotePanelState');
    expect(quoteRenderer).toContain("expanded ? '收起' : '展开'");
    expect(quoteRenderer).toContain('setExpanded((value) => !value)');
    expect(quoteRenderer).toContain('expanded && quoteBodyChildren.length');
    expect(themeSource).toContain('quotePanelHeader');
    expect(themeSource).toContain('quotePanelState');
    expect(themeSource).toContain('quotePanelStateIcon');
  });

  it('shows author avatar slots in topic detail and replies without rewriting detail HTML', () => {
    expect(replyItemSource).toContain('function AuthorAvatar');
    expect(replyItemSource).toContain('SvgXml');
    expect(replyItemSource).toContain('loadRemoteAvatarSvgText');
    expect(topicScreenSource).toContain('topicAuthorRow');
    expect(replyItemSource).toContain('replyAvatarSmall');
    expect(topicUiSource).not.toContain('replaceInlineImagesWithAltText');
  });

  it('uses the SVG avatar fallback on user profile pages too', () => {
    expect(userScreenSource).toContain('SvgXml');
    expect(userScreenSource).toContain('loadRemoteAvatarSvgText');
    expect(userScreenSource).not.toContain('imageSourceFromUrl(user.avatar)');
  });

  it('falls back to profile initials when user profile avatars fail to load', () => {
    expect(userScreenSource).toContain('const [imageFailed, setImageFailed] = useState(false);');
    expect(userScreenSource).toContain('onError={() => setImageFailed(true)}');
    expect(userScreenSource).toContain('uri && !imageFailed');
  });

  it('only sends forum emoji and avatar images through the inline media path', () => {
    expect(topicContentBlockSource).toContain('flowInlineImagesInMixedParagraphs');
    expect(topicScreenSource).toContain('INLINE_FORUM_IMAGE_TAG');
    expect(topicScreenSource).toContain('HTMLContentModel.textual');
    expect(htmlRenderingControllerSource).toContain('styles.inlineForumImage');
    expect(topicUiSource).not.toContain('replaceInlineImagesWithAltText');
  });

  it('renders forum emoji images when a source is available', () => {
    const htmlRenderersBlock = htmlRenderingControllerSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('if (!src) {');
    expect(htmlRenderersBlock).toContain('source={imageSourceFromUrl(src)}');
    expect(htmlRenderersBlock).toContain('inlineForumImageAlignmentStyle');
    expect(htmlRenderersBlock).not.toMatch(/if\s*\(isInlineForumImage\(props\.tnode\.attributes\)\)\s*\{\s*return <Text/);
    expect(htmlRenderersBlock).not.toContain('if (!src || isInlineForumImage(attributes))');
  });

  it('keeps accidental non-emoji inline image nodes out of the tiny image path', () => {
    const htmlRenderersBlock = htmlRenderingControllerSource.match(/const InlineForumImageRenderer: CustomMixedRenderer = \(props\) => \{[\s\S]*?\n    \};/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('const isInlineImage = isInlineForumImage(attributes);');
    expect(htmlRenderersBlock).toContain('return <Text style={styles.inlineForumImageText}>{label || src}</Text>;');
    expect(htmlRenderersBlock).not.toContain('onPress={isPreviewableImageUrl(src) ? () => openImagePreview(src) : undefined}');
  });

  it('decodes block topic images from the original asset on Android', () => {
    const htmlRenderersBlock = htmlRenderingControllerSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('useIMGElementState');
    expect(htmlRenderersBlock).toContain('source={imageState.source}');
    expect(htmlRenderersBlock).toContain('resizeMethod="none"');
    expect(appSource).not.toContain('PixelRatio');
    expect(htmlRenderersBlock).not.toContain("resizeMethod: 'resize'");
    expect(htmlRenderersBlock).not.toContain('resizeMultiplier');
  });

  it('keeps topic detail image cells mounted while scrolling through very tall images', () => {
    const topicListBlock = topicScreenSource.match(/<FlatList[\s\S]*?renderItem=\{renderReplyItem\}/)?.[0] || '';

    expect(topicScreenSource).toContain('TOPIC_DETAIL_LIST_PERFORMANCE_PROPS');
    expect(topicListBlock).toContain('{...TOPIC_DETAIL_LIST_PERFORMANCE_PROPS}');
    expect(topicListBlock).not.toContain('{...REPLY_LIST_PERFORMANCE_PROPS}');
  });

  it('does not nest forum emoji images inside text wrappers', () => {
    const htmlRenderersBlock = htmlRenderingControllerSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).not.toContain(`if (isInlineForumImage(props.tnode.attributes)) {
        return (
          <Text`);
    expect(htmlRenderersBlock).not.toContain(`if (isInlineImage) {
        return (
          <Text`);
  });

  it('preserves empty inline forum image nodes for custom rendering', () => {
    const customModelBlock = topicScreenSource.match(/const HTML_CUSTOM_ELEMENT_MODELS = \{[\s\S]*?\n\};/)?.[0] || '';

    expect(customModelBlock).toContain('isOpaque: true');
  });

  it('renders forum details and summary blocks instead of dropping their contents', () => {
    const customModelBlock = topicScreenSource.match(/const HTML_CUSTOM_ELEMENT_MODELS = \{[\s\S]*?\n\};/)?.[0] || '';

    expect(customModelBlock).toContain('defaultHTMLElementModels.details.extend');
    expect(customModelBlock).toContain('defaultHTMLElementModels.summary.extend');
    expect(customModelBlock).toMatch(/details:[\s\S]*contentModel:\s*HTMLContentModel\.mixed/);
    expect(customModelBlock).toMatch(/summary:[\s\S]*contentModel:\s*HTMLContentModel\.mixed/);
  });

  it('renders forum details as collapsible step panels', () => {
    const topicHtmlRenderersBlock = topicScreenSource.match(/const topicHtmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(topicHtmlRenderersBlock).toContain('const DetailsRenderer');
    expect(topicHtmlRenderersBlock).toContain("htmlTagName(child) === 'summary'");
    expect(topicHtmlRenderersBlock).toContain('detailsSummaryTextFromDom(props.tnode)');
    expect(topicHtmlRenderersBlock).toContain('detailSummaryText ?');
    expect(topicHtmlRenderersBlock).toContain('props.tnode.attributes?.open !== undefined');
    expect(topicHtmlRenderersBlock).toContain('accessibilityState={{ expanded }}');
    expect(topicHtmlRenderersBlock).toContain('expanded && detailBodyChildren.length');
    expect(topicHtmlRenderersBlock).toContain('details: DetailsRenderer');
    expect(topicScreenSource).toContain('ChevronRight');
    expect(themeSource).toContain('detailsPanel');
    expect(themeSource).toContain('detailsPanelSummaryText');
    expect(themeSource).toContain('detailsPanelBody');
  });

  it('does not repeat details summary text inside the expanded panel body', () => {
    const htmlTagNameBlock = topicScreenSource.match(/function htmlTagName\(tnode: unknown\) \{[\s\S]*?\n\}/)?.[0] || '';
    const topicHtmlRenderersBlock = topicScreenSource.match(/const topicHtmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlTagNameBlock).toContain("domNodeTagName((tnode as { domNode?: unknown }).domNode)");
    expect(topicHtmlRenderersBlock).toContain("props.tnode.children.find((child) => htmlTagName(child) === 'summary')");
    expect(topicHtmlRenderersBlock).toContain('props.tnode.children.filter((child) => child !== summaryNode)');
    expect(topicHtmlRenderersBlock).toContain('const SummaryRenderer: CustomBlockRenderer = () => null;');
    expect(topicHtmlRenderersBlock).toContain('summary: SummaryRenderer');
  });

  it('keeps native controls large enough for touch use', () => {
    expect(themeSource).toMatch(/pill:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/tab:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/buttonIconOnly:\s*\{[\s\S]*width:\s*44[\s\S]*minHeight:\s*44/);
    expect(themeSource).toMatch(/buttonTiny:\s*\{[\s\S]*minHeight:\s*40/);
  });

  it('ties theme accent and login panels to the current theme', () => {
    expect(themeSource).toContain('mist: alphaColor(palette.light, 0.065)');
    expect(themeSource).toContain('mist: alphaColor(palette.dark, 0.11)');
    expect(themeSource).toContain('const loginWebViewHeight = Math.min(480, Math.max(320, Math.round(windowHeight * 0.58)))');
    expect(themeSource).toMatch(/webViewShell:\s*\{[\s\S]*height:\s*loginWebViewHeight[\s\S]*backgroundColor:\s*theme\.surface/);
  });
});
