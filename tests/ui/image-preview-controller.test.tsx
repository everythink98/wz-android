import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';
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
      contentSource: null,
      contentWidth: 360,
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
    const displayUrl = 'https://www.nodeseek.com/uploads/private-topic-640.png';
    const hook = await renderHook(() => useImagePreviewController({
      contentSource: 'nodeseek',
      contentWidth: 360,
      htmlParts: [`<p><a class="lightbox" href="${imageUrl}"><img src="${displayUrl}"></a></p>`],
      inlineSizedImageUrls: {},
      nodeSeekMediaUserAgent: 'WZ-Controller-Test',
      notify: jest.fn(),
      topicImageDeriver: createTopicImageDeriver()
    }));

    await act(() => {
      hook.result.current.openImagePreview(displayUrl, { width: 640, height: 360 });
    });
    expect(hook.result.current.imagePreview?.items[0]).toEqual({
      displayUri: displayUrl,
      originalUri: imageUrl,
      displaySize: { width: 640, height: 360 }
    });
    await act(async () => {
      await hook.result.current.savePreviewImage();
    });

    expect(mockSaveImageUriToLibrary).toHaveBeenCalledWith(
      imageUrl,
      {
        mediaContext: {
          contentSource: 'nodeseek',
          sessionIdentity: expect.stringMatching(/^nodeseek:/)
        },
        nodeSeekUserAgent: 'WZ-Controller-Test'
      },
      undefined,
      expect.anything()
    );
  });

  it('keeps the exact body-rendered image as the preview continuity frame', async () => {
    const originalUrl = 'https://images.example/original.svg';
    const displayUrl = 'https://images.example/display.svg';
    const renderedPoster = 'file:///cache/svg-posters/body-visible.png';
    const hook = await renderHook(() => useImagePreviewController({
      contentSource: null,
      contentWidth: 360,
      htmlParts: [`<a class="lightbox" href="${originalUrl}"><img src="${displayUrl}"></a>`],
      inlineSizedImageUrls: {},
      notify: jest.fn(),
      topicImageDeriver: createTopicImageDeriver()
    }));

    await act(() => {
      hook.result.current.openImagePreview(displayUrl, { width: 640, height: 360 }, renderedPoster);
    });

    expect(hook.result.current.imagePreview?.items[0]).toEqual({
      displayUri: renderedPoster,
      originalUri: originalUrl,
      displaySize: { width: 640, height: 360 }
    });
  });

  it('[REG-TOPIC-040] prepares adjacent preview placeholders with the body width and DPR', async () => {
    const pixelRatioSpy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2);
    const firstDisplayUrl = 'https://images.example/a-640.jpg';
    const hook = await renderHook(() => useImagePreviewController({
      contentSource: null,
      contentWidth: 300,
      htmlParts: [[
        '<img src="https://images.example/a-fallback.jpg" data-original="https://images.example/a-original.jpg" srcset="https://images.example/a-320.jpg 320w, https://images.example/a-640.jpg 640w, https://images.example/a-1280.jpg 1280w">',
        '<img src="https://images.example/b-fallback.jpg" data-original="https://images.example/b-original.jpg" srcset="https://images.example/b-360.jpg 360w, https://images.example/b-720.jpg 720w, https://images.example/b-1440.jpg 1440w">'
      ].join('')],
      inlineSizedImageUrls: {},
      notify: jest.fn(),
      topicImageDeriver: createTopicImageDeriver()
    }));

    await act(() => {
      hook.result.current.openImagePreview(firstDisplayUrl);
    });

    expect(hook.result.current.imagePreview?.items).toEqual([
      { displayUri: firstDisplayUrl, originalUri: 'https://images.example/a-original.jpg' },
      { displayUri: 'https://images.example/b-720.jpg', originalUri: 'https://images.example/b-original.jpg' }
    ]);
    pixelRatioSpy.mockRestore();
  });
});
