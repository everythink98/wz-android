import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { createTopicImageDeriver } from '../../src/topicDerivedData';
import { useImagePreviewController } from '../../src/app/useImagePreviewController';

const mockSaveImageUriToLibrary = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock('../../src/imageSave', () => ({
  saveImageUriToLibrary: (...args: unknown[]) => mockSaveImageUriToLibrary(...args)
}));

describe('Image preview controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('REG-TOPIC-006 saves only once when the save button is pressed twice quickly', async () => {
    let finishSave: (() => void) | undefined;
    mockSaveImageUriToLibrary.mockImplementation(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const notify = jest.fn<(message: string) => void>();
    const topicImageDeriver = createTopicImageDeriver();
    const hook = await renderHook(() => useImagePreviewController({
      htmlParts: ['<p><img src="https://images.example/photo.jpg"></p>'],
      inlineSizedImageUrls: {},
      notify,
      topicImageDeriver
    }));

    await act(() => {
      hook.result.current.openImagePreview('https://images.example/photo.jpg');
    });

    const firstSave = hook.result.current.savePreviewImage();
    const secondSave = hook.result.current.savePreviewImage();
    await Promise.resolve();

    expect(mockSaveImageUriToLibrary).toHaveBeenCalledTimes(1);

    finishSave?.();
    await act(async () => {
      await Promise.all([firstSave, secondSave]);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('图片已保存');
  });

  it('REG-TOPIC-019 forwards NodeSeek media credentials to the save request', async () => {
    mockSaveImageUriToLibrary.mockResolvedValue();
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const hook = await renderHook(() => useImagePreviewController({
      htmlParts: [`<p><img src="${imageUrl}"></p>`],
      inlineSizedImageUrls: {},
      nodeSeekMediaUserAgent: 'WZ-Controller-Test',
      notify: jest.fn(),
      topicImageDeriver: createTopicImageDeriver()
    }));

    await act(() => {
      hook.result.current.openImagePreview(imageUrl);
    });
    await act(async () => {
      await hook.result.current.savePreviewImage();
    });

    expect(mockSaveImageUriToLibrary).toHaveBeenCalledWith(
      imageUrl,
      undefined,
      expect.anything(),
      {
        nodeSeekUserAgent: 'WZ-Controller-Test'
      }
    );
  });
});
