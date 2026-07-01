import { describe, expect, it } from 'vitest';
import { buildLinuxDoImageUploadRequest, linuxDoImageUrlFromUploadResponse } from './linuxdoActions';

describe('linux.do image upload requests', () => {
  it('builds a Discourse composer upload request without forcing a multipart boundary', () => {
    const request = buildLinuxDoImageUploadRequest({
      file: {
        uri: 'file:///cache/demo.png',
        name: 'demo.png',
        mimeType: 'image/png'
      }
    });

    expect(request).toMatchObject({
      path: '/uploads.json',
      method: 'POST',
      headers: {}
    });
    expect(request.body).toBeInstanceOf(FormData);
    const entries = Array.from((request.body as FormData & { entries(): Iterable<[string, unknown]> }).entries());
    expect(entries.map(([key, value]) => [key, String(value)])).toEqual([
      ['type', 'composer'],
      ['synchronous', 'true'],
      ['file', '[object Object]']
    ]);
  });

  it('reads Discourse upload URLs from known response shapes', () => {
    expect(linuxDoImageUrlFromUploadResponse({
      markdown: '![demo.png](upload://abc.png)'
    })).toBe('upload://abc.png');

    expect(linuxDoImageUrlFromUploadResponse({
      short_url: 'upload://abc.png'
    })).toBe('upload://abc.png');

    expect(linuxDoImageUrlFromUploadResponse({
      url: '//linux.do/uploads/default/original/1X/a.png'
    })).toBe('https://linux.do/uploads/default/original/1X/a.png');

    expect(linuxDoImageUrlFromUploadResponse({
      url: '/uploads/default/original/1X/a.png'
    })).toBe('https://linux.do/uploads/default/original/1X/a.png');
  });
});
