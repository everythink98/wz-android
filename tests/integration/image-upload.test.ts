import { describe, expect, it } from 'vitest';
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
  it('supports image uploads only where an upload path is known', () => {
    expect(replyImageUploadSupported('linuxdo')).toBe(true);
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
        '@Butachi [#18](https://www.nodeseek.com/post-723704-18)\n\n![photo.png](https://cdn.nodeimage.com/i/fake.png)',
      mode: 'new-comment',
      postId: 723704
    });
  });
});
