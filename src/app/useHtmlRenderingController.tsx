import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HtmlRenderersProps } from '../appTypes';
import { parseForumTopicLink, parseForumUserLink } from '../appUtils';
import {
  isHttpOrHttpsUrl,
  isPreviewableImageUrl,
  normalizeImagePreviewUrl
} from '../htmlImages';
import { buildHtmlRenderingStyles } from '../htmlRenderingStyles';
import type { ReaderSettings } from '../readerData';
import {
  type ForumHtmlRendererContextValue
} from '../screens/topic/ForumHtmlRendererProvider';
import { fontFamilyValue, lineHeightMultiplier, createStyles, type ReaderTheme } from '../theme';
import { createTopicImageDeriver } from '../topicDerivedData';
import type { Topic, TopicDetail, UserProfile } from '../types';

export {
  shouldShowPreviewImageLoading,
  shouldShowVideoStickerLoading
} from '../screens/topic/ForumHtmlRendererProvider';

type LinkContext = {
  onOpenExternalUrl: (url: string) => void;
  onOpenImagePreview: (url: string) => void;
  onOpenTopic: (topic: Topic) => void | Promise<void>;
  onOpenUser: (user: UserProfile) => void | Promise<void>;
  selectedTopic: Topic | null;
  topicDetail: TopicDetail | null;
};

export function useHtmlRenderingController({
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
  onOpenUser,
  nodeSeekMediaCookieHeader,
  nodeSeekMediaUserAgent,
  selectedTopic,
  settings,
  styles,
  theme,
  topicDetail,
  topicKey,
  webViewBlockMessage
}: {
  onOpenExternalUrl: (url: string) => void;
  onOpenImagePreview: (url: string) => void;
  onOpenTopic: (topic: Topic) => void | Promise<void>;
  onOpenUser: (user: UserProfile) => void | Promise<void>;
  nodeSeekMediaUserAgent?: string;
  nodeSeekMediaCookieHeader?: string;
  selectedTopic: Topic | null;
  settings: ReaderSettings;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicDetail: TopicDetail | null;
  topicKey: string;
  webViewBlockMessage: string;
}) {
  const [inlineSizedImageState, setInlineSizedImageState] = useState<{ topicKey: string; urls: Record<string, true> }>({ topicKey: '', urls: {} });
  const emptyInlineSizedImageUrls = useMemo<Record<string, true>>(() => ({}), [topicKey]);
  const inlineSizedImageUrls = inlineSizedImageState.topicKey === topicKey ? inlineSizedImageState.urls : emptyInlineSizedImageUrls;
  const markInlineSizedImageUrl = useCallback((url: string) => {
    const clean = normalizeImagePreviewUrl(url).trim();
    if (!clean) {
      return;
    }
    setInlineSizedImageState((current) => (
      current.topicKey === topicKey && current.urls[clean]
        ? current
        : {
            topicKey,
            urls: {
              ...(current.topicKey === topicKey ? current.urls : {}),
              [clean]: true
            }
          }
    ));
  }, [topicKey]);

  const topicImageDeriver = useMemo(() => createTopicImageDeriver(), [topicKey]);
  const {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlTagsStyles
  } = useMemo(() => buildHtmlRenderingStyles({ settings, theme }), [
    settings.fontFamily,
    settings.fontScale,
    settings.lineHeight,
    theme
  ]);

  const linkContextRef = useRef<LinkContext>({
    onOpenExternalUrl,
    onOpenImagePreview,
    onOpenTopic,
    onOpenUser,
    selectedTopic,
    topicDetail
  });
  useLayoutEffect(() => {
    linkContextRef.current = {
      onOpenExternalUrl,
      onOpenImagePreview,
      onOpenTopic,
      onOpenUser,
      selectedTopic,
      topicDetail
    };
  }, [onOpenExternalUrl, onOpenImagePreview, onOpenTopic, onOpenUser, selectedTopic, topicDetail]);

  const openImagePreview = useCallback((url: string) => {
    linkContextRef.current.onOpenImagePreview(url);
  }, []);
  const openHtmlLink = useCallback((href: string, event?: { stopPropagation?: () => void }) => {
    const current = linkContextRef.current;
    if (isPreviewableImageUrl(href)) {
      event?.stopPropagation?.();
      current.onOpenImagePreview(href);
      return;
    }
    const baseUrl = current.selectedTopic?.url || current.topicDetail?.url;
    const candidates = [
      ...(current.selectedTopic ? [current.selectedTopic] : []),
      ...(current.topicDetail ? [current.topicDetail, ...(current.topicDetail.replies || [])] : [])
    ];
    const appUser = parseForumUserLink(href, baseUrl, candidates);
    if (appUser) {
      event?.stopPropagation?.();
      void current.onOpenUser(appUser);
      return;
    }
    const appTopic = parseForumTopicLink(href, baseUrl);
    if (appTopic) {
      event?.stopPropagation?.();
      void current.onOpenTopic(appTopic);
      return;
    }
    if (isHttpOrHttpsUrl(href)) {
      current.onOpenExternalUrl(href);
    }
  }, []);

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

  const htmlRendererContext = useMemo<ForumHtmlRendererContextValue>(() => ({
    htmlBaseLineHeight: htmlBaseStyle.lineHeight,
    markInlineSizedImageUrl,
    nodeSeekMediaCookieHeader,
    nodeSeekMediaUserAgent,
    onOpenImagePreview: openImagePreview,
    openHtmlLink,
    settings,
    styles,
    theme,
    webViewBlockMessage
  }), [
    htmlBaseStyle.lineHeight,
    markInlineSizedImageUrl,
    nodeSeekMediaCookieHeader,
    nodeSeekMediaUserAgent,
    openHtmlLink,
    openImagePreview,
    settings,
    styles,
    theme,
    webViewBlockMessage
  ]);

  return {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRendererContext,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    topicImageDeriver
  };
}
