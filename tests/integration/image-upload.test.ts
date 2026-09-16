import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { withRequestBeforeSend } from '@/platform/network/request';

const nativeImage = vi.hoisted(() => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  size: 1024,
  outputSize: 512,
  delete: vi.fn(),
  close: vi.fn(),
  releaseContext: vi.fn(),
  releaseImage: vi.fn(),
  save: vi.fn(),
  render: vi.fn()
}));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    exists = true;
    get size() {
      return this.uri.endsWith('converted.webp') ? nativeImage.outputSize : nativeImage.size;
    }
    open() {
      return { readBytes: () => nativeImage.bytes, close: nativeImage.close };
    }
    delete() {
      nativeImage.delete(this.uri);
    }
  }
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { WEBP: 'webp' },
  ImageManipulator: { manipulate: () => ({ renderAsync: nativeImage.render, release: nativeImage.releaseContext }) }
}));

beforeEach(() => {
  vi.clearAllMocks();
  nativeImage.bytes = new Uint8Array([0xff, 0xd8, 0xff]);
  nativeImage.size = 1024;
  nativeImage.outputSize = 512;
  nativeImage.save.mockResolvedValue({ uri: 'file:///cache/converted.webp', width: 400, height: 600 });
  nativeImage.render.mockResolvedValue({ saveAsync: nativeImage.save, release: nativeImage.releaseImage });
});
import { buildNodeSeekReplyRequest } from '@/sources/nodeseek/actionRequest';
import {
  appendReplyImageMarkup,
  normalizeReplyImageAsset,
  replyImageMarkupForSource,
  replyImageUploadSupported
} from '@/sources/imageUpload';
import {
  nodeImageApiKeyFromResponse,
  isNodeImageApiKeyExpiredError,
  nodeImageUploadErrorMessage,
  nodeImageUrlFromUploadResponse,
  uploadNodeSeekReplyImage,
  uploadNodeSeekReplyImageWithApiKey
} from '@/sources/nodeimage/upload';
import { uploadYaohuoReplyImage, yaohuoImageUrlFromUploadResponse } from '@/sources/yaohuo/imageUpload';

