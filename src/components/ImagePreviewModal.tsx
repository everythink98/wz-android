import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
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
  const [zoomed, setZoomed] = useState(false);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const lastTapRef = useRef(0);
  const previewKey = preview ? `${preview.index}:${preview.urls.join('|')}` : '';
  useEffect(() => {
    setZoomed(false);
    setImagePreviewLoading(Boolean(preview));
    setImagePreviewFailed(false);
  }, [previewKey]);

  if (!preview || preview.urls.length === 0) {
    return null;
  }
  const uri = preview.urls[preview.index] || preview.urls[0];
  const hasMany = preview.urls.length > 1;
  const imageWidth = zoomed ? width * 1.8 : width;
  const imageHeight = zoomed ? height * 1.8 : height;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{preview.index + 1} / {preview.urls.length}</Text>
          <View style={styles.imagePreviewTopActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={zoomed ? '还原图片' : '放大图片'} style={styles.imagePreviewTextButton} onPress={() => setZoomed((current) => !current)}>
              <Text style={styles.imagePreviewButtonText}>{zoomed ? '还原' : '放大'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="保存图片" style={styles.imagePreviewTextButton} onPress={onSave}>
              <Text style={styles.imagePreviewButtonText}>保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
              <X size={22} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          horizontal
          style={styles.imagePreviewScroll}
          contentContainerStyle={styles.imagePreviewScrollContent}
          showsHorizontalScrollIndicator={false}
        >
          <ScrollView
            style={[styles.imagePreviewVerticalScroll, { width: imageWidth }]}
            contentContainerStyle={[styles.imagePreviewVerticalContent, { minHeight: imageHeight }]}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={() => {
                const now = Date.now();
                if (now - lastTapRef.current < 280) {
                  setZoomed((current) => !current);
                }
                lastTapRef.current = now;
              }}
            >
              <Image
                source={imageSourceFromUrl(uri)}
                style={[styles.imagePreviewImage, { width: imageWidth, height: imageHeight }]}
                resizeMode="contain"
                onLoadStart={() => {
                  setImagePreviewLoading(true);
                  setImagePreviewFailed(false);
                }}
                onLoadEnd={() => setImagePreviewLoading(false)}
                onError={() => {
                  setImagePreviewLoading(false);
                  setImagePreviewFailed(true);
                }}
              />
            </Pressable>
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
          </ScrollView>
        </ScrollView>
        {hasMany ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewThumbnailRail} contentContainerStyle={styles.imagePreviewThumbnailContent}>
            {preview.urls.map((url, index) => (
              <Pressable key={`${url}-${index}`} accessibilityRole="button" accessibilityLabel={`查看第 ${index + 1} 张图片`} style={[styles.imagePreviewThumbnail, index === preview.index && styles.imagePreviewThumbnailActive]} onPress={() => onSelect(index)}>
                <Image source={imageSourceFromUrl(url)} style={styles.imagePreviewThumbnailImage} resizeMode="cover" />
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
