import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
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

  it('uses a thin reply divider and aligned pending state in topic details', () => {
    expect(themeSource).not.toContain('borderTopWidth: 12');
    expect(themeSource).toMatch(/replyHeader:\s*\{[\s\S]*width:\s*'100%'[\s\S]*borderTopWidth:\s*StyleSheet\.hairlineWidth/);
    expect(themeSource).toMatch(/loadingState:\s*\{[\s\S]*width:\s*'100%'/);
  });

  it('does not show the copy-quote action in reply cards', () => {
    const replyCard = topicScreenSource.match(/function ReplyCard\([\s\S]*?\n\}/)?.[0] || '';

    expect(replyCard).not.toContain('复制楼层引用');
    expect(replyCard).not.toContain('onCopyReplyMarkdown');
    expect(replyCard).not.toContain('icon={Copy}');
  });

  it('shows the quoted author beside the quote expand control', () => {
    const replyCardStart = topicScreenSource.indexOf('function ReplyCard(');
    const replyCardEnd = topicScreenSource.indexOf('const MemoizedReplyCard', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? topicScreenSource.slice(replyCardStart, replyCardEnd)
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
    const rendererEnd = topicScreenSource.indexOf('return { ...htmlRenderers, aside: QuoteAsideRenderer };', rendererStart);
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

  it('renders forum emoji images when a source is available', () => {
    const htmlRenderersBlock = appSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('if (!src) {');
    expect(htmlRenderersBlock).toContain('source={imageSourceFromUrl(src)}');
    expect(htmlRenderersBlock).toContain('inlineForumImageAlignmentStyle');
    expect(htmlRenderersBlock).not.toMatch(/if\s*\(isInlineForumImage\(props\.tnode\.attributes\)\)\s*\{\s*return <Text/);
    expect(htmlRenderersBlock).not.toContain('if (!src || isInlineForumImage(attributes))');
  });

  it('keeps non-emoji inline images at the regular inline preview size', () => {
    const htmlRenderersBlock = appSource.match(/const InlineForumImageRenderer: CustomMixedRenderer = \(props\) => \{[\s\S]*?\n    \};/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('const isInlineImage = isInlineForumImage(attributes);');
    expect(htmlRenderersBlock).toContain('style={styles.inlineForumImage}');
  });

  it('does not nest forum emoji images inside text wrappers', () => {
    const htmlRenderersBlock = appSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

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
