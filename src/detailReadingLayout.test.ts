import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const topicScreenSource = readProjectFile('android-app', 'src', 'screens', 'TopicScreen.tsx');
const userScreenSource = readProjectFile('android-app', 'src', 'screens', 'UserScreen.tsx');
const themeSource = readProjectFile('android-app', 'src', 'theme.ts');

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
    expect(yaohuoTopicAction).not.toContain('感谢');
    expect(yaohuoReplyAction).not.toContain('感谢');
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

  it('shows forum reply context without requiring V2EX login actions', () => {
    const replyCardStart = topicScreenSource.indexOf('function ReplyCard(');
    const replyCardEnd = topicScreenSource.indexOf('const MemoizedReplyCard', replyCardStart);
    const replyCard = replyCardStart >= 0 && replyCardEnd > replyCardStart
      ? topicScreenSource.slice(replyCardStart, replyCardEnd)
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

  it('shows NodeSeek topic reaction counts without mixing them with local favorite state', () => {
    const topicActionStart = topicScreenSource.indexOf("if (listItem.type === 'topicActions') {");
    const replyComposerStart = topicScreenSource.indexOf("if (listItem.type === 'replyComposer') {");
    const topicActionRenderer = topicActionStart >= 0 && replyComposerStart > topicActionStart
      ? topicScreenSource.slice(topicActionStart, replyComposerStart)
      : '';

    expect(topicScreenSource).toContain('NodeSeekStatPill');
    expect(topicScreenSource).toContain('nodeSeekTopicReactionStats');
    expect(topicScreenSource).toContain('nodeSeekTopicPassiveStats');
    expect(topicScreenSource).toContain('collectionCount');
    expect(topicScreenSource).toContain('原站收藏');
    expect(topicScreenSource).toContain('topicStatRail');
    expect(topicScreenSource).toContain('replyStatRail');
    expect(themeSource).toContain('nodeSeekStatPill');
    expect(themeSource).toContain('nodeSeekStatValue');
    expect(topicActionRenderer).toContain('topicPassiveStats.map');
    expect(topicActionRenderer).not.toContain('topicPassiveStats.length ? (');
    expect(themeSource).toMatch(/nodeSeekStatPill:\s*\{[\s\S]*minHeight:\s*40[\s\S]*paddingVertical:\s*0/);
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

  it('only sends forum emoji and avatar images through the inline media path', () => {
    expect(topicScreenSource).toContain('flowInlineImagesInMixedParagraphs');
    expect(topicScreenSource).toContain('INLINE_FORUM_IMAGE_TAG');
    expect(topicScreenSource).toContain('HTMLContentModel.textual');
    expect(appSource).toContain('styles.inlineForumImage');
    expect(topicScreenSource).not.toContain('replaceInlineImagesWithAltText');
  });

  it('renders forum emoji images when a source is available', () => {
    const htmlRenderersBlock = appSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('if (!src) {');
    expect(htmlRenderersBlock).toContain('source={imageSourceFromUrl(src)}');
    expect(htmlRenderersBlock).toContain('inlineForumImageAlignmentStyle');
    expect(htmlRenderersBlock).not.toMatch(/if\s*\(isInlineForumImage\(props\.tnode\.attributes\)\)\s*\{\s*return <Text/);
    expect(htmlRenderersBlock).not.toContain('if (!src || isInlineForumImage(attributes))');
  });

  it('keeps accidental non-emoji inline image nodes out of the tiny image path', () => {
    const htmlRenderersBlock = appSource.match(/const InlineForumImageRenderer: CustomMixedRenderer = \(props\) => \{[\s\S]*?\n    \};/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('const isInlineImage = isInlineForumImage(attributes);');
    expect(htmlRenderersBlock).toContain('return <Text style={styles.inlineForumImageText}>{label || src}</Text>;');
    expect(htmlRenderersBlock).not.toContain('onPress={isPreviewableImageUrl(src) ? () => openImagePreview(src) : undefined}');
  });

  it('decodes block topic images from the original asset on Android', () => {
    const htmlRenderersBlock = appSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

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
