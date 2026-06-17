import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ResumableZoom, fitContainer } from 'react-native-zoom-toolkit';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { imageRequestHeadersForUrl, imageSourceFromUrl, visibleImagePreviewThumbnails, type ImagePreviewList } from '../htmlImages';
import { createStyles } from '../theme';

export function ImagePreviewModal({
  preview,
  styles,
  onClose,
  onNext,
  onPrevious,
  onSave,
  onSelect
}: {
  preview: ImagePreviewList | null;
  styles: ReturnType<typeof createStyles>;
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
  const previewKey = preview ? `${preview.index}:${preview.urls.join('|')}` : '';
  const activeIndex = preview?.index ?? 0;
  const activeUri = preview?.urls[activeIndex] || '';
  const thumbnailItems = useMemo(() => (preview ? visibleImagePreviewThumbnails(preview.urls, preview.index) : []), [previewKey]);
  useEffect(() => {
    setImagePreviewLoading(Boolean(preview));
    setImagePreviewFailed(false);
    setImagePreviewResolution(null);
  }, [previewKey]);

  useEffect(() => {
    if (!activeUri) {
      return;
    }
    let canceled = false;
    const headers = imageRequestHeadersForUrl(activeUri);
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
      Image.getSizeWithHeaders(activeUri, headers, onSuccess, onFailure);
    } else {
      Image.getSize(activeUri, onSuccess, onFailure);
    }
    return () => {
      canceled = true;
    };
  }, [activeUri, height, width]);

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

  if (!preview || preview.urls.length === 0) {
    return null;
  }
  const hasMany = preview.urls.length > 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{preview.index + 1} / {preview.urls.length}</Text>
          <View style={styles.imagePreviewTopActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="保存图片" style={styles.imagePreviewTextButton} onPress={onSave}>
              <Text style={styles.imagePreviewButtonText}>保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
              <X size={22} color="#ffffff" strokeWidth={1.8} />
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
            <Image
              source={imageSourceFromUrl(activeUri)}
              style={[styles.imagePreviewImage, imagePreviewSize]}
              resizeMode="contain"
              resizeMethod="none"
              onLoadStart={() => {
                setImagePreviewLoading(true);
                setImagePreviewFailed(false);
              }}
              onLoadEnd={() => {
                setImagePreviewLoading(false);
              }}
              onError={() => {
                setImagePreviewLoading(false);
                setImagePreviewFailed(true);
              }}
            />
          </ResumableZoom>
        </View>
        {imagePreviewLoading ? (
          <View style={styles.imagePreviewState}>
            <ActivityIndicator color="#ffffff" />
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
              <Pressable key={`${url}-${index}`} accessibilityRole="button" accessibilityLabel={`查看第 ${index + 1} 张图片`} style={[styles.imagePreviewThumbnail, index === preview.index && styles.imagePreviewThumbnailActive]} onPress={() => onSelect(index)}>
                <ExpoImage source={imageSourceFromUrl(url)} style={styles.imagePreviewThumbnailImage} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {hasMany ? (
          <View style={styles.imagePreviewControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一张图片" style={styles.imagePreviewControl} onPress={onPrevious}>
              <ChevronLeft size={25} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一张图片" style={styles.imagePreviewControl} onPress={onNext}>
              <ChevronRight size={25} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
