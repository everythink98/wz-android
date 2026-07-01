const REPLY_INPUT_HORIZONTAL_PADDING = 12;
const REPLY_INPUT_VERTICAL_PADDING = 9;
const REPLY_INPUT_FONT_SIZE = 14;
const REPLY_INPUT_LINE_HEIGHT = 20;

function estimatedReplyComposerCharWidth(char: string) {
  if (char === ' ') {
    return REPLY_INPUT_FONT_SIZE * 0.35;
  }
  if (char === '\t') {
    return REPLY_INPUT_FONT_SIZE * 2;
  }
  const codePoint = char.codePointAt(0) || 0;
  if (codePoint > 0xffff || codePoint >= 0x2e80) {
    return REPLY_INPUT_FONT_SIZE;
  }
  if (/[A-Z]/.test(char)) {
    return REPLY_INPUT_FONT_SIZE * 0.62;
  }
  return REPLY_INPUT_FONT_SIZE * 0.54;
}

export function replyComposerSelectionIndexFromPress({
  content,
  inputWidth,
  locationX,
  locationY
}: {
  content: string;
  inputWidth: number;
  locationX: number;
  locationY: number;
}) {
  if (!content) {
    return 0;
  }
  const contentWidth = Math.max(REPLY_INPUT_FONT_SIZE, inputWidth - REPLY_INPUT_HORIZONTAL_PADDING * 2);
  const targetX = Math.max(0, locationX - REPLY_INPUT_HORIZONTAL_PADDING);
  const targetLine = Math.max(0, Math.floor((locationY - REPLY_INPUT_VERTICAL_PADDING) / REPLY_INPUT_LINE_HEIGHT));
  let currentLine = 0;
  let currentLineWidth = 0;
  let currentLineChars: { index: number; width: number }[] = [];

  const indexInCurrentLine = (endIndex: number) => {
    let cursorX = 0;
    for (const item of currentLineChars) {
      if (targetX < cursorX + item.width / 2) {
        return item.index;
      }
      cursorX += item.width;
    }
    return endIndex;
  };

  let index = 0;
  for (const char of content) {
    const nextIndex = index + char.length;
    if (char === '\n') {
      if (currentLine === targetLine) {
        return indexInCurrentLine(index);
      }
      currentLine += 1;
      currentLineWidth = 0;
      currentLineChars = [];
      index = nextIndex;
      continue;
    }

    const charWidth = estimatedReplyComposerCharWidth(char);
    if (currentLineChars.length > 0 && currentLineWidth + charWidth > contentWidth) {
      if (currentLine === targetLine) {
        return indexInCurrentLine(index);
      }
      currentLine += 1;
      currentLineWidth = 0;
      currentLineChars = [];
    }
    currentLineChars.push({ index, width: charWidth });
    currentLineWidth += charWidth;
    index = nextIndex;
  }

  if (targetLine <= currentLine) {
    return indexInCurrentLine(content.length);
  }
  return content.length;
}
