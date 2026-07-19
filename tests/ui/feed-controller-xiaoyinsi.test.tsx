import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFeedController } from '../../src/app/useFeedController';
import { createEmptyReaderData } from '../../src/readerData';
import type { SourceGateway } from '../../src/sources/sourceGateway';

describe('小隐寺 Feed controller', () => {
  it('REG-XIAOYINSI-015 keeps its list filter state independent after a non-empty response', async () => {
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [
        { source: 'v2ex', id: 'v2ex', name: 'V2EX' },
        { source: 'linuxdo', id: 'linuxdo', name: 'linux.do' },
        { source: 'nodeseek', id: 'nodeseek', name: 'NodeSeek' },
        { source: 'yaohuo', id: 'yaohuo', name: '妖火' },
        { source: 'xiaoyinsi', id: 'xiaoyinsi', name: '小隐寺' }
      ] })),
      getFeed: jest.fn(async () => ({
        items: [{
          source: 'xiaoyinsi' as const,
          id: '1',
          title: '小隐寺主题',
          author: 'alice',
          url: 'https://forum.xiaoyinsi.com/t/1',
          createdAt: '2026-07-19T00:00:00.000Z',
          replyCount: 0
        }],
        errors: {},
        hasMore: false,
        nextPage: null
      })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    ));
    await act(async () => {
      hook.result.current.changeFeedSource('xiaoyinsi');
    });
    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'latest' }),
      expect.any(Object)
    ));

    await act(async () => {
      hook.result.current.setFeedFilter('hot');
    });

    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'hot' }),
      expect.any(Object)
    ));
    expect(hook.result.current.feedFilter).toBe('hot');

    await act(async () => {
      hook.result.current.setFeedFilter('new-replies');
    });
    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'new-replies' }),
      expect.any(Object)
    ));
    expect(hook.result.current.feedFilter).toBe('new-replies');
  });
});
