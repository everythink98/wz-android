import { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Carousel, type CarouselRef } from 'react-native-reanimated-carousel';
import { RenderHTMLSource } from 'react-native-render-html';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { OriginalImageUpgradeBoundary } from '@/platform/media/originalImageLoading';
import { IconButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, readerRadii, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import { TopicContentPresentationProvider } from '../rendering/TopicContentPresentation';
import { useTopicImageGallery, useTopicSplitDisclosureScopeKey } from '../rendering/TopicSplitDisclosure';
import { useTopicSelectionCancel } from '../selection/TopicSelectionSurface';

const MAX_GALLERY_DOTS = 7;

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
  const showDots = row.slides.length > 1 && row.slides.length <= MAX_GALLERY_DOTS;

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
      </View>
      {row.slides.length > 1 ? (
        <View style={styles.controlsRow}>
          <View style={styles.stepper}>
            <IconButton
              icon={ChevronLeft}
              iconSize={17}
              label="上一张图片"
              iconOnly
              ghost
              onPress={() => carousel.current?.prev()}
            />
            <View style={styles.indicatorGroup}>
              {showDots ? (
                <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.dots}>
                  {row.slides.map((_, dotIndex) => (
                    <View key={dotIndex} style={[styles.dot, dotIndex === current && styles.dotActive]} />
                  ))}
                </View>
              ) : null}
              <Text accessibilityLiveRegion="polite" style={styles.counter}>
                {current + 1} / {row.slides.length}
              </Text>
            </View>
            <IconButton
              icon={ChevronRight}
              iconSize={17}
              label="下一张图片"
              iconOnly
              ghost
              onPress={() => carousel.current?.next()}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    gallery: { gap: 8, marginBottom: 10, marginTop: 6 },
    viewport: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.content,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden'
    },
    slide: { alignItems: 'center', justifyContent: 'center' },
    controlsRow: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    stepper: {
      alignItems: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 2,
      paddingHorizontal: 2
    },
    indicatorGroup: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 6
    },
    dots: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4
    },
    dot: {
      backgroundColor: theme.lineStrong,
      borderRadius: readerRadii.pill,
      height: 5,
      width: 5
    },
    dotActive: {
      backgroundColor: theme.primary,
      width: 14
    },
    counter: {
      color: theme.muted,
      fontFamily,
      fontSize: Math.round(12 * settings.fontScale),
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
      includeFontPadding: false
    }
  });
}
