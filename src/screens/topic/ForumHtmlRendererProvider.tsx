import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode
} from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { useEvent } from 'expo';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import { ChevronDown, ChevronRight, ChevronUp, Play } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import {
  HTMLContentModel,
  HTMLElementModel,
  RenderHTMLConfigProvider,
  TChildrenRenderer,
  TRenderEngineProvider,
  defaultHTMLElementModels,
  getNativePropsForTNode,
  useContentWidth,
  useIMGElementProps,
  useIMGElementState,
  useTNodeChildrenProps,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import type {
  HtmlBaseStyle,
  HtmlClassesStyles,
  HtmlIgnoredStyles,
  HtmlRenderers,
  HtmlRenderersProps,
  HtmlTagsStyles
} from '../../appTypes';
import { ForumContentVideo } from '../../components/ForumContentVideo';
import { useForumMediaPlaybackActive } from '../../forumMediaPlayback';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  imageRequestHeadersForUrl,
  imageSourceFromUrl,
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  isInlineForumImage,
  shouldMarkLoadedImageInline
} from '../../htmlImages';
import { HTML_ALLOWED_INLINE_STYLES } from '../../htmlRenderingStyles';
import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
} from '../../localHtml';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '../../nsVideoEmbeds';
import type { ReaderSettings } from '../../readerData';
import { androidRipple, createStyles, type ReaderTheme } from '../../theme';
import { FORUM_REPLY_REFERENCE_TAG } from '../../topicContentHtml';

export type ForumHtmlRendererContextValue = {
  htmlBaseLineHeight?: number;
  markInlineSizedImageUrl: (url: string) => void;
  nodeSeekMediaCookieHeader?: string;
  nodeSeekMediaUserAgent?: string;
  onOpenImagePreview: (url: string) => void;
  openHtmlLink: (href: string, event?: { stopPropagation?: () => void }) => void;
  settings: ReaderSettings;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  webViewBlockMessage: string;
};

const ForumHtmlRendererContext = createContext<ForumHtmlRendererContextValue | null>(null);

function useForumHtmlRendererContext() {
  const value = useContext(ForumHtmlRendererContext);
  if (!value) {
    throw new Error('Forum HTML renderer must be rendered inside ForumHtmlRendererProvider');
  }
  return value;
}

export function shouldShowPreviewImageLoading(imageStateType: 'loading' | 'success' | 'error', nativeImageLoaded: boolean) {
  return imageStateType === 'loading' || (imageStateType === 'success' && !nativeImageLoaded);
}

export function shouldShowVideoStickerLoading(firstFrameRendered: boolean, loadFailed: boolean, status: VideoPlayerStatus) {
  return !loadFailed && (status === 'loading' || (status !== 'error' && !firstFrameRendered));
}

function isVideoStickerUrl(url: string) {
  return /\.(?:webm|mp4|mov)(?:[?#].*)?$/i.test(url);
}

function videoStickerRequestHeaders(url: string, cookieHeader?: string, userAgent?: string): Record<string, string> | undefined {
  const headers = imageRequestHeadersForUrl(url, cookieHeader, userAgent);
  return headers ? {
    ...headers,
    Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8'
  } : undefined;
}

function domText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { children?: unknown; data?: unknown };
  const ownText = typeof record.data === 'string' ? record.data : '';
  const childText = Array.isArray(record.children) ? record.children.map(domText).join('') : '';
  return `${ownText}${childText}`;
}

function tnodeText(tnode: unknown) {
  return (domText(tnode) || domText((tnode as { domNode?: unknown }).domNode))
    .replace(/\u00a0/g, ' ')
    .trim();
}

function terminalNodeAttribute(node: unknown, name: string) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as {
    attribs?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    getAttribute?: (name: string) => unknown;
  };
  return String(record.attributes?.[name] || record.attribs?.[name] || record.getAttribute?.(name) || '');
}

function terminalNodeChildren(node: unknown) {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const record = node as { childNodes?: unknown[]; children?: unknown[] };
  return Array.isArray(record.childNodes) ? record.childNodes : Array.isArray(record.children) ? record.children : [];
}

function terminalNodeTagName(node: unknown) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { name?: unknown; tagName?: unknown };
  return String(record.tagName || record.name || '').toLowerCase();
}

