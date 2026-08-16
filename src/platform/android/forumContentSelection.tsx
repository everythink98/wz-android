import { requireNativeViewManager } from 'expo-modules-core';
import type { ReactNode } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

export type ForumSelectionLinkEvent = { href: string };
export type ForumSelectionContentSizeEvent = { height: number; layoutKey: string };
export type ForumSelectionTableScrollEvent = { offset: number; semanticId: string };

export type NativeForumSelectionSurfaceProps = {
  children?: ReactNode;
  content: string;
  contentWidth: number;
  fallbackText: string;
  fontFamily?: string;
  fontSize: number;
  highlightColor: string;
  lineColor: string;
  lineHeight: number;
  linkColor: string;
  layoutKey: string;
  query: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  textColor: string;
  onContentSizeChange?: (event: NativeSyntheticEvent<ForumSelectionContentSizeEvent>) => void;
  onLinkPress?: (event: NativeSyntheticEvent<ForumSelectionLinkEvent>) => void;
  onTableScroll?: (event: NativeSyntheticEvent<ForumSelectionTableScrollEvent>) => void;
};

export const NativeForumSelectionSurface =
  requireNativeViewManager<NativeForumSelectionSurfaceProps>('ForumContentSelection');
