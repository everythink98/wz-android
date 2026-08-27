import { createContext, type ReactNode, useContext } from 'react';
import { useContentWidth } from 'react-native-render-html';

const ForumContentWidthContext = createContext<number | null>(null);

export function ForumContentWidthBoundary({ children, width }: { children: ReactNode; width: number }) {
  const contentWidth = Number.isFinite(width) && width > 0 ? width : null;
  return <ForumContentWidthContext.Provider value={contentWidth}>{children}</ForumContentWidthContext.Provider>;
}

export function useForumContentWidth() {
  const contentWidth = useContentWidth();
  return useContext(ForumContentWidthContext) ?? contentWidth;
}
