import 'react-native-gesture-handler';
import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import { VisualGalleryApp } from './VisualGalleryApp';

globalThis.fetch = async () => {
  throw new Error('Visual Gallery blocks network requests');
};

registerRootComponent(VisualGalleryApp);
