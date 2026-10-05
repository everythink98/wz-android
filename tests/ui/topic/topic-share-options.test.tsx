import { describe, expect, it, jest } from '@jest/globals';
import type { Topic } from '@/domain/forum/models';
import { TopicShareOptions } from '@/features/topic/components/TopicShareOptions';
import { act, fireEvent, render } from '../render';

const topic: Topic = {
  source: 'v2ex',
  id: 'share-options',
  title: '选择分享方式',
  author: '作者',
  createdAt: '2026-10-02T04:00:00Z',
  url: 'https://www.v2ex.com/t/share-options'
};

function callbacks() {
  return {
    onClose: jest.fn(),
    onShareLink: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    onCopyLink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onShareImage: jest.fn()
  };
}

describe('Topic share options', () => {
  it('keeps the options after sharing or copying a link and opens the body image only when chosen', async () => {
    const actions = callbacks();
    const view = await render(<TopicShareOptions topic={topic} {...actions} />);

    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    expect(actions.onShareLink).toHaveBeenCalledTimes(1);
    expect(actions.onCopyLink).not.toHaveBeenCalled();
    expect(actions.onShareImage).not.toHaveBeenCalled();
    expect(actions.onClose).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '复制链接' })).toBeEnabled();

    await fireEvent.press(view.getByRole('button', { name: '复制链接' }));
    expect(actions.onCopyLink).toHaveBeenCalledTimes(1);
    expect(view.getByText('链接已复制')).toBeTruthy();
    expect(actions.onClose).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(actions.onShareImage).toHaveBeenCalledTimes(1);
  });

  it('keeps link actions available before the opening content is loaded', async () => {
    const actions = callbacks();
    const view = await render(
      <TopicShareOptions
        topic={topic}
        onClose={actions.onClose}
        onShareLink={actions.onShareLink}
        onCopyLink={actions.onCopyLink}
      />
    );

    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '生成长图' })).toBeDisabled();
    expect(view.getByText('正文加载后可生成')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(actions.onClose).not.toHaveBeenCalled();
    expect(actions.onShareLink).not.toHaveBeenCalled();
    expect(actions.onCopyLink).not.toHaveBeenCalled();
  });

  it.each(['分享链接', '复制链接'])(
    'blocks duplicate actions during %s but permits closing without late feedback',
    async (name) => {
      const pending = Promise.withResolvers<void>();
      const actions = callbacks();
      const operation = name === '分享链接' ? actions.onShareLink : actions.onCopyLink;
      operation.mockReturnValueOnce(pending.promise);
      const view = await render(<TopicShareOptions topic={topic} {...actions} />);

      await fireEvent.press(view.getByRole('button', { name }));
      for (const action of ['分享链接', '复制链接', '生成长图']) {
        const button = view.getByRole('button', { name: action });
        expect(button).toBeDisabled();
        await fireEvent.press(button);
      }
      expect(operation).toHaveBeenCalledTimes(1);
      expect(actions.onShareImage).not.toHaveBeenCalled();
      const [close] = view.getAllByRole('button', { name: /^关闭/ });
      expect(close).toBeEnabled();
      await fireEvent.press(close);
      expect(actions.onClose).toHaveBeenCalledTimes(1);

      await act(async () => {
        if (name === '分享链接') pending.reject(new Error('late sharing failure'));
        else pending.resolve();
        await pending.promise.catch(() => undefined);
      });
      expect(actions.onClose).toHaveBeenCalledTimes(1);
      expect(view.queryByText('链接已复制')).toBeNull();
      expect(view.queryByRole('alert')).toBeNull();
    }
  );

  it.each(['分享链接', '复制链接'])('shows a failed %s action and allows retrying in the same panel', async (name) => {
    const actions = callbacks();
    const operation = name === '分享链接' ? actions.onShareLink : actions.onCopyLink;
    operation.mockRejectedValueOnce(new Error('操作未完成，请重试'));
    const view = await render(<TopicShareOptions topic={topic} {...actions} />);

    await fireEvent.press(view.getByRole('button', { name }));
    expect(view.getByRole('alert')).toHaveTextContent(/操作未完成，请重试/);
    expect(view.getByRole('button', { name })).toBeEnabled();
    expect(actions.onClose).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name }));
    expect(operation).toHaveBeenCalledTimes(2);
    expect(view.queryByRole('alert')).toBeNull();
    if (name === '复制链接') expect(view.getByText('链接已复制')).toBeTruthy();
  });

  it('leaves a newly opened panel untouched when an unmounted panel finishes copying', async () => {
    const pending = Promise.withResolvers<void>();
    const oldActions = callbacks();
    oldActions.onCopyLink.mockReturnValueOnce(pending.promise);
    const oldView = await render(<TopicShareOptions topic={topic} {...oldActions} />);
    await fireEvent.press(oldView.getByRole('button', { name: '复制链接' }));
    await oldView.unmount();

    const newActions = callbacks();
    const view = await render(<TopicShareOptions topic={{ ...topic, id: 'new-topic' }} {...newActions} />);
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(view.queryByText('链接已复制')).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
    expect(oldActions.onClose).not.toHaveBeenCalled();
    expect(newActions.onClose).not.toHaveBeenCalled();
    expect(newActions.onCopyLink).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '复制链接' })).toBeEnabled();
  });
});
