import { requireNativeComponent, type NativeSyntheticEvent, type ViewProps } from 'react-native';

export type PreviewRegionViewport = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type SourceSizeEvent = NativeSyntheticEvent<{ height: number; width: number }>;

type PreviewRegionImageProps = ViewProps & {
  filePath: string;
  onSourceSize?: (event: SourceSizeEvent) => void;
  scale: number;
  suspended: boolean;
  viewport: PreviewRegionViewport;
};

export const PreviewRegionImage = requireNativeComponent<PreviewRegionImageProps>('WzPreviewRegionImage');
