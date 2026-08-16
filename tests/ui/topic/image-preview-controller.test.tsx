import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { PixelRatio } from 'react-native';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import { useImagePreviewController as useRawImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { imagePreviewItemAt } from '@/platform/media/imagePreviewCatalog';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';

const mockSaveImageUriToLibrary = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.mock('@/platform/media/imageSave', () => ({
  saveImageUriToLibrary: (...args: unknown[]) => mockSaveImageUriToLibrary(...args)
}));

const compiledPreviewImages = new Map<string, ReturnType<typeof compileForumContent>['previewImages']>();

function useImagePreviewController({
  htmlParts,
  ...options
}: Parameters<typeof useRawImagePreviewController>[0] & { htmlParts?: string[] }) {
  const controller = useRawImagePreviewController(options);
  const cacheKey = htmlParts ? `${options.contentSource || 'nodeseek'}\n${htmlParts.join('\n')}` : '';
  let previewImages = cacheKey ? compiledPreviewImages.get(cacheKey) : undefined;
  if (cacheKey && !previewImages) {
    previewImages = htmlParts!.flatMap(
      (html) =>
        compileForumContent({ html, role: 'opening', source: options.contentSource || 'nodeseek' }).previewImages
    );
    compiledPreviewImages.set(cacheKey, previewImages);
  }
  useLayoutEffect(() => {
    if (previewImages) controller.registerImagePreviewDescriptors(previewImages);
  }, [controller.registerImagePreviewDescriptors, previewImages]);
  return controller;
}

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
    expect(imagePreviewItemAt(hook.result.current.imagePreview!, 0)).toEqual({
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
    expect(hook.result.current.imagePreview).toEqual(
      expect.objectContaining({ contentSource: 'v2ex', index: 0, referrer: mediaReferrer })
    );
    expect(imagePreviewItemAt(hook.result.current.imagePreview!, 0)).toEqual({
      displayUri: imageUrl,
      originalUri: imageUrl,
      referrerPolicy: 'no-referrer'
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
    expect(imagePreviewItemAt(hook.result.current.imagePreview!, hook.result.current.imagePreview!.index)).toEqual(
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

    expect(imagePreviewItemAt(hook.result.current.imagePreview!, 0)).toEqual({
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

  it('[REG-TOPIC-096] opens a registered 2000-image catalog without receiving source HTML', async () => {
    const urls = Array.from({ length: 2_000 }, (_, index) => `https://images.example/${index}.webp`);
    const previewImages = compileForumContent({
      html: urls.map((url) => `<img src="${url}">`).join(''),
      role: 'opening',
      source: 'nodeseek'
    }).previewImages;
    const hook = await renderHook(() =>
      useImagePreviewController({
        contentSource: 'nodeseek',
        contentWidth: 360,
        inlineSizedImageUrls: {},
        notify: jest.fn(),
        topicImageDeriver: createTopicImageDeriver()
      })
    );

    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(urls[1_380]));

    expect(hook.result.current.imagePreview?.items).toHaveLength(2_000);
    expect(hook.result.current.imagePreview?.index).toBe(1_380);
  });

  it('[REG-PERF-018] reprojects inline exclusions without preparing registered descriptors again', async () => {
    const firstUrl = 'https://images.example/prepared-640.webp';
    const secondUrl = 'https://images.example/second.webp';
    const stringifySourceSet = jest.fn(() => `${firstUrl} 640w, https://images.example/prepared-1280.webp 1280w`);
    const descriptors = [
      { source: firstUrl, sourceSet: { toString: stringifySourceSet } as unknown as string },
      { source: secondUrl }
    ];
    const topicImageDeriver = createTopicImageDeriver();
    const hook = await renderHook(
      ({ inlineSizedImageUrls }: { inlineSizedImageUrls: Record<string, true> }) =>
        useRawImagePreviewController({
          contentSource: 'v2ex',
          contentWidth: 360,
          inlineSizedImageUrls,
          notify: jest.fn(),
          topicImageDeriver
        }),
      { initialProps: { inlineSizedImageUrls: {} } }
    );

    await act(() => hook.result.current.registerImagePreviewDescriptors(descriptors));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview?.items).toHaveLength(2);
    expect(stringifySourceSet).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({ inlineSizedImageUrls: { [firstUrl]: true } });
    await act(() => hook.result.current.registerImagePreviewDescriptors(descriptors));
    await act(() => hook.result.current.openImagePreview(secondUrl));

    expect(hook.result.current.imagePreview?.items).toHaveLength(1);
    expect(stringifySourceSet).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-096] keeps equivalent registrations and invalidates semantic catalog inputs', async () => {
    let pixelRatio = 2;
    const pixelRatioSpy = jest.spyOn(PixelRatio, 'get').mockImplementation(() => pixelRatio);
    const firstUrl = 'https://images.example/first-640.webp';
    const secondUrl = 'https://images.example/second.webp';
    const previewImages = compileForumContent({
      html: `<img src="${firstUrl}" srcset="${firstUrl} 640w, https://images.example/first-1280.webp 1280w"><img src="${secondUrl}">`,
      role: 'opening',
      source: 'nodeseek'
    }).previewImages;
    const topicImageDeriver = createTopicImageDeriver();
    const hook = await renderHook(
      ({
        contentSource,
        inlineSizedImageUrls,
        mediaReferrer,
        width
      }: {
        contentSource: 'nodeseek' | 'v2ex';
        inlineSizedImageUrls: Record<string, true>;
        mediaReferrer?: { documentUrl: string };
        width: number;
      }) =>
        useRawImagePreviewController({
          contentSource,
          contentWidth: width,
          inlineSizedImageUrls,
          mediaReferrer,
          notify: jest.fn(),
          topicImageDeriver
        }),
      {
        initialProps: {
          contentSource: 'nodeseek' as const,
          inlineSizedImageUrls: {},
          mediaReferrer: undefined,
          width: 300
        }
      }
    );

    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    const firstCatalogItem = hook.result.current.imagePreview!.items[0];
    expect(firstCatalogItem.displayUri).toBe(firstUrl);

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'nodeseek',
      inlineSizedImageUrls: {},
      mediaReferrer: undefined,
      width: 300
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors([...previewImages]));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0]).toBe(firstCatalogItem);

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'nodeseek',
      inlineSizedImageUrls: {},
      mediaReferrer: undefined,
      width: 700
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0].displayUri).toBe('https://images.example/first-1280.webp');
    const widthCatalogItem = hook.result.current.imagePreview!.items[0];

    pixelRatio = 3;
    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'nodeseek',
      inlineSizedImageUrls: {},
      mediaReferrer: undefined,
      width: 700
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0]).not.toBe(widthCatalogItem);
    const pixelRatioCatalogItem = hook.result.current.imagePreview!.items[0];

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'nodeseek',
      inlineSizedImageUrls: {},
      mediaReferrer: { documentUrl: 'https://www.nodeseek.com/post-1-1' },
      width: 700
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0]).not.toBe(pixelRatioCatalogItem);
    expect(hook.result.current.imagePreview?.referrer?.documentUrl).toBe('https://www.nodeseek.com/post-1-1');
    const referrerCatalogItem = hook.result.current.imagePreview!.items[0];

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'v2ex',
      inlineSizedImageUrls: {},
      mediaReferrer: { documentUrl: 'https://www.nodeseek.com/post-1-1' },
      width: 700
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors(previewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0]).not.toBe(referrerCatalogItem);

    const changedPreviewImages = [
      ...previewImages,
      ...compileForumContent({
        html: '<img src="https://images.example/third.webp">',
        role: 'opening',
        source: 'v2ex'
      }).previewImages
    ];
    await act(() => hook.result.current.closeImagePreview());
    await act(() => hook.result.current.registerImagePreviewDescriptors(changedPreviewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview?.items).toHaveLength(3);
    const changedCatalogItem = hook.result.current.imagePreview!.items[0];

    await act(() => hook.result.current.closeImagePreview());
    await act(() => hook.result.current.registerImagePreviewDescriptors([...changedPreviewImages]));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview!.items[0]).toBe(changedCatalogItem);

    await act(() => hook.result.current.closeImagePreview());
    await hook.rerender({
      contentSource: 'v2ex',
      inlineSizedImageUrls: { [firstUrl]: true },
      mediaReferrer: { documentUrl: 'https://www.nodeseek.com/post-1-1' },
      width: 700
    });
    await act(() => hook.result.current.registerImagePreviewDescriptors(changedPreviewImages));
    await act(() => hook.result.current.openImagePreview(secondUrl));
    expect(hook.result.current.imagePreview?.items).toHaveLength(2);
    pixelRatioSpy.mockRestore();
  });

  it('[REG-TOPIC-096] rebuilds the ready catalog when the same source advances its media session', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/session-scoped.webp';
    let setSessionEpoch: ((epoch: number) => void) | undefined;
    const SessionEpochHarness = ({ children }: { children: ReactNode }) => {
      const [sessionEpoch, updateSessionEpoch] = useState(0);
      setSessionEpoch = updateSessionEpoch;
      return (
        <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: sessionEpoch }}>
          {children}
        </ForumSessionEpochProvider>
      );
    };
    const hook = await renderHook(
      () =>
        useImagePreviewController({
          contentSource: 'nodeseek',
          contentWidth: 360,
          htmlParts: [`<img src="${imageUrl}">`],
          inlineSizedImageUrls: {},
          notify: jest.fn(),
          topicImageDeriver: createTopicImageDeriver()
        }),
      { wrapper: SessionEpochHarness }
    );

    await act(() => hook.result.current.openImagePreview(imageUrl));
    const firstSessionItem = hook.result.current.imagePreview!.items[0];
    await act(() => hook.result.current.closeImagePreview());

    await act(() => setSessionEpoch?.(1));
    await act(() => hook.result.current.openImagePreview(imageUrl));

    expect(hook.result.current.imagePreview!.items[0]).not.toBe(firstSessionItem);
  });
});
