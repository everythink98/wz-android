import { describe, expect, it } from 'vitest';
import { createTopicImageDeriver, filterRepliesWithImages } from './topicDerivedData';
import type { Reply } from '@/domain/forum/models';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';

const replyWithImage: Reply = {
  author: 'alice',
  contentHtml: '<p>photo <img src="https://cdn.example.com/a.jpg"></p>',
  createdAt: '2026-06-05T01:00:00.000Z',
  floor: 1
};

const replyWithoutImage: Reply = {
  author: 'bob',
  contentHtml: '<p>plain text</p>',
  createdAt: '2026-06-05T01:01:00.000Z',
  floor: 2
};

describe('Android topic derived data', () => {
  it('filters image replies without re-extracting their HTML', () => {
    const replies = [replyWithImage, replyWithoutImage].map((reply) => prepareReplyContent(reply, 'linuxdo'));
    const deriver = createTopicImageDeriver();

    const first = filterRepliesWithImages(replies, {}, deriver, 'linuxdo');
    const second = filterRepliesWithImages(replies, {}, deriver, 'linuxdo');

    expect(first.map(({ floor }) => floor)).toEqual([1]);
    expect(second.map(({ floor }) => floor)).toEqual([1]);
  });

  it('rejects non-empty image-filter content without a prepared plan', () => {
    expect(() => filterRepliesWithImages([replyWithImage], {}, createTopicImageDeriver(), 'linuxdo')).toThrow(
      '论坛内容缺少匹配的预编译计划'
    );
  });

  it('excludes only the prepared image whose final Referer identity was classified inline', () => {
    const url = 'https://cdn.example.com/shared.png';
    const requestIdentityForImage = (src: string, referrerPolicy?: string) =>
      `${src}\u0000referrer:${referrerPolicy === 'no-referrer' ? 'none' : 'https://forum.example/'}`;
    const noReferrerIdentity = requestIdentityForImage(url, 'no-referrer');
    const deriver = createTopicImageDeriver({ requestIdentityForImage });
    const noReferrerReply = prepareReplyContent(
      { ...replyWithImage, contentHtml: `<img src="${url}" referrerpolicy="no-referrer">` },
      'linuxdo'
    );
    const originReply = prepareReplyContent(
      { ...replyWithImage, floor: 2, contentHtml: `<img src="${url}" referrerpolicy="origin">` },
      'linuxdo'
    );

    expect(
      filterRepliesWithImages([noReferrerReply, originReply], { [noReferrerIdentity]: true }, deriver, 'linuxdo').map(
        ({ floor }) => floor
      )
    ).toEqual([2]);
    expect(deriver.isInlineSizedImage(url, 'no-referrer', { [noReferrerIdentity]: true })).toBe(true);
    expect(deriver.isInlineSizedImage(url, 'origin', { [noReferrerIdentity]: true })).toBe(false);
  });

  it('treats reply signature images as reply images', () => {
    const replyWithSignatureImage = {
      ...replyWithoutImage,
      signatureHtml: '<p><img src="https://cdn.example.com/sign.jpg"></p>'
    };
    const prepared = prepareReplyContent(replyWithSignatureImage, 'linuxdo');

    expect(filterRepliesWithImages([prepared], {}, createTopicImageDeriver(), 'linuxdo')).toEqual([prepared]);
  });

  it('treats dimension-only small images as reply images without counting emoji', () => {
    const smallRealImage = {
      ...replyWithImage,
      contentHtml: '<p><img src="https://i.imgur.com/agAJ0Rd.png" class="thumbnail" width="20" height="20"></p>'
    };
    const emojiOnly = {
      ...replyWithoutImage,
      contentHtml:
        '<p><img class="emoji" src="https://linux.do/images/emoji/twitter/slight_smile.png" alt=":slight_smile:" title=":slight_smile:" width="20" height="20"></p>'
    };
    const replies = [smallRealImage, emojiOnly].map((reply) => prepareReplyContent(reply, 'linuxdo'));

    expect(
      filterRepliesWithImages(replies, {}, createTopicImageDeriver(), 'linuxdo').map(({ floor }) => floor)
    ).toEqual([1]);
  });
});
