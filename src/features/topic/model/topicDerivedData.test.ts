import { describe, expect, it } from 'vitest';
import { filterRepliesWithImages } from './topicDerivedData';
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
    const first = filterRepliesWithImages(replies, 'linuxdo');
    const second = filterRepliesWithImages(replies, 'linuxdo');

    expect(first.map(({ floor }) => floor)).toEqual([1]);
    expect(second.map(({ floor }) => floor)).toEqual([1]);
  });

  it('rejects non-empty image-filter content without a prepared plan', () => {
    expect(() => filterRepliesWithImages([replyWithImage], 'linuxdo')).toThrow('论坛内容缺少匹配的预编译计划');
  });

  it('treats reply signature images as reply images', () => {
    const replyWithSignatureImage = {
      ...replyWithoutImage,
      signatureHtml: '<p><img src="https://cdn.example.com/sign.jpg"></p>'
    };
    const prepared = prepareReplyContent(replyWithSignatureImage, 'linuxdo');

    expect(filterRepliesWithImages([prepared], 'linuxdo')).toEqual([prepared]);
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

    expect(filterRepliesWithImages(replies, 'linuxdo').map(({ floor }) => floor)).toEqual([1]);
  });
});