describe('reply image upload helpers', () => {
  const localImage = { uri: 'file:///cache/wechat.jpg', name: 'wechat.jpg', mimeType: 'image/jpeg' };
  const uploaded = () => new Response(JSON.stringify({ url: 'https://img.example/photo.webp' }));

  it.each([
    ['GIF89a123456', 'gif'],
    ['RIFF1234WEBP', 'webp']
  ])('preserves actual %s bytes even when the picker names them JPEG', async (header, extension) => {
    nativeImage.bytes = Uint8Array.from(header, (char) => char.charCodeAt(0));
    const append = vi.spyOn(FormData.prototype, 'append');
    try {
      await uploadNodeSeekReplyImage({ apiKey: 'key', file: localImage, fetcher: async () => uploaded() });
      expect(append).toHaveBeenCalledWith('image', {
        uri: localImage.uri,
        name: `wechat.${extension}`,
        type: `image/${extension}`
      });
      expect(nativeImage.render).not.toHaveBeenCalled();
      expect(nativeImage.delete).not.toHaveBeenCalled();
      expect(nativeImage.close).toHaveBeenCalledTimes(1);
    } finally {
      append.mockRestore();
    }
  });

  it.each(['input-limit', 'output-limit', 'empty-output', 'decode-failure', 'save-failure'])(
    'rejects %s before any network upload and releases owned resources',
    async (failure) => {
      if (failure === 'input-limit') nativeImage.size = 20 * 1024 * 1024 + 1;
      if (failure === 'output-limit') nativeImage.outputSize = 20 * 1024 * 1024 + 1;
      if (failure === 'empty-output') nativeImage.outputSize = 0;
      if (failure === 'decode-failure') nativeImage.render.mockRejectedValueOnce(new Error('decode'));
      if (failure === 'save-failure') nativeImage.save.mockRejectedValueOnce(new Error('save'));
      const fetcher = vi.fn(async () => uploaded());
      await expect(uploadNodeSeekReplyImage({ apiKey: 'key', file: localImage, fetcher })).rejects.toMatchObject({
        reason: 'image_conversion_failed'
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(nativeImage.delete).toHaveBeenCalledTimes(['output-limit', 'empty-output'].includes(failure) ? 1 : 0);
      expect(nativeImage.releaseContext).toHaveBeenCalledTimes(failure === 'input-limit' ? 0 : 1);
      expect(nativeImage.releaseImage).toHaveBeenCalledTimes(
        ['input-limit', 'decode-failure'].includes(failure) ? 0 : 1
      );
    }
  );

  it.each(['cancel', 'identity', 'key-generation'])(
    'blocks %s changes during conversion before sending the file',
    async (change) => {
      const controller = new AbortController();
      let current = true;
      nativeImage.save.mockImplementationOnce(async () => {
        if (change === 'cancel') controller.abort();
        else current = false;
        return { uri: 'file:///cache/converted.webp' };
      });
      const transport = vi.fn(async () => uploaded());
      const fetcher = withRequestBeforeSend(transport, () => {
        if (!current) throw Object.assign(new Error(change), { reason: 'stale' });
      });
      await expect(
        uploadNodeSeekReplyImage({ apiKey: 'key', file: localImage, fetcher, signal: controller.signal })
      ).rejects.toBeInstanceOf(Error);
      expect(transport).not.toHaveBeenCalled();
      expect(nativeImage.delete).toHaveBeenCalledExactlyOnceWith('file:///cache/converted.webp');
    }
  );

  it.each(['success', 'network-failure'])('releases the converted copy after %s without retrying', async (outcome) => {
    const fetcher = vi.fn(async () => {
      if (outcome === 'network-failure') throw new TypeError('Network request failed');
      return uploaded();
    });
    const result = uploadNodeSeekReplyImage({ apiKey: 'key', file: localImage, fetcher });
    if (outcome === 'success') await expect(result).resolves.toBe('https://img.example/photo.webp');
    else await expect(result).rejects.toThrow('Network request failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(nativeImage.delete).toHaveBeenCalledExactlyOnceWith('file:///cache/converted.webp');
  });

  it('uploads a quality-100 WebP copy and releases it after server rejection', async () => {
    const append = vi.spyOn(FormData.prototype, 'append');
    try {
      await expect(
        uploadNodeSeekReplyImage({
          apiKey: 'test-key',
          file: { uri: 'file:///cache/wechat.jpg', name: 'wechat.jpg', mimeType: 'image/jpeg' },
          fetcher: async () => new Response(JSON.stringify({ message: '文件类型验证失败' }), { status: 400 })
        })
      ).rejects.toSatisfy((error: unknown) => normalizeDiagnosticReason(error) === 'upload_rejected');
      expect(nativeImage.save).toHaveBeenCalledWith({ format: 'webp', compress: 1 });
      expect(append).toHaveBeenCalledWith('image', {
        uri: 'file:///cache/converted.webp',
        name: 'wechat.webp',
        type: 'image/webp'
      });
      expect(nativeImage.delete).toHaveBeenCalledExactlyOnceWith('file:///cache/converted.webp');
      expect(nativeImage.releaseContext).toHaveBeenCalledTimes(1);
      expect(nativeImage.releaseImage).toHaveBeenCalledTimes(1);
    } finally {
      append.mockRestore();
    }
  });

  it('supports image uploads only where an upload path is known', () => {
    expect(replyImageUploadSupported('linuxdo')).toBe(true);
    expect(replyImageUploadSupported('yaohuo')).toBe(true);
    expect(replyImageUploadSupported('nodeseek')).toBe(true);
  });

  it('normalizes selected image files before upload', () => {
    expect(
      normalizeReplyImageAsset({
        uri: 'file:///cache/photo.JPG',
        name: '',
        mimeType: '',
        size: 1024
      })
    ).toEqual({
      uri: 'file:///cache/photo.JPG',
      name: 'photo.JPG',
      mimeType: 'image/jpeg',
      size: 1024
    });
  });

  it('keeps a selected image whose system uri contains malformed percent encoding', () => {
    expect(
      normalizeReplyImageAsset({
        uri: 'file:///cache/photo%broken.jpg',
        name: '',
        mimeType: '',
        size: 1024
      })
    ).toEqual({
      uri: 'file:///cache/photo%broken.jpg',
      name: 'photo%broken.jpg',
      mimeType: 'image/jpeg',
      size: 1024
    });
  });

  it('rejects non-images and oversized files', () => {
    expect(() =>
      normalizeReplyImageAsset({
        uri: 'file:///cache/file.txt',
        name: 'file.txt',
        mimeType: 'text/plain'
      })
    ).toThrow('请选择图片文件');

    expect(() =>
      normalizeReplyImageAsset({
        uri: 'file:///cache/big.jpg',
        name: 'big.jpg',
        mimeType: 'image/jpeg',
        size: 21 * 1024 * 1024
      })
    ).toThrow('图片不能超过 20MB');
  });

  it('builds reply markup for uploaded images', () => {
    expect(replyImageMarkupForSource('linuxdo', 'upload://abc.png', 'demo image.png')).toBe(
      '![demo image.png](upload://abc.png)'
    );
    expect(replyImageMarkupForSource('linuxdo', 'upload://xyz.png', 'demo.png')).toBe('![demo.png](upload://xyz.png)');
    expect(replyImageMarkupForSource('nodeseek', 'https://cdn.nodeimage.com/i/a.png', 'demo.png')).toBe(
      '![demo.png](https://cdn.nodeimage.com/i/a.png)'
    );
    expect(replyImageMarkupForSource('yaohuo', 'https://cdn.example.com/a.png', 'demo.png')).toBe(
      '[img]https://cdn.example.com/a.png[/img]'
    );
  });

  it('appends uploaded image markup to the current draft', () => {
    expect(appendReplyImageMarkup('', '![a](upload://a.png)')).toBe('![a](upload://a.png)');
    expect(appendReplyImageMarkup('hello', '![a](upload://a.png)')).toBe('hello\n![a](upload://a.png)');
  });

  it('reads yaohuo image bed responses', () => {
    expect(
      yaohuoImageUrlFromUploadResponse({
        code: 200,
        data: { url: 'https://cdn.example.com/a.png' }
      })
    ).toBe('https://cdn.example.com/a.png');

    expect(
      yaohuoImageUrlFromUploadResponse({
        code: 200,
        data: 'https://cdn.example.com/b.png'
      })
    ).toBe('https://cdn.example.com/b.png');
  });

  it('uploads Yaohuo reply images through the image bed', async () => {
    const fetcher = async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://tucdn.wpon.cn/api/upload');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(
        JSON.stringify({
          data: { url: 'https://cdn.example.com/uploaded.png' }
        }),
        { status: 200 }
      );
    };

    await expect(
      uploadYaohuoReplyImage({
        file: {
          uri: 'file:///cache/photo.png',
          name: 'photo.png',
          mimeType: 'image/png'
        },
        fetcher
      })
    ).resolves.toBe('https://cdn.example.com/uploaded.png');
  });

  it('reads NodeImage upload responses', () => {
    expect(
      nodeImageUrlFromUploadResponse({
        success: true,
        links: {
          direct: 'https://cdn.nodeimage.com/i/a.png',
          markdown: '![image](https://cdn.nodeimage.com/i/a.png)'
        }
      })
    ).toBe('https://cdn.nodeimage.com/i/a.png');

    expect(
      nodeImageUrlFromUploadResponse({
        data: { url: 'https://cdn.nodeimage.com/i/b.png' }
      })
    ).toBe('https://cdn.nodeimage.com/i/b.png');

    expect(() => nodeImageUrlFromUploadResponse({ success: true })).toThrow('NodeImage 返回缺少图片地址');
  });

  it('uses NodeImage error messages when upload fails', () => {
    expect(nodeImageUploadErrorMessage({ message: 'API Key 无效' }, 401)).toBe('API Key 无效');
    expect(nodeImageUploadErrorMessage(null, 500)).toBe('NodeImage 上传失败：HTTP 500');
  });

  it('reads NodeImage API key responses', () => {
    expect(nodeImageApiKeyFromResponse({ api_key: ' secret ' })).toBe('secret');
    expect(nodeImageApiKeyFromResponse({ data: { apiKey: 'next-secret' } })).toBe('next-secret');
    expect(nodeImageApiKeyFromResponse({ ok: true })).toBe('');
  });

  it('uploads NodeSeek reply images through NodeImage with an API key', async () => {
    const fetcher = async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://api.nodeimage.com/api/upload');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('secret');
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(
        JSON.stringify({
          success: true,
          links: { direct: 'https://cdn.nodeimage.com/i/a.png' }
        }),
        { status: 200 }
      );
    };

    await expect(
      uploadNodeSeekReplyImage({
        apiKey: ' secret ',
        file: {
          uri: 'file:///cache/photo.png',
          name: 'photo.png',
          mimeType: 'image/png'
        },
        fetcher
      })
    ).resolves.toBe('https://cdn.nodeimage.com/i/a.png');
  });

  it('rejects NodeSeek image uploads without a NodeImage API key', async () => {
    await expect(
      uploadNodeSeekReplyImage({
        apiKey: ' ',
        file: {
          uri: 'file:///cache/photo.png',
          name: 'photo.png',
          mimeType: 'image/png'
        },
        fetcher: async () => new Response('{}')
      })
    ).rejects.toThrow('请先保存 NodeImage API Key');
  });

  it('marks NodeImage 401 and 403 upload failures as expired API keys', async () => {
    await expect(
      uploadNodeSeekReplyImage({
        apiKey: 'old-secret',
        file: {
          uri: 'file:///cache/photo.png',
          name: 'photo.png',
          mimeType: 'image/png'
        },
        fetcher: async () => new Response(JSON.stringify({ message: 'API Key 无效' }), { status: 403 })
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error && error.message === 'API Key 无效' && isNodeImageApiKeyExpiredError(error)
    );
  });

  it('never replays the same NodeImage upload after an authorization failure', async () => {
    const headers: string[] = [];
    let ensureCalls = 0;
    const fetcher = async (_input: string, init?: RequestInit) => {
      headers.push((init?.headers as Record<string, string>)['X-API-Key']);
      if (headers.length === 1) {
        return new Response(JSON.stringify({ message: 'API Key 无效' }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          links: { direct: 'https://cdn.nodeimage.com/i/retry.png' }
        }),
        { status: 200 }
      );
    };

    await expect(
      uploadNodeSeekReplyImageWithApiKey({
        ensureApiKey: async () => {
          ensureCalls += 1;
          return 'old-secret';
        },
        file: {
          uri: 'file:///cache/photo.png',
          name: 'photo.png',
          mimeType: 'image/png'
        },
        fetcher
      })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error && error.message === 'API Key 无效' && isNodeImageApiKeyExpiredError(error)
    );

    expect(headers).toEqual(['old-secret']);
    expect(ensureCalls).toBe(1);
  });

  it('dry-runs a successful NodeSeek image upload into a floor reply payload without posting it', async () => {
    const imageUrl = await uploadNodeSeekReplyImage({
      apiKey: 'secret',
      file: {
        uri: 'file:///cache/photo.png',
        name: 'photo.png',
        mimeType: 'image/png'
      },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            success: true,
            links: { direct: 'https://cdn.nodeimage.com/i/fake.png' }
          }),
          { status: 200 }
        )
    });
    const markup = replyImageMarkupForSource('nodeseek', imageUrl, 'photo.png');
    const draft = appendReplyImageMarkup('', markup);
    const request = buildNodeSeekReplyRequest({
      postId: '723704',
      content: draft,
      csrfToken: 'fixed-csrf-token',
      replyTarget: {
        floor: 18,
        author: 'Butachi'
      }
    });

    expect(request).toMatchObject({
      path: '/api/content/new-comment',
      method: 'POST'
    });
    expect(JSON.parse(request.body || '{}')).toEqual({
      content:
        '@Butachi [#18](https://www.nodeseek.com/post-723704-2#18)\n\n![photo.png](https://cdn.nodeimage.com/i/fake.png)',
      mode: 'new-comment',
      postId: 723704
    });
  });
});
