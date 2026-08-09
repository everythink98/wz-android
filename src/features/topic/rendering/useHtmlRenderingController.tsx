import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  getNativePropsForTNode,
  TChildrenRenderer,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { createTopicImageDeriver } from '../model/topicDerivedData';
import { isHttpOrHttpsUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import { isPreviewableImageUrl, type ImageDisplaySize } from '@/platform/media/imagePreviewCatalog';
import { parseForumTopicDestination, parseForumUserLink } from '@/domain/forum/links';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '@/ui/theme/tokens';
import type { ReplyLocationTarget, Topic, TopicDetail, UserReference } from '@/domain/forum/models';
import type { HtmlRenderers, HtmlRenderersProps } from './types';
import { buildHtmlRenderingStyles, createHtmlRendererStyles } from './htmlStyles';
import { useContentBoundarySpacing } from './TopicContentPresentation';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
import { ForumCallout } from '@/ui/content/ForumCallout';
import { hasSameYaohuoTopicLayout } from '../model/topicContentIdentity';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import {
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_CONTENT_CLASS,
  DISCOURSE_CALLOUT_FOLD_ATTRIBUTE,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE,
  DISCOURSE_CALLOUT_REGISTRY,
  isDiscourseCalloutType,
  type DiscourseCalloutFold
} from '@/domain/forum/callouts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { createContentMediaRenderers } from './contentMediaRenderers';
import { createPreviewRenderers } from './previewRenderers';
import { createTerminalRenderers, terminalNodeHasClass, terminalNodeTagName, tnodeText } from './terminalRenderers';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { useTopicSplitDisclosure } from './TopicSplitDisclosure';

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
  onOpenImagePreview: (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void;
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
      sessionIdentity: mediaSessionIdentity
    }),
    [mediaSessionIdentity, selectedTopic?.source]
  );
  const htmlTopicDetailRef = useRef(topicDetail);
  const htmlTopicDetail = hasSameYaohuoTopicLayout(htmlTopicDetailRef.current, topicDetail)
    ? htmlTopicDetailRef.current
    : topicDetail;
  useLayoutEffect(() => {
    htmlTopicDetailRef.current = htmlTopicDetail;
  }, [htmlTopicDetail]);
  const [inlineSizedImageState, setInlineSizedImageState] = useState<{ topicKey: string; urls: Record<string, true> }>({
    topicKey: '',
    urls: {}
  });
  const emptyInlineSizedImageUrls = useMemo<Record<string, true>>(() => ({}), [topicKey]);
  const inlineSizedImageUrls =
    inlineSizedImageState.topicKey === topicKey ? inlineSizedImageState.urls : emptyInlineSizedImageUrls;
  const markInlineSizedImageUrl = useCallback(
    (url: string) => {
      const clean = normalizeImagePreviewUrl(url).trim();
      if (!clean) {
        return;
      }
      setInlineSizedImageState((current) =>
        current.topicKey === topicKey && current.urls[clean]
          ? current
          : {
              topicKey,
              urls: {
                ...(current.topicKey === topicKey ? current.urls : {}),
                [clean]: true
              }
            }
      );
    },
    [topicKey]
  );

  const topicImageDeriver = useMemo(() => createTopicImageDeriver(), [topicKey]);

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
    const baseUrl = selectedTopic?.url || htmlTopicDetail?.url;
    const candidates = [
      ...(selectedTopic ? [selectedTopic] : []),
      ...(htmlTopicDetail ? [htmlTopicDetail, ...(htmlTopicDetail.replies || [])] : [])
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
      const renderOrdinaryQuote = () => {
        const { InternalRenderer, ...internalRendererProps } = props;
        return (
          <InternalRenderer
            {...internalRendererProps}
            style={boundarySpacing ? { ...props.style, ...boundarySpacing } : props.style}
          />
        );
      };
      const attributes = props.tnode.attributes || {};
      const type = attributes[DISCOURSE_CALLOUT_TYPE_ATTRIBUTE];
      const foldValue = attributes[DISCOURSE_CALLOUT_FOLD_ATTRIBUTE];
      const disclosure = useTopicSplitDisclosure({
        attributes,
        defaultExpanded: foldValue !== 'collapsed',
        kind: 'callout'
      });
      if (
        !isDiscourseSource(mediaContext.contentSource) ||
        attributes[DISCOURSE_CALLOUT_ATTRIBUTE] !== 'true' ||
        !isDiscourseCalloutType(type) ||
        (foldValue !== undefined && foldValue !== 'collapsed' && foldValue !== 'expanded')
      ) {
        return renderOrdinaryQuote();
      }
      const titleNodes = props.tnode.children.filter(
        (child) => terminalNodeTagName(child) === 'div' && terminalNodeHasClass(child, DISCOURSE_CALLOUT_TITLE_CLASS)
      );
      const contentNodes = props.tnode.children.filter(
        (child) => terminalNodeTagName(child) === 'div' && terminalNodeHasClass(child, DISCOURSE_CALLOUT_CONTENT_CLASS)
      );
      if ((disclosure.headerVisible ? titleNodes.length !== 1 : titleNodes.length !== 0) || contentNodes.length > 1) {
        return renderOrdinaryQuote();
      }
      const titleNode = titleNodes[0];
      const contentNode = contentNodes[0];
      return (
        <ForumCallout
          body={contentNode ? <TChildrenRenderer tchildren={[contentNode]} /> : undefined}
          boundarySpacing={boundarySpacing}
          expanded={disclosure.expanded}
          fold={foldValue as DiscourseCalloutFold | undefined}
          foldable={disclosure.shared && disclosure.headerVisible && foldValue !== undefined ? true : undefined}
          headerVisible={disclosure.headerVisible}
          onExpandedChange={disclosure.toggle}
          theme={theme}
          title={titleNode ? <TChildrenRenderer tchildren={[titleNode]} /> : null}
          titleLabel={titleNode ? tnodeText(titleNode) || DISCOURSE_CALLOUT_REGISTRY[type].title : ''}
          type={type}
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
      ...createTerminalRenderers(theme),
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
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    topicImageDeriver
  };
}