function terminalTextStyle(tnode: unknown) {
  const style = terminalNodeAttribute(tnode, 'style');
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1].trim();
  const backgroundColor = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i)?.[1].trim();
  return {
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {})
  };
}

function terminalTextChildren(tnode: unknown, key: string, style: TextStyle = {}): ReactNode[] {
  if (!tnode || typeof tnode !== 'object') {
    return [];
  }
  const record = tnode as { children?: unknown; data?: unknown; tagName?: unknown; type?: unknown };
  if (record.type === 'text') {
    const text = typeof record.data === 'string' ? record.data : '';
    return text ? [Object.keys(style).length ? <Text key={key} style={style}>{text}</Text> : text] : [];
  }
  if (terminalNodeTagName(tnode) === 'br') {
    return ['\n'];
  }
  const nextStyle = { ...style, ...terminalTextStyle(tnode) };
  return terminalNodeChildren(tnode).flatMap((child, index) => terminalTextChildren(child, `${key}.${index}`, nextStyle));
}

function htmlTagName(tnode: unknown) {
  const tagName = ((tnode as { tagName?: string }).tagName || '').toLowerCase();
  return tagName || domNodeTagName((tnode as { domNode?: unknown }).domNode);
}

function domNodeTagName(node: unknown) {
  const record = node as { name?: unknown; tagName?: unknown };
  return String(record?.name || record?.tagName || '').toLowerCase();
}

function domNodeTextContent(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { children?: unknown; data?: unknown };
  const ownText = typeof record.data === 'string' ? record.data : '';
  const childText = Array.isArray(record.children) ? record.children.map(domNodeTextContent).join('') : '';
  return `${ownText}${childText}`;
}

function detailsSummaryTextFromDom(tnode: unknown) {
  const domNode = (tnode as { domNode?: { children?: unknown[] } }).domNode;
  const summaryNode = Array.isArray(domNode?.children) ? domNode.children.find((child) => domNodeTagName(child) === 'summary') : undefined;
  return domNodeTextContent(summaryNode).replace(/\s+/g, ' ').trim();
}

function hasHtmlClass(tnode: unknown, className: string) {
  const classValue = ((tnode as { attributes?: Record<string, string | undefined> }).attributes?.class || '');
  return classValue.split(/\s+/).includes(className);
}

