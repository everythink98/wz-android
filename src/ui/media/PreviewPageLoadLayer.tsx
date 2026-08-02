import { StyleSheet } from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData, type ImageProgressEventData } from 'expo-image';

import type { CompatibleSvgArtifact } from '@/platform/media/compatibleImageSources';

export function PreviewPageLoadLayer({
  active,
  activeAnimatedArtifact,
  animatedSvgPosterReady,
  animatedSvgZoomSuspended,
  displaySource,
  fullQuality,
  index,
  knownArtifact,
  mediaSessionIdentity,
  originalUri,
  originalSource,
  readySvgViewIdentity,
  retryVersion,
  sourceIdentity,
  svgViewIdentity,
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
  fullQuality: boolean;
  index: number;
  knownArtifact: CompatibleSvgArtifact | null;
  mediaSessionIdentity: string;
  originalUri: string;
  originalSource: object;
  readySvgViewIdentity: string;
  retryVersion: number;
  sourceIdentity: string;
  svgViewIdentity: string;
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
  if (activeAnimatedArtifact) {
    return (
      <ExpoImage
        key={`${sourceIdentity}:${activeAnimatedArtifact.posterRevision}:continuity`}
        testID={
          animatedSvgZoomSuspended || readySvgViewIdentity !== svgViewIdentity
            ? `preview-continuity-${index}`
            : undefined
        }
        cachePolicy="memory-disk"
        contentFit="contain"
        pointerEvents="none"
        priority="high"
        recyclingKey={`${mediaSessionIdentity}:${sourceIdentity}:${activeAnimatedArtifact.posterRevision}:continuity`}
        source={activeAnimatedArtifact.posterSource}
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
        key={`${sourceIdentity}:${knownArtifact.posterRevision}:${active ? 'active' : 'warm'}:poster`}
        allowDownscaling={!active}
        testID={`preview-svg-poster-${index}`}
        cachePolicy="memory-disk"
        contentFit="contain"
        priority={active ? 'high' : 'low'}
        recyclingKey={`${mediaSessionIdentity}:${sourceIdentity}:${knownArtifact.posterRevision}:poster`}
        source={knownArtifact.posterSource}
        style={StyleSheet.absoluteFill}
        onDisplay={onPosterDisplay}
        onError={onPosterError}
      />
    );
  }

  return (
    <ExpoImage
      allowDownscaling={!fullQuality}
      key={sourceIdentity}
      testID={`preview-image-${index}`}
      cachePolicy="memory-disk"
      contentFit="contain"
      placeholder={displaySource}
      placeholderContentFit="contain"
      priority={active ? 'high' : 'low'}
      recyclingKey={`${mediaSessionIdentity}:${originalUri}:${retryVersion}:native`}
      source={originalSource}
      style={StyleSheet.absoluteFill}
      onDisplay={onDisplay}
      onError={onError}
      onLoad={onLoad}
      onLoadStart={onLoadStart}
      onProgress={onProgress}
    />
  );
}

const styles = StyleSheet.create({
  hiddenMedia: {
    opacity: 0
  }
});
