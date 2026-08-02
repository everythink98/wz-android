import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { Topic } from '@/domain/forum/models';

const mockPushTopicRoute = jest.fn<(topic: Topic) => boolean>();
const mockAddEventListener =
  jest.fn<(type: 'url', listener: (event: { url: string }) => void) => { remove: () => void }>();
const mockGetInitialURL = jest.fn<() => Promise<string | null>>();
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';

const topicUrl = 'https://linux.do/t/deep-link/42';
const deepLink = `exp+wz-android://open-topic?url=${encodeURIComponent(topicUrl)}`;

describe('app deep-link navigation', () => {
  beforeEach(() => {
    mockAddEventListener.mockReset();
    mockGetInitialURL.mockReset();
    mockPushTopicRoute.mockReset();
  });

  it('queues the initial Topic until navigation is ready and sends later links directly', async () => {
    let onUrl: ((event: { url: string }) => void) | undefined;
    const remove = jest.fn();
    mockGetInitialURL.mockResolvedValue(deepLink);
    mockAddEventListener.mockImplementation((_type, listener) => {
      onUrl = listener;
      return { remove };
    });
    mockPushTopicRoute.mockReturnValueOnce(false).mockReturnValue(true);

    const linking = {
      addEventListener: mockAddEventListener,
      getInitialURL: mockGetInitialURL
    } as unknown as Pick<typeof Linking, 'addEventListener' | 'getInitialURL'>;
    const hook = await renderHook(() => useAppDeepLinkNavigation(linking, mockPushTopicRoute));
    await waitFor(() =>
      expect(mockPushTopicRoute).toHaveBeenCalledWith(expect.objectContaining({ id: '42', source: 'linuxdo' }))
    );

    await act(async () => hook.result.current());
    expect(mockPushTopicRoute).toHaveBeenCalledTimes(2);

    await act(async () => onUrl?.({ url: deepLink }));
    expect(mockPushTopicRoute).toHaveBeenCalledTimes(3);
    await act(async () => hook.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
