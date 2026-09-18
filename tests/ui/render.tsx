import { type ReactElement, type ReactNode } from 'react';
import { render as renderNative, type RenderOptions } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { PortalProvider } from '@gorhom/portal';

export { act, fireEvent, waitFor, within } from '@testing-library/react-native';

const settings = createEmptyReaderData().settings;
const theme = createTheme(settings);
const value = {
  settings,
  theme
};
const TestGestureHandlerRootView = GestureHandlerRootView || View;

export function render(element: ReactElement, options: RenderOptions = {}) {
  const { wrapper: Wrapper, ...rest } = options;
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <TestGestureHandlerRootView>
        <ReaderStyleProvider value={value}>
          <PortalProvider>{Wrapper ? <Wrapper>{children}</Wrapper> : children}</PortalProvider>
        </ReaderStyleProvider>
      </TestGestureHandlerRootView>
    );
  }
  return renderNative(element, { ...rest, wrapper: TestWrapper });
}
