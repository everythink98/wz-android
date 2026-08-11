import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';

const mockSaveImageUriToLibrary = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock('@/platform/media/imageSave', () => ({
  saveImageUriToLibrary: (...args: unknown[]) => mockSaveImageUriToLibrary(...args)
}));

describe('Image preview controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('REG-TOPIC-006 saves only once when the save button is pressed twice quickly', async () => {
    let finishSave: (() => void) | undefined;
    mockSaveImageUriToLibrary.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const notify = jest.fn<(message: string) => void>();
    const topicImageDeriver = createTopicImageDeriver();
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: null,
        contentWidth: 360,
        htmlParts: ['<p><img src="https://images.example/photo.jpg"></p>'],
        inlineSizedImageUrls: {},
        notify,
        topicImageDeriver
      })
    );

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
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: 'nodeseek',
        contentWidth: 360,
        htmlParts: [`<p><a class="lightbox" href="${imageUrl}"><img src="${displayUrl}"></a></p>`],
        inlineSizedImageUrls: {},
        nodeSeekMediaUserAgent: 'WZ-Controller-Test',
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver()
      })
    );

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

  it('[REG-TOPIC-078] keeps the Topic document and element policy through preview and saving', async () => {
    mockSaveImageUriToLibrary.mockResolvedValue();
    const imageUrl = 'https://i.imgur.com/v2ex-topic.png';
    const mediaReferrer = { documentUrl: 'https://www.v2ex.com/t/1233346' } as const;
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: 'v2ex',
        contentWidth: 360,
        htmlParts: [`<img src="${imageUrl}" referrerpolicy="no-referrer">`],
        inlineSizedImageUrls: {},
        mediaReferrer,
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver()
      })
    );

    await act(() => {
      hook.result.current.openImagePreview(imageUrl, undefined, undefined, 'no-referrer');
    });
    expect(hook.result.current.imagePreview).toEqual({
      contentSource: 'v2ex',
      index: 0,
      items: [{ displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' }],
      referrer: mediaReferrer
    });

    await act(async () => {
      await hook.result.current.savePreviewImage();
    });
    expect(mockSaveImageUriToLibrary).toHaveBeenCalledWith(
      imageUrl,
      {
        mediaContext: {
          contentSource: 'v2ex',
          referrer: mediaReferrer,
          sessionIdentity: expect.stringMatching(/^public:0:/)
        },
        nodeSeekUserAgent: undefined,
        referrerPolicy: 'no-referrer'
      },
      undefined,
      expect.anything()
    );
  });

  it('[REG-TOPIC-078] suppresses preview only for the inline-classified Referer identity', async () => {
    const imageUrl = 'https://images.example/shared-policy.png';
    const requestIdentityForImage = (url: string, policy?: string) => `${url}\u0000referrer:${policy || 'default'}`;
    const noReferrerIdentity = requestIdentityForImage(imageUrl, 'no-referrer');
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: 'v2ex',
        contentWidth: 360,
        htmlParts: [
          `<img src="${imageUrl}" referrerpolicy="no-referrer"><img src="${imageUrl}" referrerpolicy="origin">`
        ],
        inlineSizedImageUrls: { [noReferrerIdentity]: true },
        mediaReferrer: { documentUrl: 'https://www.v2ex.com/t/1233346' },
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver({ requestIdentityForImage })
      })
    );

    await act(() => hook.result.current.openImagePreview(imageUrl, undefined, undefined, 'no-referrer'));
    expect(hook.result.current.imagePreview).toBeNull();

    await act(() => hook.result.current.openImagePreview(imageUrl, undefined, undefined, 'origin'));
    expect(hook.result.current.imagePreview?.items[hook.result.current.imagePreview.index]).toEqual(
      expect.objectContaining({ originalUri: imageUrl, referrerPolicy: 'origin' })
    );
  });

  it('[REG-TOPIC-078] uses the latest image identity when Topic context arrives after mount', async () => {
    const imageUrl = 'https://images.example/late-topic-context.png';
    const baseDeriver = createTopicImageDeriver();
    const firstDeriver = { ...baseDeriver, isInlineSizedImage: () => false };
    const latestDeriver = { ...baseDeriver, isInlineSizedImage: () => true };
    const hook = await renderHook(
      ({ topicImageDeriver }: { topicImageDeriver: typeof baseDeriver }) =>
        useImagePreviewController({
          contentSource: 'v2ex',
          contentWidth: 360,
          htmlParts: [`<img src="${imageUrl}">`],
          inlineSizedImageUrls: {},
          notify: jest.fn(),
          topicImageDeriver
        }),
      { initialProps: { topicImageDeriver: firstDeriver } }
    );

    await hook.rerender({ topicImageDeriver: latestDeriver });
    await act(() => hook.result.current.openImagePreview(imageUrl));

    expect(hook.result.current.imagePreview).toBeNull();
  });

  it('keeps the exact body-rendered image as the preview continuity frame', async () => {
    const originalUrl = 'https://images.example/original.svg';
    const displayUrl = 'https://images.example/display.svg';
    const renderedPoster = 'file:///cache/svg-posters/body-visible.png';
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: null,
        contentWidth: 360,
        htmlParts: [`<a class="lightbox" href="${originalUrl}"><img src="${displayUrl}"></a>`],
        inlineSizedImageUrls: {},
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver()
      })
    );

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
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: null,
        contentWidth: 300,
        htmlParts: [
          [
            '<img src="https://images.example/a-fallback.jpg" data-original="https://images.example/a-original.jpg" srcset="https://images.example/a-320.jpg 320w, https://images.example/a-640.jpg 640w, https://images.example/a-1280.jpg 1280w">',
            '<img src="https://images.example/b-fallback.jpg" data-original="https://images.example/b-original.jpg" srcset="https://images.example/b-360.jpg 360w, https://images.example/b-720.jpg 720w, https://images.example/b-1440.jpg 1440w">'
          ].join('')
        ],
        inlineSizedImageUrls: {},
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver()
      })
    );

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
