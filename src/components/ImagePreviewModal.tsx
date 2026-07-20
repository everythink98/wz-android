import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Modal, Pressable, ScrollView, Text, useWindowDimensions, View, type ImageURISource } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ResumableZoom, fitContainer } from 'react-native-zoom-toolkit';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { imageRequestHeadersForUrl, imageSourceFromUrl, visibleImagePreviewThumbnails, type ImagePreviewList } from '../htmlImages';
import { createStyles, type ReaderTheme } from '../theme';
import { cachedCompatibleImageSource, compatibleImageRequestIdentity, recoverCompatibleSvgImageSource } from '../compatibleImageSources';

const EMPTY_PREVIEW_URLS: string[] = [];

function CompatiblePreviewThumbnail({
  url,
  nodeSeekCookieHeader,
  nodeSeekUserAgent,
  styles
}: {
  url: string;
  nodeSeekCookieHeader?: string;
  nodeSeekUserAgent?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const originalSource = useMemo(
    () => imageSourceFromUrl(url, undefined, nodeSeekCookieHeader, nodeSeekUserAgent) as ImageURISource,
    [nodeSeekCookieHeader, nodeSeekUserAgent, url]
  );
  const requestIdentity = compatibleImageRequestIdentity(originalSource);
  const requestIdentityRef = useRef(requestIdentity);
  const recoveryIdentityRef = useRef('');
  const [compatibleSource, setCompatibleSource] = useState<{ requestIdentity: string; source: ImageURISource } | null>(null);
  const activeFallbackSource = compatibleSource?.requestIdentity === requestIdentity
    ? compatibleSource.source
    : cachedCompatibleImageSource(originalSource);

  useEffect(() => {
    requestIdentityRef.current = requestIdentity;
    recoveryIdentityRef.current = '';
  }, [requestIdentity]);

  return (
    <ExpoImage
      source={activeFallbackSource || originalSource}
      style={styles.imagePreviewThumbnailImage}
      contentFit="cover"
      recyclingKey={`thumbnail:${url}:${activeFallbackSource ? 'compatible' : 'native'}`}
      onError={() => {
        if (activeFallbackSource || recoveryIdentityRef.current === requestIdentity) {
          return;
        }
        recoveryIdentityRef.current = requestIdentity;
        void recoverCompatibleSvgImageSource(originalSource).then((fallbackSource) => {
          if (requestIdentityRef.current === requestIdentity && fallbackSource) {
            setCompatibleSource({ requestIdentity, source: fallbackSource });
          }
        });
      }}
    />
  );
}

export function ImagePreviewModal({
  preview,
  nodeSeekMediaCookieHeader,
  nodeSeekMediaUserAgent,
  styles,
  theme,
  onClose,
  onNext,
  onPrevious,
  onSave,
  onSelect
}: {
  preview: ImagePreviewList | null;
  nodeSeekMediaCookieHeader?: string;
  nodeSeekMediaUserAgent?: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [imagePreviewResolution, setImagePreviewResolution] = useState<{ width: number; height: number } | null>(null);
  const previewUrls = preview?.urls || EMPTY_PREVIEW_URLS;
  const previewCount = previewUrls.length;
  const activeIndex = preview?.index ?? 0;
  const activeUri = previewUrls[activeIndex] || '';
  const previewKey = `${activeIndex}:${activeUri}`;
  const originalImageSource = useMemo(() => imageSourceFromUrl(
    activeUri,
    undefined,
    nodeSeekMediaCookieHeader,
    nodeSeekMediaUserAgent
  ) as ImageURISource, [activeUri, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent]);
  const imageRequestIdentity = compatibleImageRequestIdentity(originalImageSource);
  const imageRequestIdentityRef = useRef(imageRequestIdentity);
  const recoveryIdentityRef = useRef('');
  const [compatibleImageSource, setCompatibleImageSource] = useState<{ requestIdentity: string; source: ImageURISource } | null>(null);
  const cachedFallbackSource = cachedCompatibleImageSource(originalImageSource);
  const activeFallbackSource = compatibleImageSource?.requestIdentity === imageRequestIdentity
    ? compatibleImageSource.source
    : cachedFallbackSource;
  const activeImageSource = activeFallbackSource || originalImageSource;
  const thumbnailItems = useMemo(() => (previewCount ? visibleImagePreviewThumbnails(previewUrls, activeIndex) : []), [activeIndex, previewCount, previewUrls]);
  useEffect(() => {
    imageRequestIdentityRef.current = imageRequestIdentity;
    recoveryIdentityRef.current = '';
    setImagePreviewLoading(previewCount > 0);
    setImagePreviewFailed(false);
    setImagePreviewResolution(null);
  }, [imageRequestIdentity, previewCount]);

  useEffect(() => {
    if (!activeUri) {
      return;
    }
    let canceled = false;
    const headers = imageRequestHeadersForUrl(activeUri, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent);
    const onSuccess = (nextWidth: number, nextHeight: number) => {
      if (!canceled) {
        setImagePreviewResolution({ width: nextWidth, height: nextHeight });
      }
    };
    const onFailure = () => {
      if (!canceled) {
        setImagePreviewResolution({ width, height });
      }
    };
    if (headers) {
      RNImage.getSizeWithHeaders(activeUri, headers, onSuccess, onFailure);
    } else {
      RNImage.getSize(activeUri, onSuccess, onFailure);
    }
    return () => {
      canceled = true;
    };
  }, [activeUri, height, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent, width]);

  const imagePreviewSize = useMemo(() => {
    if (!imagePreviewResolution?.width || !imagePreviewResolution.height) {
      return { width, height };
    }
    return fitContainer(imagePreviewResolution.width / imagePreviewResolution.height, { width, height });
  }, [height, imagePreviewResolution, width]);

  const imagePreviewMaxScale = useMemo(() => {
    if (!imagePreviewResolution?.width || !imagePreviewResolution.height || !imagePreviewSize.width || !imagePreviewSize.height) {
      return 6;
    }
    const pixelScale = Math.max(imagePreviewResolution.width / imagePreviewSize.width, imagePreviewResolution.height / imagePreviewSize.height);
    return Math.max(3, Math.min(8, pixelScale));
  }, [imagePreviewResolution, imagePreviewSize]);

  if (!preview || previewCount === 0) {
    return null;
  }
  const hasMany = previewCount > 1;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{activeIndex + 1} / {previewCount}</Text>
          <View style={styles.imagePreviewTopActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="保存图片" style={styles.imagePreviewTextButton} onPress={onSave}>
              <Text style={styles.imagePreviewButtonText}>保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
              <X size={22} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
        <View style={styles.imagePreviewScroll}>
          <ResumableZoom
            key={previewKey}
            style={styles.imagePreviewScroll}
            maxScale={imagePreviewMaxScale}
            extendGestures
          >
            <ExpoImage
              contentFit="contain"
              recyclingKey={`${activeUri}:${activeFallbackSource ? 'compatible' : 'native'}`}
              source={activeImageSource}
              style={[styles.imagePreviewImage, imagePreviewSize]}
              onLoadStart={() => {
                setImagePreviewLoading(true);
                setImagePreviewFailed(false);
              }}
              onLoad={(event) => {
                const source = event.source;
                if (source.width > 0 && source.height > 0) {
                  setImagePreviewResolution({ width: source.width, height: source.height });
                }
              }}
              onLoadEnd={() => {
                if (activeFallbackSource) {
                  recoveryIdentityRef.current = '';
                  setImagePreviewLoading(false);
                } else if (recoveryIdentityRef.current !== imageRequestIdentity) {
                  setImagePreviewLoading(false);
                }
              }}
              onError={() => {
                if (imageRequestIdentityRef.current !== imageRequestIdentity) {
                  return;
                }
                if (activeFallbackSource) {
                  recoveryIdentityRef.current = '';
                  setImagePreviewLoading(false);
                  setImagePreviewFailed(true);
                  return;
                }
                recoveryIdentityRef.current = imageRequestIdentity;
                setImagePreviewLoading(true);
                setImagePreviewFailed(false);
                void recoverCompatibleSvgImageSource(originalImageSource).then((fallbackSource) => {
                  if (imageRequestIdentityRef.current !== imageRequestIdentity) {
                    return;
                  }
                  if (fallbackSource) {
                    setCompatibleImageSource({ requestIdentity: imageRequestIdentity, source: fallbackSource });
                    return;
                  }
                  recoveryIdentityRef.current = '';
                  setImagePreviewLoading(false);
                  setImagePreviewFailed(true);
                }, () => {
                  if (imageRequestIdentityRef.current === imageRequestIdentity) {
                    recoveryIdentityRef.current = '';
                    setImagePreviewLoading(false);
                    setImagePreviewFailed(true);
                  }
                });
              }}
            />
          </ResumableZoom>
        </View>
        {imagePreviewLoading ? (
          <View style={styles.imagePreviewState}>
            <ActivityIndicator color={theme.onOverlay} />
            <Text style={styles.imagePreviewStateText}>图片加载中...</Text>
          </View>
        ) : null}
        {imagePreviewFailed ? (
          <View style={styles.imagePreviewState}>
            <Text style={styles.imagePreviewStateText}>图片加载失败</Text>
          </View>
        ) : null}
        {hasMany ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewThumbnailRail} contentContainerStyle={styles.imagePreviewThumbnailContent}>
            {thumbnailItems.map(({ url, index }) => (
              <Pressable key={`${url}-${index}`} accessibilityRole="button" accessibilityLabel={`查看第 ${index + 1} 张图片`} style={[styles.imagePreviewThumbnail, index === activeIndex && styles.imagePreviewThumbnailActive]} onPress={() => onSelect(index)}>
                <CompatiblePreviewThumbnail
                  url={url}
                  nodeSeekCookieHeader={nodeSeekMediaCookieHeader}
                  nodeSeekUserAgent={nodeSeekMediaUserAgent}
                  styles={styles}
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {hasMany ? (
          <View style={styles.imagePreviewControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一张图片" style={styles.imagePreviewControl} onPress={onPrevious}>
              <ChevronLeft size={25} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一张图片" style={styles.imagePreviewControl} onPress={onNext}>
              <ChevronRight size={25} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
