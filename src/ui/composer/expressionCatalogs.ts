export type ReplyComposerInsertExpression = {
  code: string;
  label: string;
  imageUrl?: string;
};

type ReplyComposerExpressionCategory = {
  label: string;
  items: ReplyComposerInsertExpression[];
};

type YaohuoFaceItem = {
  label: string;
  value: string;
};

const NODESEEK_BASE_URL = 'https://www.nodeseek.com';

function numberedStickerFiles(start: number, end: number, digits: number, extension = 'png') {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const file = String(start + index).padStart(digits, '0');
    return extension ? `${file}.${extension}` : file;
  });
}

function nodeseekStickerItems(group: string, files: string[]): ReplyComposerInsertExpression[] {
  return files.map((file) => {
    const codePart = file.replace(/\..*$/, '');
    return {
      code: `:${group}${codePart}:`,
      label: `${group}${codePart}`,
      imageUrl: `${NODESEEK_BASE_URL}/static/image/sticker/${group}/${file.includes('.') ? file : `${file}.png`}`
    };
  });
}

export const NODESEEK_STICKER_CATEGORIES: ReplyComposerExpressionCategory[] = [
  {
    label: 'AC娘',
    items: nodeseekStickerItems('ac', [
      ...numberedStickerFiles(1, 54, 2),
      ...numberedStickerFiles(1001, 1040, 4),
      ...numberedStickerFiles(2001, 2055, 4)
    ])
  },
  {
    label: '洋葱头',
    items: nodeseekStickerItems('yct', numberedStickerFiles(1, 22, 3, 'gif'))
  },
  {
    label: '小黄鸡',
    items: nodeseekStickerItems('xhj', [
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
    items: nodeseekStickerItems('emoji', numberedStickerFiles(0, 48, 2, ''))
  }
];

const DISCOURSE_EMOJI_FALLBACK_ITEMS: ReplyComposerInsertExpression[] = [
  { code: ':grinning_face:', label: 'grinning face' },
  { code: ':heart:', label: 'heart' },
  { code: ':laughing:', label: 'laughing' },
  { code: ':clap:', label: 'clap' },
  { code: ':open_mouth:', label: 'open mouth' }
];

export function discourseEmojiCatalogFromUrlMap(
  emojiUrls: Readonly<Record<string, string>>
): ReplyComposerInsertExpression[] {
  const items = Object.entries(emojiUrls)
    .map(([name, imageUrl]) => ({
      code: `:${name}:`,
      label: name.replace(/_/g, ' '),
      imageUrl
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return items.length ? items : DISCOURSE_EMOJI_FALLBACK_ITEMS;
}

export const YAOHUO_FACE_ITEMS: YaohuoFaceItem[] = [
  { label: '无表情', value: '' },
  { label: '踩', value: '踩.gif' },
  { label: '狂踩', value: '狂踩.gif' },
  { label: '淡定', value: '淡定.gif' },
  { label: '囧', value: '囧.gif' },
  { label: '不要', value: '不要.gif' },
  { label: '重拳出击', value: '重拳出击.gif' },
  { label: '砳砳', value: '砳砳.gif' },
  { label: '滑稽砳砳', value: '滑稽砳砳.gif' },
  { label: '沙发', value: '沙发.gif' },
  { label: '汗', value: '汗.gif' },
  { label: '亲亲', value: '亲亲.gif' },
  { label: '太开心', value: '太开心.gif' },
  { label: '酷', value: '酷.gif' },
  { label: '思考', value: '思考.gif' },
  { label: '发呆', value: '发呆.gif' },
  { label: '得瑟', value: '得瑟.gif' },
  { label: '哈哈', value: '哈哈.gif' },
  { label: '泪流满面', value: '泪流满面.gif' },
  { label: '放电', value: '放电.gif' },
  { label: '困', value: '困.gif' },
  { label: '超人', value: '超人.gif' },
  { label: '害羞', value: '害羞.gif' },
  { label: '呃', value: '呃.gif' },
  { label: '哇哦', value: '哇哦.gif' },
  { label: '要死了', value: '要死了.gif' },
  { label: '谢谢', value: '谢谢.gif' },
  { label: '抓狂', value: '抓狂.gif' },
  { label: '无奈', value: '无奈.gif' },
  { label: '不好笑', value: '不好笑.gif' },
  { label: '感动', value: '感动.gif' },
  { label: '喜欢', value: '喜欢.gif' },
  { label: '疑问', value: '疑问.gif' },
  { label: '委屈', value: '委屈.gif' },
  { label: '你不行', value: '你不行.gif' },
  { label: '流口水', value: '流口水.gif' },
  { label: '咒骂', value: '咒骂.gif' },
  { label: '耶耶', value: '耶耶.gif' },
  { label: '被揍', value: '被揍.gif' },
  { label: '呦呵', value: '呦呵.gif' },
  { label: '抱走', value: '抱走.gif' }
];
