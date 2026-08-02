import React, { type ReactElement, type ReactNode } from 'react';
import { render as renderNative, type RenderOptions } from '@testing-library/react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createSharedStyles } from '@/ui/theme/sharedStyles';
import { createTheme } from '@/ui/theme/tokens';

export { act, fireEvent, waitFor, within } from '@testing-library/react-native';

const settings = createEmptyReaderData().settings;
const theme = createTheme(settings);
const value = {
  settings,
  sharedStyles: createSharedStyles(theme, settings, 800),
  theme
};

export function render(element: ReactElement, options: RenderOptions = {}) {
  const { wrapper: Wrapper, ...rest } = options;
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <ReaderStyleProvider value={value}>{Wrapper ? <Wrapper>{children}</Wrapper> : children}</ReaderStyleProvider>
    );
  }
  return renderNative(element, { ...rest, wrapper: TestWrapper });
}
