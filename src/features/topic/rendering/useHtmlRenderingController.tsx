import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getNativePropsForTNode, type CustomBlockRenderer, type CustomMixedRenderer } from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { isPreviewableImageUrl, type ImageDisplaySize } from '@/platform/media/imagePreviewCatalog';
import { parseForumTopicDestination, parseForumUserLink } from '@/domain/forum/links';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '@/ui/theme/tokens';
import type {
  MediaReferrerPolicy,
  ReplyLocationTarget,
  Topic,
  TopicDetail,
  UserReference
} from '@/domain/forum/models';
import type { HtmlRenderers, HtmlRenderersProps } from './types';
import { buildHtmlRenderingStyles, createHtmlRendererStyles } from './htmlStyles';
import { useContentBoundarySpacing } from './TopicContentPresentation';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { createContentMediaRenderers } from './contentMediaRenderers';
import { createPreviewRenderers } from './previewRenderers';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { FORUM_MATH_BLOCK_TAG, FORUM_MATH_INLINE_TAG } from '@/domain/forum/html';
import { useForumContentWidth } from '@/ui/content/ForumContentWidth';
import { ForumMath } from './ForumMath';
import { forumMathSource } from './forumMathSource';

export function useHtmlRenderingController({
  mediaSessionIdentity,
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
  onOpenUser,
  nodeSeekMediaUserAgent,
  selectedTopic,
  settings,
  styleSettings,
  theme,
  topicDetail,
  webViewBlockMessage
}: {
  onOpenExternalUrl: (url: string) => void;
  mediaSessionIdentity: string;
  onOpenImagePreview: (
    url: string,
    displaySize?: ImageDisplaySize,
    renderedPosterUri?: string,
    referrerPolicy?: MediaReferrerPolicy
  ) => void;
  onOpenTopic: (topic: Topic, targetReply?: ReplyLocationTarget) => void | Promise<void>;
  onOpenUser: (user: UserReference) => void | Promise<void>;
  nodeSeekMediaUserAgent?: string;
  selectedTopic: Topic | null;
  settings: ReaderSettings;
  styleSettings?: ReaderSettings;
  theme: ReaderTheme;
  topicDetail: TopicDetail | null;
  webViewBlockMessage: string;
}) {
  const mediaContext = useMemo<ForumMediaRequestContext>(
    () => ({
      contentSource: selectedTopic?.source || null,
      sessionIdentity: mediaSessionIdentity,
      ...(topicDetail?.mediaReferrer ? { referrer: topicDetail.mediaReferrer } : {})
    }),
    [mediaSessionIdentity, selectedTopic?.source, topicDetail?.mediaReferrer]
  );
  const { htmlBaseStyle, htmlClassesStyles, htmlIgnoredStyles, htmlTagsStyles } = useMemo(
    () =>
      buildHtmlRenderingStyles({
        enableDiscourseCallouts: isDiscourseSource(mediaContext.contentSource),
        settings,
        theme
      }),
    [mediaContext.contentSource, settings.fontFamily, settings.fontScale, settings.lineHeight, theme]
  );
  const resolvedStyleSettings = styleSettings || settings;
  const htmlRendererStyles = useMemo(
    () => createHtmlRendererStyles(resolvedStyleSettings, theme),
    [resolvedStyleSettings.fontFamily, resolvedStyleSettings.fontScale, theme]
  );
  const openImagePreview = useLatestCallback(onOpenImagePreview);
  const openHtmlLink = useLatestCallback((href: string, event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    if (isPreviewableImageUrl(href)) {
      openImagePreview(href);
      return;
    }
    const baseUrl = selectedTopic?.url || topicDetail?.url;
    const candidates = [
      ...(selectedTopic ? [selectedTopic] : []),
      ...(topicDetail ? [topicDetail, ...(topicDetail.replies || [])] : [])
    ];
    const appUser = parseForumUserLink(href, baseUrl, candidates);
    if (appUser) {
      void onOpenUser(appUser);
      return;
    }
    const destination = parseForumTopicDestination(href, baseUrl);
    if (destination) {
      void (destination.targetReply
        ? onOpenTopic(destination.topic, destination.targetReply)
        : onOpenTopic(destination.topic));
      return;
    }
    if (isHttpOrHttpsUrl(href)) {
      onOpenExternalUrl(href);
    }
  });
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
    const BlockquoteRenderer: CustomBlockRenderer = (props) => {
      const boundarySpacing = useContentBoundarySpacing(props.tnode);
      const { InternalRenderer, ...internalRendererProps } = props;
      return (
        <InternalRenderer
          {...internalRendererProps}
          style={boundarySpacing ? { ...props.style, ...boundarySpacing } : props.style}
        />
      );
    };
    const ReplyReferenceRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const mention = attributes['data-mention'] || '';
      const floor = attributes['data-floor'] || '';
      const floorHref = attributes['data-floor-href'] || '';
      const userHref = attributes['data-user-href'] || '';
      if (!mention && !floor) {
        return null;
      }
      return (
        <View style={htmlRendererStyles.htmlReplyReferenceRow}>
          <Text style={htmlRendererStyles.htmlReplyReferenceLabel}>回复</Text>
          {mention ? (
            <Pressable accessibilityRole="link" disabled={!userHref} onPress={(event) => openHtmlLink(userHref, event)}>
              <Text style={htmlRendererStyles.htmlReplyReferenceMentionText}>{mention}</Text>
            </Pressable>
          ) : null}
          {mention && floor ? <Text style={htmlRendererStyles.htmlReplyReferenceSeparator}>·</Text> : null}
          {floor ? (
            <Pressable
              accessibilityRole="link"
              disabled={!floorHref}
              onPress={(event) => openHtmlLink(floorHref, event)}
            >
              <Text style={htmlRendererStyles.htmlReplyReferenceFloorText}>{floor}</Text>
            </Pressable>
          ) : null}
        </View>
      );
    };
    const ReplyReferenceLinkRenderer: CustomMixedRenderer = (props) => {
      const className = String(props.tnode.attributes?.class || '');
      const isMentionLink = className.split(/\s+/).includes('forum-mention-link');
      const isFloorLink = className.split(/\s+/).includes('forum-floor-link');
      if (!isMentionLink && !isFloorLink) {
        const { InternalRenderer, ...internalRendererProps } = props;
        return <InternalRenderer {...internalRendererProps} />;
      }
      const nativeProps = getNativePropsForTNode(props);
      if (isFloorLink) {
        const href = props.tnode.attributes?.href || '';
        return (
          <Text
            {...nativeProps}
            accessibilityRole="link"
            onPress={(event) => openHtmlLink(href, event)}
            style={[nativeProps.style, htmlRendererStyles.htmlFloorLink]}
          />
        );
      }
      const href = props.tnode.attributes?.href || '';
      return (
        <Text
          {...nativeProps}
          accessibilityRole="link"
          onPress={(event) => openHtmlLink(href, event)}
          style={[nativeProps.style, htmlRendererStyles.htmlMentionLink]}
        />
      );
    };
    const MathBlockRenderer: CustomBlockRenderer = (props) => {
      const boundarySpacing = useContentBoundarySpacing(props.tnode);
      const contentWidth = useForumContentWidth();
      const source = forumMathSource(props.tnode);
      return source ? (
        <ForumMath
          boundarySpacing={boundarySpacing}
          color={theme.ink}
          contentWidth={contentWidth}
          display="block"
          fontScale={settings.fontScale}
          source={source}
        />
      ) : null;
    };
    const MathInlineRenderer: CustomMixedRenderer = (props) => {
      const contentWidth = useForumContentWidth();
      const source = forumMathSource(props.tnode);
      return source ? (
        <ForumMath
          color={theme.ink}
          contentWidth={contentWidth}
          display="inline"
          fontScale={settings.fontScale}
          source={source}
        />
      ) : null;
    };

    return {
      ...createContentMediaRenderers({
        htmlRendererStyles,
        mediaContext,
        mediaSessionIdentity,
        nodeSeekMediaUserAgent,
        openHtmlLink,
        settings,
        theme,
        webViewBlockMessage
      }),
      ...createPreviewRenderers({
        htmlBaseStyle,
        htmlRendererStyles,
        mediaContext,
        nodeSeekMediaUserAgent,
        onOpenImagePreview: openImagePreview,
        settings,
        theme
      }),
      a: ReplyReferenceLinkRenderer,
      blockquote: BlockquoteRenderer,
      [FORUM_MATH_BLOCK_TAG]: MathBlockRenderer,
      [FORUM_MATH_INLINE_TAG]: MathInlineRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
    mediaContext,
    mediaSessionIdentity,
    nodeSeekMediaUserAgent,
    openImagePreview,
    openHtmlLink,
    settings.fontScale,
    htmlRendererStyles.htmlFloorLink,
    htmlRendererStyles.htmlMentionLink,
    htmlRendererStyles.htmlReplyReferenceFloorText,
    htmlRendererStyles.htmlReplyReferenceLabel,
    htmlRendererStyles.htmlReplyReferenceMentionText,
    htmlRendererStyles.htmlReplyReferenceRow,
    htmlRendererStyles.htmlReplyReferenceSeparator,
    htmlRendererStyles.inlineForumImage,
    htmlRendererStyles.inlineForumImageText,
    theme,
    theme.ink,
    theme.line,
    theme.mist,
    theme.muted,
    theme.primary,
    theme.primarySoft,
    theme.primaryStrong,
    theme.surface,
    theme.surface2,
    webViewBlockMessage
  ]);

  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => {
    const listRendererProps = {
      enableDynamicMarkerBoxWidth: true,
      markerBoxStyle: {
        paddingRight: Math.round(6 * settings.fontScale)
      },
      markerTextStyle: {
        color: theme.ink,
        fontFamily: fontFamilyValue(settings.fontFamily),
        fontSize: Math.round(16 * settings.fontScale),
        lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight))
      }
    };
    return {
      a: {
        onPress: (event, href) => openHtmlLink(href, event)
      },
      img: {
        enableExperimentalPercentWidth: true
      },
      ol: listRendererProps,
      ul: listRendererProps
    };
  }, [openHtmlLink, settings.fontFamily, settings.fontScale, settings.lineHeight, theme.ink]);

  return {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    mediaContext,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    nodeSeekMediaUserAgent
  };
}
