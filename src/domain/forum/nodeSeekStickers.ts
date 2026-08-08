import { NODESEEK_URL } from './sourceUrls';

export type NodeSeekStickerExpression = {
  code: string;
  label: string;
  imageUrl: string;
};

export type NodeSeekStickerCategory = {
  label: string;
  items: NodeSeekStickerExpression[];
};

function numberedStickerFiles(start: number, end: number, digits: number, extension = 'png') {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const file = String(start + index).padStart(digits, '0');
    return extension ? `${file}.${extension}` : file;
  });
}

function nodeSeekStickerItems(group: string, files: string[]): NodeSeekStickerExpression[] {
  return files.map((file) => {
    const codePart = file.replace(/\..*$/, '');
    return {
      code: `:${group}${codePart}:`,
      label: `${group}${codePart}`,
      imageUrl: `${NODESEEK_URL}/static/image/sticker/${group}/${file.includes('.') ? file : `${file}.png`}`
    };
  });
}

export const NODESEEK_STICKER_CATEGORIES: NodeSeekStickerCategory[] = [
  {
    label: 'AC娘',
    items: nodeSeekStickerItems('ac', [
      ...numberedStickerFiles(1, 54, 2),
      ...numberedStickerFiles(1001, 1040, 4),
      ...numberedStickerFiles(2001, 2055, 4)
    ])
  },
  {
    label: '洋葱头',
    items: nodeSeekStickerItems('yct', numberedStickerFiles(1, 22, 3, 'gif'))
  },
  {
    label: '小黄鸡',
    items: nodeSeekStickerItems('xhj', [
      '001.png',
      '002.png',
      '003.png',
      '004.gif',
      '005.png',
      '006.png',
      '007.png',
      '008.gif',
      '009.gif',
      '010.gif',
      '011.png',
      '012.gif',
      '013.gif',
      '014.gif',
      '015.gif',
      '016.gif',
      '017.gif',
      '018.gif',
      '019.gif',
      '020.gif',
      '021.gif',
      '022.png',
      '023.gif',
      '024.png',
      '025.png',
      '026.gif',
      '027.gif',
      '028.gif',
      '029.gif',
      '030.gif',
      '031.png',
      '032.png'
    ])
  },
  {
    label: 'Fluent',
    items: nodeSeekStickerItems('emoji', numberedStickerFiles(0, 48, 2, ''))
  }
];

const nodeSeekStickerByCode = new Map(
  NODESEEK_STICKER_CATEGORIES.flatMap((category) => category.items).map((item) => [item.code, item])
);

export function nodeSeekStickerForCode(code: string) {
  return nodeSeekStickerByCode.get(code);
}
