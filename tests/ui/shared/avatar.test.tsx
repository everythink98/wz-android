import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '../render';
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'test-renderer';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { Avatar, avatarInitial } from '@/ui/avatar/Avatar';
import { ForumSessionEpochProvider, mediaSessionIdentityForSource } from '@/platform/media/mediaSessionEpoch';

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

afterEach(() => {
  jest.clearAllMocks();
});

const includeHidden = { includeHiddenElements: true };

describe('Avatar image fallback', () => {
  it('retains the native source across name changes and skips repeated work for an identical avatar', async () => {
    const tree = (name: string) => <Avatar name={name} uri="https://img.example.com/stable.png" contentSource="v2ex" />;
    const view = await render(tree('李'));
    const nativeSource = view.getByTestId('native-avatar', includeHidden).props.source;
    await view.rerender(tree('王'));
    expect(view.getByTestId('native-avatar', includeHidden).props.source).toBe(nativeSource);
    const segment = jest.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      await view.rerender(tree('王'));
      expect(segment).not.toHaveBeenCalled();
    } finally {
      segment.mockRestore();
    }
  });

  it('reuses grapheme segmentation across names while preserving combined emoji', () => {
    const segment = jest.spyOn(Intl.Segmenter.prototype, 'segment');
    try {
      expect(avatarInitial('👩‍🔬 科学')).toBe('👩‍🔬');
      expect(avatarInitial('中文')).toBe('中');
      expect(new Set(segment.mock.contexts).size).toBe(1);
    } finally {
      segment.mockRestore();
    }
  });

  it('does not probe SVG when the large native bitmap succeeds', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);

    const view = await render(
      <Avatar large contentSource="nodeseek" name="Alice" uri="https://www.nodeseek.com/avatar/58159.png" />
    );

    expect(view.getByTestId('native-avatar', includeHidden)).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
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
        <Avatar contentSource="nodeseek" name="Alice" uri={uri} />
      </ForumSessionEpochProvider>
    );
    const view = await render(avatar(firstUri, 0));

    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await view.rerender(avatar(secondUri, 0));
    await act(async () => {
      resolveFirst('<svg aria-label="stale-uri" />');
      await firstFallback;
    });
    expect(view.queryByTestId('svg-avatar', includeHidden)).toBeNull();

    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await view.rerender(avatar(secondUri, 1));
    await act(async () => {
      resolveSecond('<svg aria-label="stale-session" />');
      await secondFallback;
    });

    expect(view.queryByTestId('svg-avatar', includeHidden)).toBeNull();
    expect(view.getByTestId('native-avatar', includeHidden)).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(2);
  });

  it('retries a warm cached avatar after the proxy transport becomes ready', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const uri = 'https://www.nodeseek.com/avatar/58164.png';
    const avatar = (transportIdentity: string) => (
      <ForumSessionEpochProvider sessionEpochs={initialForumSessionEpochs} transportIdentity={transportIdentity}>
        <Avatar contentSource="nodeseek" name="Alice" uri={uri} />
      </ForumSessionEpochProvider>
    );
    const view = await render(avatar('loading'));

    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await waitFor(() => expect(view.queryByTestId('native-avatar', includeHidden)).toBeNull());

    await view.rerender(avatar('applied'));

    expect(view.getByTestId('native-avatar', includeHidden)).toBeTruthy();
  });

  it('shows the text initial visually while hiding decorative avatar nodes from accessibility', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(
      <Avatar contentSource="nodeseek" name="Bob" uri="https://www.nodeseek.com/avatar/58163.png" />
    );

    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await waitFor(() => expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1));

    expect(view.queryByTestId('native-avatar', includeHidden)).toBeNull();
    expect(view.queryByTestId('svg-avatar', includeHidden)).toBeNull();
    expect(view.queryByText('B')).toBeNull();
    expect(view.getByText('B', includeHidden)).toBeTruthy();
  });
});

