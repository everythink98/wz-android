import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockPushTopicRoute = jest.fn(() => true);
const mockAddEventListener =
  jest.fn<(type: 'url', listener: (event: { url: string }) => void) => { remove: () => void }>();
const mockGetInitialURL = jest.fn<() => Promise<string | null>>();
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';

const destinationCases: [
  label: string,
  url: string,
  topic: { source: string; id: string },
  targetReply: { floor: number; pageHint?: number }
][] = [
  [
    'NodeSeek',
    'https://www.nodeseek.com/post-123-16#155',
    { source: 'nodeseek', id: '123' },
    { floor: 155, pageHint: 16 }
  ],
  ['linux.do', 'https://linux.do/t/topic/456/90', { source: 'linuxdo', id: '456' }, { floor: 90 }],
  ['V2EX', 'https://www.v2ex.com/t/789#reply12', { source: 'v2ex', id: '789' }, { floor: 12 }],
  [
    '妖火',
    'https://www.yaohuo.me/bbs/book_re.aspx?id=321&classid=177&tofloor=90',
    { source: 'yaohuo', id: '321' },
    { floor: 90 }
  ]
];

function internalTopicLink(topicUrl: string) {
  return `exp+wz-android://open-topic?url=${encodeURIComponent(topicUrl)}`;
}

describe('app deep-link navigation', () => {
  beforeEach(() => {
    mockAddEventListener.mockReset();
    mockGetInitialURL.mockReset();
    mockPushTopicRoute.mockReset();
  });

  it.each(destinationCases)(
    '[REG-NAV-003] sends the complete %s destination to the Topic route',
    async (_, url, topic, targetReply) => {
      let onUrl: ((event: { url: string }) => void) | undefined;
      mockGetInitialURL.mockResolvedValue(null);
      mockAddEventListener.mockImplementation((_type, listener) => {
        onUrl = listener;
        return { remove: jest.fn() };
      });
      mockPushTopicRoute.mockReturnValue(true);

      const linking = {
        addEventListener: mockAddEventListener,
        getInitialURL: mockGetInitialURL
      } as unknown as Pick<typeof Linking, 'addEventListener' | 'getInitialURL'>;
      const hook = await renderHook(() => useAppDeepLinkNavigation(linking, mockPushTopicRoute));
      await waitFor(() => expect(onUrl).toBeDefined());

      await act(async () => onUrl?.({ url: internalTopicLink(url) }));

      expect(mockPushTopicRoute).toHaveBeenCalledWith(
        expect.objectContaining({ topic: expect.objectContaining(topic), targetReply })
      );
      await act(async () => hook.unmount());
    }
  );

  it('[REG-NAV-003] replays the complete cold-start destination after navigation becomes ready', async () => {
    const remove = jest.fn();
    const [, url, topic, targetReply] = destinationCases[0];
    mockGetInitialURL.mockResolvedValue(internalTopicLink(url));
    mockAddEventListener.mockReturnValue({ remove });
    mockPushTopicRoute.mockReturnValueOnce(false).mockReturnValue(true);

    const linking = {
      addEventListener: mockAddEventListener,
      getInitialURL: mockGetInitialURL
    } as unknown as Pick<typeof Linking, 'addEventListener' | 'getInitialURL'>;
    const hook = await renderHook(() => useAppDeepLinkNavigation(linking, mockPushTopicRoute));
    await waitFor(() => expect(mockPushTopicRoute).toHaveBeenCalledTimes(1));

    await act(async () => hook.result.current());
    expect(mockPushTopicRoute).toHaveBeenCalledTimes(2);
    expect(mockPushTopicRoute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ topic: expect.objectContaining(topic), targetReply })
    );
    expect(mockPushTopicRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ topic: expect.objectContaining(topic), targetReply })
    );

    await act(async () => hook.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
