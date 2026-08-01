import { describe, expect, it } from 'vitest';
import { buildDiscourseActionRequest, discourseImageUrlFromUploadResponse } from './discourseActions';

describe('linux.do image upload requests', () => {
  it('builds a Discourse composer upload request without forcing a multipart boundary', () => {
    const request = buildDiscourseActionRequest({
      type: 'upload',
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
    expect(
      discourseImageUrlFromUploadResponse(
        {
          markdown: '![demo.png](upload://abc.png)'
        },
        'https://linux.do',
        'linux.do'
      )
    ).toBe('upload://abc.png');

    expect(
      discourseImageUrlFromUploadResponse(
        {
          short_url: 'upload://abc.png'
        },
        'https://linux.do',
        'linux.do'
      )
    ).toBe('upload://abc.png');

    expect(
      discourseImageUrlFromUploadResponse(
        {
          url: '//linux.do/uploads/default/original/1X/a.png'
        },
        'https://linux.do',
        'linux.do'
      )
    ).toBe('https://linux.do/uploads/default/original/1X/a.png');

    expect(
      discourseImageUrlFromUploadResponse(
        {
          url: '/uploads/default/original/1X/a.png'
        },
        'https://linux.do',
        'linux.do'
      )
    ).toBe('https://linux.do/uploads/default/original/1X/a.png');
  });
});
