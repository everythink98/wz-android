import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View, type ImageURISource } from 'react-native';
import { getNativePropsForTNode, type CustomBlockRenderer, type CustomMixedRenderer } from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { createTopicImageDeriver } from '../model/topicDerivedData';
import { imageSourceFromUrl, isHttpOrHttpsUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import { compatibleImageRequestIdentity } from '@/platform/media/compatibleImageSources';
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
  topicKey,
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
  topicKey: string;
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
  const [inlineSizedImageState, setInlineSizedImageState] = useState<{ topicKey: string; urls: Record<string, true> }>({
    topicKey: '',
    urls: {}
  });
  const emptyInlineSizedImageUrls = useMemo<Record<string, true>>(() => ({}), [topicKey]);
  const inlineSizedImageUrls =
    inlineSizedImageState.topicKey === topicKey ? inlineSizedImageState.urls : emptyInlineSizedImageUrls;
  const requestIdentityForImage = useCallback(
    (url: string, referrerPolicy?: MediaReferrerPolicy) =>
      compatibleImageRequestIdentity(
        imageSourceFromUrl(url, {
          mediaContext,
          nodeSeekUserAgent: nodeSeekMediaUserAgent,
          referrerPolicy
        }) as ImageURISource
      ),
    [mediaContext, nodeSeekMediaUserAgent]
  );
  const markInlineSizedImageUrl = useCallback(
    (url: string, referrerPolicy?: MediaReferrerPolicy) => {
      const clean = normalizeImagePreviewUrl(url).trim();
      if (!clean) {
        return;
      }
      const identity = requestIdentityForImage(clean, referrerPolicy);
      setInlineSizedImageState((current) =>
        current.topicKey === topicKey && current.urls[identity]
          ? current
          : {
              topicKey,
              urls: {
                ...(current.topicKey === topicKey ? current.urls : {}),
                [identity]: true
              }
            }
      );
    },
    [requestIdentityForImage, topicKey]
  );

  const topicImageDeriver = useMemo(
    () => createTopicImageDeriver({ requestIdentityForImage }),
    [requestIdentityForImage, topicKey]
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
        markInlineSizedImageUrl,
        mediaContext,
        mediaSessionIdentity,
        nodeSeekMediaUserAgent,
        onOpenImagePreview: openImagePreview,
        settings,
        theme
      }),
      a: ReplyReferenceLinkRenderer,
      blockquote: BlockquoteRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
    mediaContext,
    mediaSessionIdentity,
    nodeSeekMediaUserAgent,
    openImagePreview,
    openHtmlLink,
    markInlineSizedImageUrl,
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
    inlineSizedImageUrls,
    nodeSeekMediaUserAgent,
    openHtmlLink,
    topicImageDeriver
  };
}