function ForumVideoStickerVideo({
  fallbackSrc,
  headers,
  loadingColor,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  headers?: Record<string, string>;
  loadingColor: string;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const playbackActive = useForumMediaPlaybackActive();
  const headerAccept = headers?.Accept || '';
  const headerCookie = headers?.Cookie || '';
  const headerReferer = headers?.Referer || '';
  const headerUserAgent = headers?.['User-Agent'] || '';
  const hasHeaders = Boolean(headers);
  const source = useMemo<VideoSource>(() => ({
    uri: src,
    ...(hasHeaders ? {
      headers: {
        ...(headerAccept ? { Accept: headerAccept } : {}),
        ...(headerCookie ? { Cookie: headerCookie } : {}),
        ...(headerReferer ? { Referer: headerReferer } : {}),
        ...(headerUserAgent ? { 'User-Agent': headerUserAgent } : {})
      }
    } : {}),
    contentType: 'progressive'
  }), [hasHeaders, headerAccept, headerCookie, headerReferer, headerUserAgent, src]);
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
    nextPlayer.keepScreenOnWhilePlaying = false;
  });
  useEffect(() => {
    if (playbackActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [playbackActive, player]);
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  useEffect(() => {
    setFirstFrameRendered(false);
  }, [headerAccept, headerCookie, headerReferer, headerUserAgent, src]);
  const loadFailed = status === 'error';
  const showLoading = shouldShowVideoStickerLoading(firstFrameRendered, loadFailed, status);
  const showFallback = fallbackSrc && (!firstFrameRendered || loadFailed);
  return (
    <View pointerEvents="none" style={videoStyle}>
      {!loadFailed ? (
        <VideoView
          allowsVideoFrameAnalysis={false}
          contentFit="contain"
          fullscreenOptions={{ enable: false }}
          nativeControls={false}
          onFirstFrameRender={() => setFirstFrameRendered(true)}
          player={player}
          style={embedStyles.stickerVideoFill}
          surfaceType="textureView"
          useExoShutter={false}
        />
      ) : null}
      {showFallback ? (
        <Image
          resizeMode="contain"
          source={imageSourceFromUrl(fallbackSrc, undefined, headers?.Cookie, headers?.['User-Agent'])}
          style={embedStyles.stickerVideoFallback}
        />
      ) : null}
      {showLoading ? (
        <View style={embedStyles.stickerVideoLoading}>
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const ReplyReferenceRenderer: CustomBlockRenderer = (props) => {
  const { openHtmlLink, styles } = useForumHtmlRendererContext();
  const attributes = props.tnode.attributes || {};
  const mention = attributes['data-mention'] || '';
  const floor = attributes['data-floor'] || '';
  const userHref = attributes['data-user-href'] || '';
  if (!mention && !floor) {
    return null;
  }
  return (
    <View style={styles.htmlReplyReferenceRow}>
      <Text style={styles.htmlReplyReferenceLabel}>回复</Text>
      {mention ? (
        <Pressable accessibilityRole="link" disabled={!userHref} onPress={(event) => openHtmlLink(userHref, event)}>
          <Text style={styles.htmlReplyReferenceMentionText}>{mention}</Text>
        </Pressable>
      ) : null}
      {mention && floor ? <Text style={styles.htmlReplyReferenceSeparator}>·</Text> : null}
      {floor ? <Text style={styles.htmlReplyReferenceFloorText}>{floor}</Text> : null}
    </View>
  );
};

const ReplyReferenceLinkRenderer: CustomMixedRenderer = (props) => {
  const { openHtmlLink, styles } = useForumHtmlRendererContext();
  const className = String(props.tnode.attributes?.class || '');
  const isMentionLink = className.split(/\s+/).includes('forum-mention-link');
  const isFloorLink = className.split(/\s+/).includes('forum-floor-link');
  if (!isMentionLink && !isFloorLink) {
    const { InternalRenderer, ...internalRendererProps } = props;
    return <InternalRenderer {...internalRendererProps} />;
  }
  const nativeProps = getNativePropsForTNode(props);
  if (isFloorLink) {
    const { accessibilityRole: _accessibilityRole, onPress: _onPress, ...textProps } = nativeProps;
    return <Text {...textProps} style={[textProps.style, styles.htmlFloorLink]} />;
  }
  const href = props.tnode.attributes?.href || '';
  return (
    <Text
      {...nativeProps}
      accessibilityRole="link"
      onPress={(event) => openHtmlLink(href, event)}
      style={[nativeProps.style, styles.htmlMentionLink]}
    />
  );
};

function VideoEmbedBlock({ embedUrl }: { embedUrl: string }) {
  const { styles, theme, webViewBlockMessage } = useForumHtmlRendererContext();
  const [loaded, setLoaded] = useState(false);
  const playbackActive = useForumMediaPlaybackActive();
  useEffect(() => {
    if (!playbackActive) {
      setLoaded(false);
    }
  }, [playbackActive]);
  return (
    <View style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      {webViewBlockMessage ? (
        <View style={embedStyles.blockedWebView}>
          <Text style={[styles.inlineForumImageText, { color: theme.muted }]}>{webViewBlockMessage}</Text>
        </View>
      ) : loaded && playbackActive ? (
        <WebView
          allowsFullscreenVideo
          domStorageEnabled
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          onShouldStartLoadWithRequest={(request) => shouldAllowBilibiliWebViewNavigation(request.url)}
          source={{ uri: embedUrl }}
          setSupportMultipleWindows={false}
          style={embedStyles.webView}
        />
      ) : (
        <Pressable
          accessibilityLabel="加载并播放嵌入视频"
          accessibilityRole="button"
          onPress={() => setLoaded(true)}
          style={embedStyles.videoPlaceholder}
        >
          <Play color={theme.primaryStrong} fill={theme.primaryStrong} size={34} />
          <Text style={[embedStyles.videoPlaceholderText, { color: theme.primaryStrong }]}>点击播放嵌入视频</Text>
        </Pressable>
      )}
    </View>
  );
}

const ForumVideoStickerRenderer: CustomBlockRenderer = (props) => {
  const { nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent, settings, styles, theme } = useForumHtmlRendererContext();
  const attributes = props.tnode.attributes || {};
  const src = attributes.src || '';
  const fallbackSrc = attributes['data-fallback-src'] || '';
  const contentWidth = useContentWidth();
  const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
  if (!src) {
    return fallbackSrc ? <Image source={imageSourceFromUrl(fallbackSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} /> : null;
  }
  if (!isVideoStickerUrl(src)) {
    return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} />;
  }
  const headers = videoStickerRequestHeaders(src, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent);
  return (
    <ForumVideoStickerVideo
      key={`${src}:${headers?.Cookie ? 'auth' : 'anonymous'}`}
      fallbackSrc={fallbackSrc}
      headers={headers}
      loadingColor={theme.primary}
      src={src}
      videoStyle={[size, embedStyles.inlineVideoSticker, embedStyles.stickerVideoFrame]}
    />
  );
};

const ForumVideoRenderer: CustomBlockRenderer = (props) => {
  const { theme } = useForumHtmlRendererContext();
  const src = props.tnode.attributes?.src || '';
  return src ? <ForumContentVideo src={src} theme={theme} /> : null;
};

const ForumStickerRenderer: CustomMixedRenderer = (props) => {
  const { nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent, settings, styles } = useForumHtmlRendererContext();
  const attributes = props.tnode.attributes || {};
  const src = attributes.src || '';
  const contentWidth = useContentWidth();
  const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
  if (!src) {
    return <Text style={styles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
  }
  return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} />;
};

const ForumStickerRowRenderer: CustomBlockRenderer = (props) => (
  <View style={embedStyles.stickerRow}>
    <TChildrenRenderer tchildren={props.tnode.children} />
  </View>
);

const ForumInlineMediaLineRenderer: CustomBlockRenderer = (props) => (
  <View style={embedStyles.inlineMediaLine}>
    <TChildrenRenderer tchildren={props.tnode.children} />
  </View>
);

const LinkCardRenderer: CustomBlockRenderer = (props) => {
  const { nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent, openHtmlLink, theme } = useForumHtmlRendererContext();
  const attributes = props.tnode.attributes || {};
  const href = attributes.href || '';
  const site = attributes.site || '';
  const title = attributes.title || site || href;
  const description = attributes.description || '';
  const imageSrc = attributes['image-src'] || '';
  const iconSrc = attributes['icon-src'] || '';
  if (!href) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="link"
      android_ripple={androidRipple(theme.mist)}
      style={[embedStyles.linkCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
      onPress={(event) => {
        event.stopPropagation?.();
        openHtmlLink(href, event);
      }}
    >
      {site || iconSrc ? (
        <View style={embedStyles.linkCardHeader}>
          {iconSrc ? <ExpoImage contentFit="contain" source={imageSourceFromUrl(iconSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={embedStyles.linkCardIcon} /> : null}
          {site ? <Text numberOfLines={1} style={[embedStyles.linkCardSite, { color: theme.muted }]}>{site}</Text> : null}
        </View>
      ) : null}
      <View style={embedStyles.linkCardBody}>
        {imageSrc ? <ExpoImage contentFit="cover" source={imageSourceFromUrl(imageSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[embedStyles.linkCardThumbnail, { backgroundColor: theme.surface2 }]} /> : null}
        <View style={embedStyles.linkCardText}>
          <Text numberOfLines={3} style={[embedStyles.linkCardTitle, { color: theme.primaryStrong }]}>{title}</Text>
          {description ? <Text numberOfLines={3} style={[embedStyles.linkCardDescription, { color: theme.ink }]}>{description}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
};

const TerminalReportRenderer: CustomBlockRenderer = (props) => {
  const { theme } = useForumHtmlRendererContext();
  const tabNodes = props.tnode.children.filter((child) => (
    String((child as { tagName?: unknown }).tagName || '').toLowerCase() === FORUM_TERMINAL_TAB_TAG
  ));
  const [activeIndex, setActiveIndex] = useState(0);
  if (!tabNodes.length) {
    return <TChildrenRenderer tchildren={props.tnode.children} />;
  }
  const activeTab = tabNodes[Math.min(activeIndex, tabNodes.length - 1)];
  return (
    <View style={terminalStyles.report}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={terminalStyles.tabRow}>
        {tabNodes.map((tabNode, index) => {
          const title = String((tabNode as { attributes?: Record<string, string | undefined> }).attributes?.title || `Tab ${index + 1}`);
          const active = index === activeIndex;
          return (
            <Pressable
              key={`${title}:${index}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`切换到${title}`}
              android_ripple={androidRipple(theme.primarySoft)}
              style={[
                terminalStyles.tabButton,
                index === 0 ? terminalStyles.tabButtonFirst : null,
                index === tabNodes.length - 1 ? terminalStyles.tabButtonLast : null,
                active ? terminalStyles.tabButtonActive : terminalStyles.tabButtonInactive,
                {
                  backgroundColor: active ? theme.surface : theme.surface2,
                  borderColor: theme.line,
                  borderBottomColor: active ? theme.surface : theme.line
                }
              ]}
              onPress={() => setActiveIndex(index)}
            >
              <Text numberOfLines={1} style={[terminalStyles.tabText, { color: active ? theme.primaryStrong : theme.ink }]}>{title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[terminalStyles.contentPanel, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <TChildrenRenderer tchildren={(activeTab as { children?: typeof props.tnode.children }).children || []} />
      </View>
    </View>
  );
};

const TerminalDivRenderer: CustomBlockRenderer = (props) => {
  const className = String(props.tnode.attributes?.class || '');
  if (!className.split(/\s+/).includes('forum-terminal-code')) {
    const { InternalRenderer, ...internalRendererProps } = props;
    return <InternalRenderer {...internalRendererProps} />;
  }
  const textChildren = terminalTextChildren((props.tnode as { domNode?: unknown }).domNode || props.tnode, 'terminal');
  return (
    <View style={terminalStyles.codePanel}>
      <ScrollView horizontal>
        <Text selectable style={terminalStyles.codeText}>{textChildren.length ? textChildren : tnodeText(props.tnode)}</Text>
      </ScrollView>
    </View>
  );
};

const IframeRenderer: CustomBlockRenderer = (props) => {
  const src = props.tnode.attributes.src || '';
  const embed = nsEmbedFromUrl(src);
  return embed?.type === 'bilibili' ? <VideoEmbedBlock embedUrl={embed.embedUrl} /> : null;
};

const PreviewImageRenderer: CustomBlockRenderer = (props) => {
  const {
    htmlBaseLineHeight,
    markInlineSizedImageUrl,
    nodeSeekMediaCookieHeader,
    nodeSeekMediaUserAgent,
    onOpenImagePreview,
    settings,
    styles,
    theme
  } = useForumHtmlRendererContext();
  const [nativeImageLoadState, setNativeImageLoadState] = useState({ src: '', loaded: false });
  const contentWidth = useContentWidth();
  const imageProps = useIMGElementProps(props);
  const src = props.tnode.attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
  const nativeImageLoaded = nativeImageLoadState.src === src && nativeImageLoadState.loaded;
  const imageSource = imageSourceFromUrl(src, imageProps.source, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent);
  const imageState = useIMGElementState({
    ...imageProps,
    source: imageSource,
    style: [imageProps.style, { resizeMode: 'contain' }]
  });
  if (!src) {
    return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
  }
  if (isInlineForumImage(props.tnode.attributes)) {
    return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(props.tnode.attributes, settings.fontScale, contentWidth), inlineForumImageAlignmentStyle(props.tnode.attributes, settings.fontScale, htmlBaseLineHeight)]} />;
  }
  const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
  const sharedContainerStyle = [{ flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: 'center' as const }, containerStyle];
  const imageStateFrameStyle = [{
    alignItems: 'center' as const,
    backgroundColor: theme.surface2,
    borderColor: theme.line,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const
  }, imageState.dimensions];
  const imageLoadingOverlayStyle = [StyleSheet.absoluteFillObject, imageStateFrameStyle];
  const showImageLoading = shouldShowPreviewImageLoading(imageState.type, nativeImageLoaded);
  const content = imageState.type === 'success' ? (
    <View style={[{ overflow: 'hidden' as const }, imageState.dimensions]}>
      <ExpoImage
        contentFit="contain"
        recyclingKey={src}
        source={imageState.source}
        style={[imageState.dimensions, imageState.imageStyle, nativeImageLoaded ? null : { opacity: 0 }]}
        onLoad={(event) => {
          if (shouldMarkLoadedImageInline(props.tnode.attributes, event.source.width, event.source.height)) {
            markInlineSizedImageUrl(src);
          }
        }}
        onLoadStart={() => setNativeImageLoadState({ src, loaded: false })}
        onLoadEnd={() => setNativeImageLoadState({ src, loaded: true })}
        onError={(event) => {
          setNativeImageLoadState({ src, loaded: true });
          imageState.onError(new Error(event.error));
        }}
      />
      {showImageLoading ? (
        <View style={imageLoadingOverlayStyle}>
          <ActivityIndicator color={theme.primary} size="small" />
        </View>
      ) : null}
    </View>
  ) : showImageLoading ? (
    <View style={imageStateFrameStyle}>
      <ActivityIndicator color={theme.primary} size="small" />
    </View>
  ) : (
    <View style={imageStateFrameStyle}>
      <Text numberOfLines={2} style={styles.inlineForumImageText}>{imageState.alt || '图片加载失败'}</Text>
    </View>
  );
  return (
    <Pressable
      accessibilityLabel={imageState.alt || '查看图片'}
      accessibilityRole="button"
      style={sharedContainerStyle}
      onPress={(event) => {
        event.stopPropagation?.();
        onOpenImagePreview(src);
      }}
    >
      {content}
    </Pressable>
  );
};

const InlineForumImageRenderer: CustomMixedRenderer = (props) => {
  const { htmlBaseLineHeight, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent, settings, styles } = useForumHtmlRendererContext();
  const contentWidth = useContentWidth();
  const attributes = ((props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {});
  const src = attributes.src || '';
  const label = attributes.alt || attributes.title || '';
  if (!src) {
    return <Text style={styles.inlineForumImageText}>{label}</Text>;
  }
  if (isInlineForumImage(attributes)) {
    return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth), inlineForumImageAlignmentStyle(attributes, settings.fontScale, htmlBaseLineHeight)]} />;
  }
  return <Text style={styles.inlineForumImageText}>{label || src}</Text>;
};

const QuoteAsideRenderer: CustomBlockRenderer = (props) => {
  const { styles, theme } = useForumHtmlRendererContext();
  const [expanded, setExpanded] = useState(false);
  const tchildrenProps = useTNodeChildrenProps(props);
  const { TDefaultRenderer, ...defaultRendererProps } = props;
  if (!hasHtmlClass(props.tnode, 'quote')) {
    return <TDefaultRenderer {...defaultRendererProps} />;
  }
  const quoteTitleChildren = props.tnode.children.filter((child) => htmlTagName(child) === 'div' && hasHtmlClass(child, 'title'));
  const quoteHeaderChildren = quoteTitleChildren.length ? quoteTitleChildren : props.tnode.children.slice(0, 1);
  const quoteBodyChildren = props.tnode.children.filter((child) => !quoteHeaderChildren.includes(child));
  const StateIcon = expanded ? ChevronUp : ChevronDown;
  return (
    <View style={styles.quoteBox}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        disabled={!quoteBodyChildren.length}
        style={styles.quotePanelHeader}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.quoteAuthorSummary}>
          <TChildrenRenderer {...tchildrenProps} tchildren={quoteHeaderChildren} />
        </View>
        {quoteBodyChildren.length ? (
          <View style={styles.quotePanelState}>
            <Text style={styles.quotePanelStateText}>{expanded ? '收起' : '展开'}</Text>
            <View style={styles.quotePanelStateIcon}>
              <StateIcon size={16} color={theme.primary} strokeWidth={1.9} />
            </View>
          </View>
        ) : null}
      </Pressable>
      {expanded && quoteBodyChildren.length ? (
        <View style={[styles.quoteBody, styles.quotePanelBody]}>
          <TChildrenRenderer {...tchildrenProps} tchildren={quoteBodyChildren} />
        </View>
      ) : null}
    </View>
  );
};

const DetailsRenderer: CustomBlockRenderer = (props) => {
  const { styles, theme } = useForumHtmlRendererContext();
  const [expanded, setExpanded] = useState(props.tnode.attributes?.open !== undefined);
  const tchildrenProps = useTNodeChildrenProps(props);
  const summaryNode = props.tnode.children.find((child) => htmlTagName(child) === 'summary');
  const summaryChildren = ((summaryNode as { children?: typeof props.tnode.children } | undefined)?.children || []);
  const detailSummaryText = detailsSummaryTextFromDom(props.tnode);
  const detailBodyChildren = props.tnode.children.filter((child) => child !== summaryNode);
  const StateIcon = expanded ? ChevronDown : ChevronRight;
  return (
    <View style={styles.detailsPanel}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.detailsPanelHeader}
        onPress={() => setExpanded((value) => !value)}
      >
        <View style={styles.detailsPanelIcon}>
          <StateIcon size={18} color={theme.ink} strokeWidth={2.1} />
        </View>
        <View style={styles.detailsPanelSummary}>
          {summaryChildren.length ? (
            <TChildrenRenderer {...tchildrenProps} tchildren={summaryChildren} />
          ) : detailSummaryText ? (
            <Text style={styles.detailsPanelSummaryText}>{detailSummaryText}</Text>
          ) : (
            <Text style={styles.detailsPanelSummaryText}>详情</Text>
          )}
        </View>
      </Pressable>
      {expanded && detailBodyChildren.length ? (
        <View style={styles.detailsPanelBody}>
          <TChildrenRenderer {...tchildrenProps} tchildren={detailBodyChildren} />
        </View>
      ) : null}
    </View>
  );
};

const SummaryRenderer: CustomBlockRenderer = () => null;

const TableRenderer: CustomBlockRenderer = (props) => {
  const { styles } = useForumHtmlRendererContext();
  const { TDefaultRenderer, ...defaultRendererProps } = props;
  if (htmlTagName(props.tnode) !== 'table') {
    return <TDefaultRenderer {...defaultRendererProps} />;
  }
  return (
    <ScrollView horizontal style={styles.htmlTableScroll} contentContainerStyle={styles.htmlTableScrollContent}>
      <View style={styles.htmlTableFrame}>
        <TDefaultRenderer {...defaultRendererProps} />
      </View>
    </ScrollView>
  );
};

const FORUM_HTML_RENDERERS: HtmlRenderers = {
  a: ReplyReferenceLinkRenderer,
  aside: QuoteAsideRenderer,
  details: DetailsRenderer,
  div: TerminalDivRenderer,
  [FORUM_INLINE_MEDIA_LINE_TAG]: ForumInlineMediaLineRenderer,
  [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
  [FORUM_STICKER_TAG]: ForumStickerRenderer,
  [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
  [FORUM_TERMINAL_REPORT_TAG]: TerminalReportRenderer,
  [FORUM_VIDEO_TAG]: ForumVideoRenderer,
  [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
  iframe: IframeRenderer,
  img: PreviewImageRenderer,
  [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer,
  [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer,
  summary: SummaryRenderer,
  table: TableRenderer
};

export function getForumHtmlRenderers() {
  return FORUM_HTML_RENDERERS;
}

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'noscript'];
const HTML_CUSTOM_ELEMENT_MODELS = {
  details: defaultHTMLElementModels.details.extend({ contentModel: HTMLContentModel.mixed }),
  summary: defaultHTMLElementModels.summary.extend({ contentModel: HTMLContentModel.mixed }),
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({ tagName: INLINE_FORUM_IMAGE_TAG, contentModel: HTMLContentModel.textual, isOpaque: true }),
  [FORUM_STICKER_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_STICKER_TAG, contentModel: HTMLContentModel.textual, isOpaque: true }),
  [FORUM_STICKER_ROW_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_STICKER_ROW_TAG, contentModel: HTMLContentModel.mixed, isOpaque: false }),
  [FORUM_INLINE_MEDIA_LINE_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_INLINE_MEDIA_LINE_TAG, contentModel: HTMLContentModel.mixed, isOpaque: false }),
  [FORUM_REPLY_REFERENCE_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_REPLY_REFERENCE_TAG, contentModel: HTMLContentModel.block, isOpaque: true }),
  [FORUM_LINK_CARD_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_LINK_CARD_TAG, contentModel: HTMLContentModel.block, isOpaque: true }),
  [FORUM_TERMINAL_REPORT_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_TERMINAL_REPORT_TAG, contentModel: HTMLContentModel.block, isOpaque: false }),
  [FORUM_TERMINAL_TAB_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_TERMINAL_TAB_TAG, contentModel: HTMLContentModel.block, isOpaque: false }),
  [FORUM_VIDEO_STICKER_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_VIDEO_STICKER_TAG, contentModel: HTMLContentModel.block, isOpaque: true }),
  [FORUM_VIDEO_TAG]: HTMLElementModel.fromCustomModel({ tagName: FORUM_VIDEO_TAG, contentModel: HTMLContentModel.block, isOpaque: true }),
  iframe: HTMLElementModel.fromCustomModel({ tagName: 'iframe', contentModel: HTMLContentModel.block, isOpaque: true })
};

export function ForumHtmlRendererProvider({
  children,
  context,
  htmlBaseStyle,
  htmlClassesStyles,
  htmlIgnoredStyles,
  htmlRenderersProps,
  htmlTagsStyles,
  topicKey
}: PropsWithChildren<{
  context: ForumHtmlRendererContextValue;
  htmlBaseStyle: HtmlBaseStyle;
  htmlClassesStyles: HtmlClassesStyles;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  topicKey: string;
}>) {
  return (
    <TRenderEngineProvider
      baseStyle={htmlBaseStyle}
      allowedStyles={HTML_ALLOWED_INLINE_STYLES}
      classesStyles={htmlClassesStyles}
      customHTMLElementModels={HTML_CUSTOM_ELEMENT_MODELS}
      ignoredStyles={htmlIgnoredStyles}
      tagsStyles={htmlTagsStyles}
      ignoredDomTags={HTML_IGNORED_DOM_TAGS}
    >
      <ForumHtmlRendererContext.Provider key={topicKey} value={context}>
        <RenderHTMLConfigProvider
          renderers={FORUM_HTML_RENDERERS}
          renderersProps={htmlRenderersProps}
          defaultTextProps={{ selectable: true }}
          enableExperimentalBRCollapsing
          enableExperimentalGhostLinesPrevention
          enableExperimentalMarginCollapsing
        >
          {children}
        </RenderHTMLConfigProvider>
      </ForumHtmlRendererContext.Provider>
    </TRenderEngineProvider>
  );
}

const embedStyles = StyleSheet.create({
  inlineMediaLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  stickerRow: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10, marginTop: 8, rowGap: 6 },
  stickerVideoFrame: { overflow: 'hidden' },
  inlineVideoSticker: { backgroundColor: 'transparent', marginHorizontal: 2 },
  stickerVideoFill: { ...StyleSheet.absoluteFillObject },
  stickerVideoFallback: { ...StyleSheet.absoluteFillObject },
  stickerVideoLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  linkCard: { alignSelf: 'stretch', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, marginTop: 8, overflow: 'hidden', padding: 10 },
  linkCardHeader: { alignItems: 'center', flexDirection: 'row', marginBottom: 8 },
  linkCardIcon: { height: 18, marginRight: 7, width: 18 },
  linkCardSite: { flex: 1, fontSize: 13, fontWeight: '600' },
  linkCardBody: { flexDirection: 'row' },
  linkCardThumbnail: { borderRadius: 4, height: 58, marginRight: 10, width: 92 },
  linkCardText: { flex: 1, minWidth: 0 },
  linkCardTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  linkCardDescription: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  videoFrame: { alignSelf: 'stretch', aspectRatio: 16 / 9, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, marginTop: 8, overflow: 'hidden' },
  videoPlaceholder: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', padding: 16 },
  videoPlaceholderText: { fontSize: 15, fontWeight: '700' },
  webView: { flex: 1 },
  blockedWebView: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 12 }
});

const terminalStyles = StyleSheet.create({
  report: { alignSelf: 'stretch', marginBottom: 12, marginTop: 8 },
  tabRow: { paddingBottom: 0, paddingHorizontal: 0 },
  tabButton: { borderRadius: 0, borderWidth: StyleSheet.hairlineWidth, marginRight: -StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 7, zIndex: 1 },
  tabButtonFirst: { borderTopLeftRadius: 8 },
  tabButtonLast: { borderTopRightRadius: 8, marginRight: 0 },
  tabButtonActive: { borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: -StyleSheet.hairlineWidth, zIndex: 2 },
  tabButtonInactive: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  tabText: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  contentPanel: { alignSelf: 'stretch', borderRadius: 8, borderTopLeftRadius: 0, borderWidth: StyleSheet.hairlineWidth, marginTop: -StyleSheet.hairlineWidth, padding: 8 },
  codePanel: { alignSelf: 'stretch', backgroundColor: '#111827', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginBottom: 0, marginTop: 0, padding: 12 },
  codeText: { color: '#d1d5db', fontFamily: 'monospace', fontSize: 13, lineHeight: 19 }
});
