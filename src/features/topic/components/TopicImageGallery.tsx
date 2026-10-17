import { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Carousel, type CarouselRef } from 'react-native-reanimated-carousel';
import { RenderHTMLSource } from 'react-native-render-html';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import { IconButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';
import { useTopicImageGallery, useTopicSplitDisclosureScopeKey } from '../rendering/TopicSplitDisclosure';
import { useTopicSelectionCancel } from '../selection/TopicSelectionSurface';

export function TopicImageGallery({
  contentWidth,
  row
}: {
  contentWidth: number;
  row: Extract<CompiledForumContentRow, { type: 'imageGallery' }>;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const { index, select } = useTopicImageGallery(row.semanticId);
  const scopeKey = useTopicSplitDisclosureScopeKey();
  const current = Math.min(index, row.slides.length - 1);
  const height = Math.min(400, contentWidth * 1.25);
  const sources = useMemo(() => row.slides.map((html) => ({ html })), [row.slides]);
  const carousel = useRef<CarouselRef>(null);
  const cancelSelection = useTopicSelectionCancel();
  return (
    <View style={styles.gallery} testID="topic-image-gallery">
      <View style={[styles.viewport, { height, width: contentWidth }]}>
        <Carousel
          key={`${scopeKey}\u0000${row.semanticId}`}
          defaultIndex={current}
          ref={carousel}
          data={sources}
          itemSize={contentWidth}
          loop={row.slides.length > 1}
          renderWindowSize={2}
          animation={{ type: 'timing', duration: 250 }}
          scrollEnabled={row.slides.length > 1}
          style={{ height, width: contentWidth }}
          testID="topic-image-gallery-carousel"
          onConfigurePanGesture={(gesture) => {
            gesture.activeOffsetX([-10, 10]).failOffsetY([-10, 10]).maxPointers(1);
          }}
          onScrollStart={cancelSelection ?? undefined}
          onSnapToItem={select}
          renderItem={({ item, index: slide }) => (
            <View style={[styles.slide, { height }]}>
              <OriginalImageUpgradeBoundary enabled={slide === current}>
                <TopicContentPresentationProvider continuation="only" imageMaxHeight={height}>
                  <RenderHTMLSource contentWidth={contentWidth} source={item} />
                </TopicContentPresentationProvider>
              </OriginalImageUpgradeBoundary>
            </View>
          )}
        />
        {row.slides.length > 1 ? (
          <View pointerEvents="box-none" style={styles.navigation}>
            <View style={styles.arrow}>
              <View pointerEvents="none" style={styles.arrowBackdrop} />
              <IconButton
                icon={ChevronLeft}
                iconSize={20}
                label="上一张图片"
                iconOnly
                ghost
                onPress={() => carousel.current?.prev()}
              />
            </View>
            <View style={styles.arrow}>
              <View pointerEvents="none" style={styles.arrowBackdrop} />
              <IconButton
                icon={ChevronRight}
                iconSize={20}
                label="下一张图片"
                iconOnly
                ghost
                onPress={() => carousel.current?.next()}
              />
            </View>
          </View>
        ) : null}
      </View>
      {row.slides.length > 1 ? (
        <View style={styles.controls}>
          <Text accessibilityLiveRegion="polite" style={styles.counter}>
            {current + 1} / {row.slides.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    gallery: { marginBottom: 8, marginTop: 6 },
    viewport: {
      backgroundColor: theme.surface,
      borderRadius: 8,
      overflow: 'hidden'
    },
    slide: { alignItems: 'center', justifyContent: 'center' },
    navigation: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 8
    },
    arrow: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 56,
      height: 56
    },
    arrowBackdrop: {
      position: 'absolute',
      width: 32,
      height: 40,
      borderRadius: 6,
      backgroundColor: alphaColor(theme.surface, 0.94)
    },
    controls: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 28,
      paddingVertical: 6
    },
    counter: {
      color: theme.muted,
      fontSize: Math.round(12 * settings.fontScale),
      fontVariant: ['tabular-nums'],
      fontWeight: '500',
      includeFontPadding: false
    }
  });
}