describe('Avatar request ownership', () => {
  const firstUri = 'https://www.nodeseek.com/avatar/58161.png';
  const secondUri = 'https://www.nodeseek.com/avatar/58162.png';
  const avatar = (uri: string, sessionEpoch: number) => (
    <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: sessionEpoch }}>
      <Avatar contentSource="nodeseek" name="Alice" uri={uri} />
    </ForumSessionEpochProvider>
  );

  it('consumes each native attempt once before retrying or starting a fallback', async () => {
    const pending = Promise.withResolvers<string | null>();
    mockLoadRemoteAvatarSvgText.mockReturnValue(pending.promise);
    const view = await render(<Avatar contentSource="nodeseek" name="Alice" uri={firstUri} />);
    const initialError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await act(async () => {
      initialError();
      initialError();
    });
    expect(view.getByTestId('native-avatar', includeHidden).props.cachePolicy).toBe('none');
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
    const retryError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await act(async () => {
      retryError();
      retryError();
    });
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve('<svg aria-label="current" />');
      await pending.promise;
    });
    expect(view.getByTestId('svg-avatar', includeHidden)).toBeTruthy();
    expect(view.getByLabelText('<svg aria-label="current" />', includeHidden)).toBeTruthy();
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledWith(firstUri, undefined, {
      mediaContext: {
        contentSource: 'nodeseek',
        sessionIdentity: mediaSessionIdentityForSource('nodeseek', initialForumSessionEpochs)
      }
    });
  });

  it('does not start a fallback from a retry callback after unmount', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(avatar(firstUri, 0));
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    const retiredError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await view.unmount();
    await act(async () => retiredError());
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
  });

  it('retires the previous content source even when both sources use the same public media identity', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(<Avatar contentSource={null} name="Alice" uri={firstUri} />);
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    const retiredError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await view.rerender(<Avatar contentSource="v2ex" name="Alice" uri={firstUri} />);
    await act(async () => retiredError());
    expect(view.getByTestId('native-avatar', includeHidden).props.cachePolicy).toBeUndefined();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
  });

  it('keeps the pending fallback when only the name or size changes', async () => {
    const pending = Promise.withResolvers<string | null>();
    mockLoadRemoteAvatarSvgText.mockReturnValueOnce(pending.promise);
    const view = await render(<Avatar contentSource="nodeseek" name="Alice" uri={firstUri} />);
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await view.rerender(<Avatar large contentSource="nodeseek" name="Bob" uri={firstUri} />);
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve('<svg aria-label="same-request" />');
      await pending.promise;
    });
    expect(view.getByTestId('svg-avatar', includeHidden)).toBeTruthy();
    expect(view.getByText('B', includeHidden)).toBeTruthy();
  });

  it('keeps the current native retry and fallback usable after StrictMode rebuilds effects', async () => {
    const pending = Promise.withResolvers<string | null>();
    mockLoadRemoteAvatarSvgText.mockReturnValueOnce(pending.promise);
    const settings = createEmptyReaderData().settings;
    let setups = 0;
    function Harness() {
      useLayoutEffect(() => {
        setups += 1;
      }, []);
      return avatar(firstUri, 0);
    }
    const root = createRoot({ isStrictMode: true });
    const nativeAvatar = () => {
      const [native] = root.container.queryAll((instance) => instance.props.testID === 'native-avatar');
      if (!native) throw new Error('Expected current native avatar');
      return native;
    };
    try {
      await act(async () =>
        root.render(
          <ReaderStyleProvider value={{ settings: resolveReaderStyleSettings(settings), theme: createTheme(settings) }}>
            <Harness />
          </ReaderStyleProvider>
        )
      );
      expect(setups).toBe(2);
      await act(async () => nativeAvatar().props.onError());
      expect(nativeAvatar().props.cachePolicy).toBe('none');
      expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
      await act(async () => nativeAvatar().props.onError());
      expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1);
      await act(async () => {
        pending.resolve('<svg aria-label="strict-current" />');
        await pending.promise;
      });
      expect(root.container.queryAll((instance) => instance.props.testID === 'svg-avatar')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not spend the next URI native retry on a retired initial callback', async () => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(avatar(firstUri, 0));
    const retiredError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await view.rerender(avatar(secondUri, 0));
    await act(async () => retiredError());
    expect(view.getByTestId('native-avatar', includeHidden).props.cachePolicy).toBeUndefined();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    expect(view.getByTestId('native-avatar', includeHidden).props.cachePolicy).toBe('none');
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
  });

  it.each(['URI', 'session'] as const)('ignores a retired retry callback after changing %s', async (changed) => {
    mockLoadRemoteAvatarSvgText.mockResolvedValue(null);
    const view = await render(avatar(firstUri, 0));
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    const retiredError = view.getByTestId('native-avatar', includeHidden).props.onError;
    await view.rerender(avatar(changed === 'URI' ? secondUri : firstUri, changed === 'session' ? 1 : 0));
    await act(async () => retiredError());
    expect(view.queryByTestId('native-avatar', includeHidden)).not.toBeNull();
    expect(mockLoadRemoteAvatarSvgText).not.toHaveBeenCalled();
  });

  it('does not accept an earlier same-URI fallback after the URI leaves and returns', async () => {
    let resolveFallback!: (xml: string | null) => void;
    const fallback = new Promise<string | null>((resolve) => {
      resolveFallback = resolve;
    });
    mockLoadRemoteAvatarSvgText.mockReturnValue(fallback);
    const view = await render(avatar(firstUri, 0));
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    await fireEvent(view.getByTestId('native-avatar', includeHidden), 'error');
    expect(mockLoadRemoteAvatarSvgText).toHaveBeenCalledTimes(1);
    await view.rerender(avatar(secondUri, 0));
    await view.rerender(avatar(firstUri, 0));
    expect(view.getByTestId('native-avatar', includeHidden)).toBeTruthy();
    await act(async () => {
      resolveFallback('<svg aria-label="retired-a" />');
      await fallback;
    });
    expect(view.queryByTestId('svg-avatar', includeHidden)).toBeNull();
    expect(view.getByTestId('native-avatar', includeHidden)).toBeTruthy();
  });
});
