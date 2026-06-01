import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Gallery } from 'react-native-zoom-toolkit';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { imageSourceFromUrl, type ImagePreviewList } from '../htmlImages';
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
  const previewKey = preview ? `${preview.index}:${preview.urls.join('|')}` : '';
  useEffect(() => {
    setImagePreviewLoading(Boolean(preview));
    setImagePreviewFailed(false);
  }, [previewKey]);

  const activeIndex = preview?.index ?? 0;
  const renderPreviewImage = useCallback((uri: string, index: number) => (
    <Image
      source={imageSourceFromUrl(uri)}
      style={[styles.imagePreviewImage, { width, height }]}
      resizeMode="contain"
      resizeMethod="none"
      onLoadStart={() => {
        if (index === activeIndex) {
          setImagePreviewLoading(true);
          setImagePreviewFailed(false);
        }
      }}
      onLoadEnd={() => {
        if (index === activeIndex) {
          setImagePreviewLoading(false);
        }
      }}
      onError={() => {
        if (index === activeIndex) {
          setImagePreviewLoading(false);
          setImagePreviewFailed(true);
        }
      }}
    />
  ), [activeIndex, height, styles.imagePreviewImage, width]);

  if (!preview || preview.urls.length === 0) {
    return null;
  }
  const hasMany = preview.urls.length > 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imagePreviewOverlay}>
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
          <Gallery
            key={previewKey}
            data={preview.urls}
            initialIndex={preview.index}
            onIndexChange={onSelect}
            keyExtractor={(item, index) => `${item}-${index}`}
            renderItem={renderPreviewImage}
          />
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
            {preview.urls.map((url, index) => (
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
      </View>
    </Modal>
  );
}
