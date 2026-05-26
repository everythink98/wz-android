import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const searchScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'SearchScreen.tsx'), 'utf8');
const topicScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'TopicScreen.tsx'), 'utf8');
const userScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'UserScreen.tsx'), 'utf8');
const themeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'theme.ts'), 'utf8');

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

  it('defines roomier topic detail spacing tokens', () => {
    expect(topicScreenSource).toContain('topicMetaStack');
    expect(topicScreenSource).toContain('topicPrimaryActions');
    expect(topicScreenSource).toContain('topicTopActions');
    expect(topicScreenSource).toContain('topicPostActionArea');
    expect(appSource).toContain('htmlParagraph');
  });

  it('keeps the topic top bar focused on navigation and frequent actions', () => {
    const topBar = topicScreenSource.match(/<View style=\{styles\.topicTopBar\}>[\s\S]*?<\/View>\s*<FlatList/)?.[0] || '';

    expect(topBar).toContain('label="返回"');
    expect(topBar).toContain('{sourceLabel(item.source)}');
    expect(topBar).toContain('label={isFavorite(readerData, item) ? \'已收藏\' : \'收藏\'}');
    expect(topBar).toContain('label="更多操作"');
    expect(topicScreenSource).toContain('topicOverflowMenu');
    expect(topicScreenSource).toContain('原站打开');
    expect(topicScreenSource).toContain('onOpenOriginal(item.url)');
    expect(topBar).not.toContain('label="分享"');
    expect(topBar).not.toContain('label="刷新"');
    expect(topBar).not.toContain('label="原站"');
    expect(topBar).not.toContain('Reader Mode');
    expect(topBar).not.toContain('专注模式');
    expect(topBar).not.toContain('label="楼层"');
  });

  it('does not open NodeSeek user pages when only a display name is available', () => {
    expect(topicScreenSource).toContain("from '../userNavigation'");
    expect(topicScreenSource).toContain('userFromTopic(item)');
    expect(topicScreenSource).toContain('userFromReply(reply, source)');
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

  it('does not repeat the original-site button at the bottom of the main post', () => {
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';

    expect(topicActionRenderer).toContain('styles.topicPostActionArea');
    expect(topicActionRenderer).toContain('label="原站收藏"');
    expect(topicActionRenderer).not.toContain('label="原站"');
    expect(topicActionRenderer).not.toContain('ExternalLink');
    expect(topicActionRenderer).not.toContain('topicSecondaryActions');
  });

  it('labels NodeSeek like actions as add-chicken and keeps them out of Yaohuo actions', () => {
    const yaohuoTopicAction = topicScreenSource.match(/\{canWriteYaohuo \? \([\s\S]*?\n          \) : null\}/)?.[0] || '';
    const yaohuoReplyAction = topicScreenSource.match(/\{canWrite && source === 'yaohuo' \? \([\s\S]*?\n        \) : null\}/)?.[0] || '';

    expect(topicScreenSource).toContain('Drumstick');
    expect(topicScreenSource).toContain("label={`加鸡腿 ${topic?.likeCount ?? ''}`}");
    expect(topicScreenSource).toContain("label={`加鸡腿 ${reply.likeCount ?? ''}`}");
    expect(topicScreenSource).toContain('icon={Drumstick}');
    expect(topicScreenSource).not.toContain("createLucideIcon('ChickenLeg'");
    expect(topicScreenSource).not.toContain('icon={Heart}');
    expect(topicScreenSource).toContain("onInteract('like', topic?.commentId)");
    expect(topicScreenSource).toContain("onInteract('like', reply.commentId)");
    expect(topicScreenSource).not.toContain('感谢');
    expect(yaohuoTopicAction).not.toContain('加鸡腿');
    expect(yaohuoReplyAction).not.toContain('加鸡腿');
  });

  it('keeps detail action buttons visually aligned and stable', () => {
    expect(topicScreenSource).toContain('<IconButton tiny icon={ThumbsUp}');
    expect(topicScreenSource).toContain('<IconButton tiny icon={Drumstick}');
    expect(topicScreenSource).not.toContain('<IconButton tiny ghost icon={ThumbsUp}');
    expect(themeSource).toMatch(/buttonTiny:\s*\{[\s\S]*alignSelf:\s*'flex-start'[\s\S]*borderRadius:\s*999[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/buttonTextTiny:\s*\{[\s\S]*includeFontPadding:\s*false[\s\S]*lineHeight:\s*16/);
    expect(themeSource).toMatch(/topicPrimaryActions:\s*\{[\s\S]*alignItems:\s*'center'[\s\S]*justifyContent:\s*'flex-start'/);
    expect(themeSource).toMatch(/replyActionRow:\s*\{[\s\S]*alignItems:\s*'center'[\s\S]*minHeight:\s*40/);
  });

  it('separates reply floor, author, body, and actions for readable mobile replies', () => {
    expect(topicScreenSource).toContain('replyHead');
    expect(topicScreenSource).toContain('replyFloorBadge');
    expect(topicScreenSource).toContain('replyAuthorBlock');
    expect(topicScreenSource).toContain('replyContentArea');
    expect(topicScreenSource).toContain('replyBody');
    expect(topicScreenSource).toContain('replyActionRow');
  });

  it('does not show the copy-quote action in reply cards', () => {
    const replyCard = topicScreenSource.match(/function ReplyCard\([\s\S]*?\n\}/)?.[0] || '';

    expect(replyCard).not.toContain('复制楼层引用');
    expect(replyCard).not.toContain('onCopyReplyMarkdown');
    expect(replyCard).not.toContain('icon={Copy}');
  });

  it('shows author avatar slots in topic detail and replies without rewriting detail HTML', () => {
    expect(topicScreenSource).toContain('function AuthorAvatar');
    expect(topicScreenSource).toContain('SvgXml');
    expect(topicScreenSource).toContain('loadRemoteAvatarSvgText');
    expect(topicScreenSource).toContain('topicAuthorRow');
    expect(topicScreenSource).toContain('replyAvatarSmall');
    expect(topicScreenSource).not.toContain('replaceInlineImagesWithAltText');
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

  it('renders mixed paragraph images as inline media instead of centered block images', () => {
    expect(topicScreenSource).toContain('flowInlineImagesInMixedParagraphs');
    expect(topicScreenSource).toContain('INLINE_FORUM_IMAGE_TAG');
    expect(topicScreenSource).toContain('HTMLContentModel.textual');
    expect(appSource).toContain('styles.inlineForumImage');
  });

  it('keeps saved search records out of the Android search screen chrome', () => {
    expect(searchScreenSource).not.toContain('readerData.savedSearches.map');
    expect(searchScreenSource).not.toContain('const saved = readerData.savedSearches.find');
    expect(searchScreenSource).not.toContain('onSearchSourceChange(saved.source);');
    expect(searchScreenSource).not.toContain('items={readerData.savedSearches.map((item) => ({ value: item.query, label: item.query }))}');
  });

  it('keeps native controls large enough for touch use', () => {
    expect(themeSource).toMatch(/pill:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/tab:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/buttonIconOnly:\s*\{[\s\S]*width:\s*44[\s\S]*minHeight:\s*44/);
    expect(themeSource).toMatch(/buttonTiny:\s*\{[\s\S]*minHeight:\s*40/);
  });

  it('ties selected backgrounds and login panels to the current theme', () => {
    expect(themeSource).toContain('mist: alphaColor(palette.light, 0.065)');
    expect(themeSource).toContain('mist: alphaColor(palette.dark, 0.11)');
    expect(themeSource).toContain('const loginWebViewHeight = Math.min(480, Math.max(320, Math.round(windowHeight * 0.58)))');
    expect(themeSource).toMatch(/webViewShell:\s*\{[\s\S]*height:\s*loginWebViewHeight[\s\S]*backgroundColor:\s*theme\.surface/);
  });
});
