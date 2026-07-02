import { describe, expect, it } from 'vitest';
import {
  NODESEEK_STICKER_CATEGORIES,
  YAOHUO_FACE_ITEMS,
  linuxDoEmojiCatalogFromUrlMap
} from './replyComposerExpressionCatalogs';

describe('reply composer expression catalogs', () => {
  it('keeps NodeSeek sticker categories aligned with the original composer groups', () => {
    expect(NODESEEK_STICKER_CATEGORIES.map((item) => item.label)).toEqual(['AC娘', '洋葱头', '小黄鸡', 'Fluent']);
    expect(NODESEEK_STICKER_CATEGORIES.every((category) => category.items.length > 0)).toBe(true);
    expect(NODESEEK_STICKER_CATEGORIES[0].items[0]).toMatchObject({
      code: ':ac01:',
      imageUrl: 'https://www.nodeseek.com/static/image/sticker/ac/01.png'
    });
    expect(NODESEEK_STICKER_CATEGORIES.find((category) => category.label === '小黄鸡')?.items).toContainEqual({
      code: ':xhj032:',
      label: 'xhj032',
      imageUrl: 'https://www.nodeseek.com/static/image/sticker/xhj/032.png'
    });
    expect(NODESEEK_STICKER_CATEGORIES.find((category) => category.label === 'Fluent')?.items).toContainEqual({
      code: ':emoji35:',
      label: 'emoji35',
      imageUrl: 'https://www.nodeseek.com/static/image/sticker/emoji/35.png'
    });
    expect(NODESEEK_STICKER_CATEGORIES.find((category) => category.label === 'App')).toBeUndefined();
  });

  it('builds linux.do emoji insert codes from emoji url data', () => {
    expect(linuxDoEmojiCatalogFromUrlMap({
      grinning_face: 'https://linux.do/images/emoji/twemoji/grinning_face.png'
    })[0]).toEqual({
      code: ':grinning_face:',
      label: 'grinning face',
      imageUrl: 'https://linux.do/images/emoji/twemoji/grinning_face.png'
    });
    expect(linuxDoEmojiCatalogFromUrlMap({})[0].code).toBe(':grinning_face:');
  });

  it('keeps yaohuo faces as submitted face values', () => {
    expect(YAOHUO_FACE_ITEMS[0]).toEqual({ label: '无表情', value: '' });
    expect(YAOHUO_FACE_ITEMS.some((item) => item.value === '淡定.gif')).toBe(true);
    expect(YAOHUO_FACE_ITEMS.some((item) => item.value === '狂踩.gif')).toBe(true);
  });
});
