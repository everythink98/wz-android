import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { Avatar } from '@/components/Avatar';
import { ForumSessionEpochProvider, mediaSessionIdentityForSource } from '@/platform/media/mediaSessionEpoch';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createStyles, createTheme } from '@/theme';

type AvatarSvgLoader = typeof import('@/platform/media/avatarImages').loadRemoteAvatarSvgText;
const mockLoadRemoteAvatarSvgText = jest.fn<AvatarSvgLoader>();

jest.mock('@/platform/media/avatarImages', () => ({
  loadRemoteAvatarSvgText: (...args: Parameters<AvatarSvgLoader>) => mockLoadRemoteAvatarSvgText(...args)
}));

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    Image: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, { ...props, testID: 'native-avatar' })
  };
});

jest.mock('react-native-svg', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    SvgXml: ({ xml }: { xml: string }) =>
      ReactModule.createElement(NativeView, {
        accessibilityLabel: xml,
        testID: 'svg-avatar'
      })
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

afterEach(() => {
  jest.clearAllMocks();
});

describe('Avatar image fallback', () => {
  it('does not probe SVG when the native bitmap succeeds', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);

    const view = await render(
      <Avatar contentSource="nodeseek" name="Alice" styles={styles} uri="https://www.nodeseek.com/avatar/58159.png" />
    );

    expect(view.getByTestId('native-avatar')).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
  });

  it('retries the native image once before rendering the SVG fallback', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue('<svg><path /></svg>');
    const uri = 'https://www.nodeseek.com/avatar/58160.png';
    const view = await render(<Avatar contentSource="nodeseek" name="Alice" styles={styles} uri={uri} />);

    await fireEvent(view.getByTestId('native-avatar'), 'error');
    expect(view.getByTestId('native-avatar')).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();

    await fireEvent(view.getByTestId('native-avatar'), 'error');

    await waitFor(() => expect(view.getByTestId('svg-avatar')).toBeTruthy());
    expect(view.getByLabelText('<svg><path /></svg>')).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1);
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledWith(uri, undefined, {
      mediaContext: {
        contentSource: 'nodeseek',
        sessionIdentity: mediaSessionIdentityForSource('nodeseek', initialForumSessionEpochs)
      }
    });
  });

  it('discards a pending fallback when the URI or session identity changes', async () => {
    let resolveFirst!: (xml: string | null) => void;
    let resolveSecond!: (xml: string | null) => void;
    const firstFallback = new Promise<string | null>((resolve) => {
      resolveFirst = resolve;
    });
    const secondFallback = new Promise<string | null>((resolve) => {
      resolveSecond = resolve;
    });
    mockLoadRemoteAvatarSvgText.mockReturnValueOnce(firstFallback).mockReturnValueOnce(secondFallback);
    const firstUri = 'https://www.nodeseek.com/avatar/58161.png';
    const secondUri = 'https://www.nodeseek.com/avatar/58162.png';
    const avatar = (uri: string, sessionEpoch: number) => (
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: sessionEpoch }}>
        <Avatar contentSource="nodeseek" name="Alice" styles={styles} uri={uri} />
      </ForumSessionEpochProvider>
    );
    const view = await render(avatar(firstUri, 0));

    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await view.rerender(avatar(secondUri, 0));
    await act(async () => {
      resolveFirst('<svg aria-label="stale-uri" />');
      await firstFallback;
    });
    expect(view.queryByTestId('svg-avatar')).toBeNull();

    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await view.rerender(avatar(secondUri, 1));
    await act(async () => {
      resolveSecond('<svg aria-label="stale-session" />');
      await secondFallback;
    });

    expect(view.queryByTestId('svg-avatar')).toBeNull();
    expect(view.getByTestId('native-avatar')).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(2);
  });

  it('shows the text initial when the native image and SVG fallback both fail', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(
      <Avatar contentSource="nodeseek" name="Bob" styles={styles} uri="https://www.nodeseek.com/avatar/58163.png" />
    );

    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await fireEvent(view.getByTestId('native-avatar'), 'error');
    await waitFor(() => expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1));

    expect(view.queryByTestId('native-avatar')).toBeNull();
    expect(view.queryByTestId('svg-avatar')).toBeNull();
    expect(view.getByText('B')).toBeTruthy();
  });
});
