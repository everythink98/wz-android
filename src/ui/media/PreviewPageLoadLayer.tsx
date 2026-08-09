import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData, type ImageProgressEventData } from 'expo-image';

import type { CompatibleSvgArtifact } from '@/platform/media/compatibleImageSources';
import { type PreviewBitmapDecodeTarget, withPreviewBitmapDecodeTarget } from '@/platform/media/previewBitmapBudget';

export function PreviewPageLoadLayer({
  active,
  activeAnimatedArtifact,
  animatedSvgPosterReady,
  animatedSvgZoomSuspended,
  displaySource,
  displayUri,
  decodeTarget,
  index,
  knownArtifact,
  mediaSessionIdentity,
  originalUri,
  originalSource,
  readySvgViewIdentity,
  retryVersion,
  sourceIdentity,
  svgViewIdentity,
  showDisplayUnderlay,
  onAnimatedPosterDisplay,
  onAnimatedPosterError,
  onDisplay,
  onError,
  onLoad,
  onLoadStart,
  onPosterDisplay,
  onPosterError,
  onProgress
}: {
  active: boolean;
  activeAnimatedArtifact: CompatibleSvgArtifact | null;
  animatedSvgPosterReady: boolean;
  animatedSvgZoomSuspended: boolean;
  displaySource: object;
  displayUri: string;
  decodeTarget: PreviewBitmapDecodeTarget;
  index: number;
  knownArtifact: CompatibleSvgArtifact | null;
  mediaSessionIdentity: string;
  originalUri: string;
  originalSource: object;
  readySvgViewIdentity: string;
  retryVersion: number;
  sourceIdentity: string;
  svgViewIdentity: string;
  showDisplayUnderlay: boolean;
  onAnimatedPosterDisplay: () => void;
  onAnimatedPosterError: () => void;
  onDisplay: () => void;
  onError: () => void;
  onLoad: (event: ImageLoadEventData) => void;
  onLoadStart: () => void;
  onPosterDisplay: () => void;
  onPosterError: () => void;
  onProgress: (event: ImageProgressEventData) => void;
}) {
  const boundedAnimatedPosterSource = useMemo(
    () =>
      activeAnimatedArtifact ? withPreviewBitmapDecodeTarget(activeAnimatedArtifact.posterSource, decodeTarget) : null,
    [activeAnimatedArtifact, decodeTarget]
  );
  const boundedKnownPosterSource = useMemo(
    () => (knownArtifact ? withPreviewBitmapDecodeTarget(knownArtifact.posterSource, decodeTarget) : null),
    [decodeTarget, knownArtifact]
  );
  const boundedDisplaySource = useMemo(
    () => withPreviewBitmapDecodeTarget(displaySource, decodeTarget),
    [decodeTarget, displaySource]
  );
  const boundedOriginalSource = useMemo(
    () => withPreviewBitmapDecodeTarget(originalSource, decodeTarget),
    [decodeTarget, originalSource]
  );
  const displayUnderlayVisible = showDisplayUnderlay && displayUri !== originalUri;

  if (activeAnimatedArtifact) {
    return (
      <ExpoImage
        allowDownscaling
        key="continuity-poster"
        testID={
          animatedSvgZoomSuspended || readySvgViewIdentity !== svgViewIdentity
            ? `preview-continuity-${index}`
            : undefined
        }
        cachePolicy="disk"
        contentFit="contain"
        pointerEvents="none"
        priority="high"
        recyclingKey={`${mediaSessionIdentity}:${sourceIdentity}:${activeAnimatedArtifact.posterRevision}:continuity`}
        source={boundedAnimatedPosterSource!}
        style={[
          StyleSheet.absoluteFill,
          readySvgViewIdentity === svgViewIdentity && (!animatedSvgZoomSuspended || !animatedSvgPosterReady)
            ? styles.hiddenMedia
            : null
        ]}
        onDisplay={onAnimatedPosterDisplay}
        onError={onAnimatedPosterError}
      />
    );
  }

  if (knownArtifact) {
    return (
      <ExpoImage
        key="static-poster"
        allowDownscaling
        testID={`preview-svg-poster-${index}`}
        cachePolicy="disk"
        contentFit="contain"
        priority={active ? 'high' : 'low'}
        recyclingKey={`${mediaSessionIdentity}:${sourceIdentity}:${knownArtifact.posterRevision}:poster`}
        source={boundedKnownPosterSource!}
        style={StyleSheet.absoluteFill}
        onDisplay={onPosterDisplay}
        onError={onPosterError}
      />
    );
  }

  return (
    <>
      <ExpoImage
        allowDownscaling
        key="display-underlay"
        testID={displayUnderlayVisible ? `preview-display-underlay-${index}` : `preview-hidden-underlay-owner-${index}`}
        cachePolicy="disk"
        contentFit="contain"
        pointerEvents="none"
        priority={displayUnderlayVisible && active ? 'high' : 'low'}
        recyclingKey={
          displayUnderlayVisible
            ? `${mediaSessionIdentity}:${displayUri}:${retryVersion}:display-underlay`
            : `${mediaSessionIdentity}:empty:display-underlay`
        }
        source={displayUnderlayVisible ? boundedDisplaySource : null}
        style={[StyleSheet.absoluteFill, displayUnderlayVisible ? null : styles.hiddenMedia]}
      />
      <ExpoImage
        allowDownscaling
        key="native-raster"
        testID={`preview-image-${index}`}
        cachePolicy="disk"
        contentFit="contain"
        priority={active ? 'high' : 'low'}
        recyclingKey={`${mediaSessionIdentity}:${originalUri}:${retryVersion}:native`}
        source={boundedOriginalSource}
        style={StyleSheet.absoluteFill}
        onDisplay={onDisplay}
        onError={onError}
        onLoad={onLoad}
        onLoadStart={onLoadStart}
        onProgress={onProgress}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hiddenMedia: {
    opacity: 0
  }
});
