function isAsciiWhitespace(code: number) {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isAsciiAlpha(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameChar(code: number) {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 45 || code === 58;
}

function isNonAsciiAttrNameChar(code: number) {
  return code >= 0xa0 && !(code >= 0xfdd0 && code <= 0xfdef) && code !== 0xfffe && code !== 0xffff;
}

function isAttrWordChar(code: number) {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 95 || isNonAsciiAttrNameChar(code);
}

function isAttrNameStart(code: number) {
  return (
    isAsciiAlpha(code) ||
    code === 95 || // _
    code === 58 || // :
    code === 91 || // [
    code === 40 || // (
    code === 64 || // @
    code === 35 || // #
    code === 42 || // *
    code === 63 || // ?
    code === 46 || // .
    code === 36 || // $
    isNonAsciiAttrNameChar(code)
  );
}

function isAttrNameChar(code: number) {
  if (code <= 32 || (code >= 127 && code <= 159)) return false;
  if (
    code === 34 || // "
    code === 38 || // &
    code === 39 || // '
    code === 47 || // /
    code === 60 || // <
    code === 61 || // =
    code === 62 || // >
    code === 96 // `
  ) {
    return false;
  }
  return code < 0xa0 || isNonAsciiAttrNameChar(code);
}

function scanAttrNameEnd(html: string, start: number, limit: number) {
  if (start >= limit || !isAttrNameChar(html.charCodeAt(start))) return -1;
  let cursor = start;
  let hasWordChar = false;
  while (cursor < limit) {
    const code = html.charCodeAt(cursor);
    if (!isAttrNameChar(code)) break;
    if (isAttrWordChar(code)) hasWordChar = true;
    cursor += 1;
  }
  return hasWordChar ? cursor : -1;
}

function isUnquotedAttrValueChar(code: number) {
  return !isAsciiWhitespace(code) && code !== 34 && code !== 39 && code !== 60 && code !== 62 && code !== 96;
}

function isDoctypePrefix(html: string, start: number) {
  if (start + 9 >= html.length) return false;
  if (html.slice(start + 2, start + 9).toLowerCase() !== 'doctype') return false;
  const next = html.charCodeAt(start + 9);
  return next === 62 || isAsciiWhitespace(next);
}

function matchesAsciiTagName(html: string, start: number, lowerTagName: string) {
  if (start + lowerTagName.length > html.length) return false;
  for (let offset = 0; offset < lowerTagName.length; offset += 1) {
    const code = html.charCodeAt(start + offset);
    const lowered = code >= 65 && code <= 90 ? code + 32 : code;
    if (lowered !== lowerTagName.charCodeAt(offset)) return false;
  }
  return true;
}

function scanWordConditionalEnd(html: string, start: number) {
  if (start + 5 >= html.length || html.charCodeAt(start + 2) !== 91) return -1;
  if (matchesAsciiTagName(html, start + 3, 'if')) {
    const afterIf = html.charCodeAt(start + 5);
    if (!isAsciiWhitespace(afterIf) && afterIf !== 33 && afterIf !== 40 && afterIf !== 93) return -1;
    let cursor = start + 5;
    while (cursor < html.length) {
      const code = html.charCodeAt(cursor);
      if (code === 60 || code === 62) return -1;
      if (code === 93 && cursor + 1 < html.length && html.charCodeAt(cursor + 1) === 62) {
        return cursor + 2;
      }
      cursor += 1;
    }
    return -1;
  }
  let cursor = -1;
  if (matchesAsciiTagName(html, start + 3, 'endif')) {
    cursor = start + 8;
  } else if (matchesAsciiTagName(html, start + 3, 'else')) {
    cursor = start + 7;
  }
  if (cursor < 0) return -1;
  while (cursor < html.length && isAsciiWhitespace(html.charCodeAt(cursor))) cursor += 1;
  return cursor + 1 < html.length && html.charCodeAt(cursor) === 93 && html.charCodeAt(cursor + 1) === 62
    ? cursor + 2
    : -1;
}

function rawTextElementName(html: string, start: number, end: number): 'script' | 'style' | '' {
  const nameStart = start + 1;
  if (nameStart >= end || !isAsciiAlpha(html.charCodeAt(nameStart))) return '';
  if (matchesAsciiTagName(html, nameStart, 'script')) {
    const after = nameStart + 6;
    if (after < end && !isTagNameChar(html.charCodeAt(after))) return 'script';
  } else if (matchesAsciiTagName(html, nameStart, 'style')) {
    const after = nameStart + 5;
    if (after < end && !isTagNameChar(html.charCodeAt(after))) return 'style';
  }
  return '';
}

function isRawTextTagBoundary(code: number) {
  return isAsciiWhitespace(code) || code === 47 || code === 62;
}

function scanRawTextEndTagEnd(html: string, afterTagName: number) {
  // WHATWG HTML5 end-tag attribute scanner after an appropriate raw-text/script end tag name.
  // 0: BeforeAttrName / SelfClosing, 1: AttrName, 2: AfterAttrName,
  // 3: BeforeAttrValue, 4: DoubleQuoted, 5: SingleQuoted, 6: Unquoted.
  let state = 0;
  for (let cursor = afterTagName; cursor < html.length; cursor += 1) {
    const code = html.charCodeAt(cursor);
    if (state === 0) {
      if (code === 62) return cursor + 1;
      if (code !== 47 && !isAsciiWhitespace(code)) state = 1;
    } else if (state === 1) {
      if (code === 62) return cursor + 1;
      if (code === 61) state = 3;
      else if (code === 47) state = 0;
      else if (isAsciiWhitespace(code)) state = 2;
    } else if (state === 2) {
      if (code === 62) return cursor + 1;
      if (code === 61) state = 3;
      else if (code === 47) state = 0;
      else if (!isAsciiWhitespace(code)) state = 1;
    } else if (state === 3) {
      if (code === 62) return cursor + 1;
      if (code === 34) state = 4;
      else if (code === 39) state = 5;
      else if (!isAsciiWhitespace(code)) state = 6;
    } else if (state === 4) {
      if (code === 34) state = 0;
    } else if (state === 5) {
      if (code === 39) state = 0;
    } else {
      if (code === 62) return cursor + 1;
      if (isAsciiWhitespace(code)) state = 0;
    }
  }
  return -1;
}

function findStyleCloseTag(html: string, from: number): [number, number] | null {
  let cursor = from;
  while (cursor < html.length) {
    const closeStart = html.indexOf('</', cursor);
    if (closeStart < 0) return null;
    const nameStart = closeStart + 2;
    if (!matchesAsciiTagName(html, nameStart, 'style')) {
      cursor = nameStart;
      continue;
    }
    const afterName = nameStart + 5;
    if (afterName >= html.length || !isRawTextTagBoundary(html.charCodeAt(afterName))) {
      cursor = afterName;
      continue;
    }
    const end = scanRawTextEndTagEnd(html, afterName);
    return end >= 0 ? [closeStart, end] : null;
  }
  return null;
}

function findScriptCloseTag(html: string, from: number): [number, number] | null {
  // WHATWG HTML5 script data states:
  // 0: Data, 1: Escaped, 2: EscapedDash, 3: EscapedDashDash,
  // 4: DoubleEscaped, 5: DoubleEscapedDash, 6: DoubleEscapedDashDash.
  let state = 0;
  let cursor = from;
  while (cursor < html.length) {
    const code = html.charCodeAt(cursor);
    if (state === 0) {
      if (code === 60 && cursor + 1 < html.length) {
        const next = html.charCodeAt(cursor + 1);
        if (
          next === 47 &&
          matchesAsciiTagName(html, cursor + 2, 'script') &&
          cursor + 8 < html.length &&
          isRawTextTagBoundary(html.charCodeAt(cursor + 8))
        ) {
          const end = scanRawTextEndTagEnd(html, cursor + 8);
          return end >= 0 ? [cursor, end] : null;
        }
        if (
          next === 33 &&
          cursor + 3 < html.length &&
          html.charCodeAt(cursor + 2) === 45 &&
          html.charCodeAt(cursor + 3) === 45
        ) {
          state = 3;
          cursor += 4;
          continue;
        }
      }
      cursor += 1;
      continue;
    }
    if (state === 1) {
      if (code === 45) {
        state = 2;
        cursor += 1;
        continue;
      }
      if (code === 60 && cursor + 1 < html.length) {
        const next = html.charCodeAt(cursor + 1);
        if (
          next === 47 &&
          matchesAsciiTagName(html, cursor + 2, 'script') &&
          cursor + 8 < html.length &&
          isRawTextTagBoundary(html.charCodeAt(cursor + 8))
        ) {
          const end = scanRawTextEndTagEnd(html, cursor + 8);
          return end >= 0 ? [cursor, end] : null;
        }
        if (
          matchesAsciiTagName(html, cursor + 1, 'script') &&
          cursor + 7 < html.length &&
          isRawTextTagBoundary(html.charCodeAt(cursor + 7))
        ) {
          state = 4;
          cursor += 8;
          continue;
        }
      }
      cursor += 1;
      continue;
    }
    if (state === 2) {
      if (code === 45) {
        state = 3;
        cursor += 1;
      } else if (code === 60) {
        state = 1;
      } else {
        state = 1;
        cursor += 1;
      }
      continue;
    }
    if (state === 3) {
      if (code === 45) {
        cursor += 1;
      } else if (code === 62) {
        state = 0;
        cursor += 1;
      } else if (code === 60) {
        state = 1;
      } else {
        state = 1;
        cursor += 1;
      }
      continue;
    }
    if (state === 4) {
      if (code === 45) {
        state = 5;
        cursor += 1;
        continue;
      }
      if (
        code === 60 &&
        cursor + 1 < html.length &&
        html.charCodeAt(cursor + 1) === 47 &&
        matchesAsciiTagName(html, cursor + 2, 'script') &&
        cursor + 8 < html.length &&
        isRawTextTagBoundary(html.charCodeAt(cursor + 8))
      ) {
        state = 1;
        cursor += 9;
        continue;
      }
      cursor += 1;
      continue;
    }
    if (state === 5) {
      if (code === 45) {
        state = 6;
        cursor += 1;
      } else if (code === 60) {
        state = 4;
      } else {
        state = 4;
        cursor += 1;
      }
      continue;
    }
    if (code === 45) {
      cursor += 1;
    } else if (code === 62) {
      state = 0;
      cursor += 1;
    } else if (code === 60) {
      state = 4;
    } else {
      state = 4;
      cursor += 1;
    }
  }
  return null;
}

export function transformHtmlSegments(
  html: string,
  transformText: (text: string) => string,
  transformTag: (tag: string, trailingUnquotedValueStart?: number) => string,
  transformRawText: (rawText: string) => string = transformText
) {
  let output = '';
  let textStart = 0;
  let index = 0;
  let nextCommentClose = -2;
  let trailingUnquotedValueStart: number | undefined;
  let failedAttrStarts: Uint8Array | undefined;
  let failedDoctypeStarts: Uint8Array | undefined;
  const visitedAttrStarts: number[] = [];
  const visitedDoctypeStarts: number[] = [];

  const scanDoctypeEnd = (start: number) => {
    let cursor = start + 9;
    if (failedDoctypeStarts?.[cursor]) return -1;
    visitedDoctypeStarts.length = 0;
    visitedDoctypeStarts.push(cursor);
    let sawQuote = false;
    const markFailed = () => {
      if (!sawQuote && visitedDoctypeStarts.length <= 1) return;
      failedDoctypeStarts ??= new Uint8Array(html.length + 1);
      for (const offset of visitedDoctypeStarts) failedDoctypeStarts[offset] = 1;
    };
    while (cursor < html.length) {
      if (failedDoctypeStarts?.[cursor]) {
        markFailed();
        return -1;
      }
      const code = html.charCodeAt(cursor);
      if (code === 62) return cursor + 1;
      if (code === 60) {
        markFailed();
        return -1;
      }
      if (code === 34 || code === 39) {
        visitedDoctypeStarts.push(cursor);
        sawQuote = true;
        const closeQuote = html.indexOf(code === 34 ? '"' : "'", cursor + 1);
        if (closeQuote < 0) {
          markFailed();
          return -1;
        }
        cursor = closeQuote + 1;
        continue;
      }
      cursor += 1;
    }
    markFailed();
    return -1;
  };

  const scanOpenTagEnd = (start: number) => {
    let cursor = start + 2;
    while (cursor < html.length && isTagNameChar(html.charCodeAt(cursor))) cursor += 1;
    if (cursor >= html.length) return -1;
    const afterName = html.charCodeAt(cursor);
    if (afterName === 62) return cursor + 1;
    if (afterName === 47) {
      return cursor + 1 < html.length && html.charCodeAt(cursor + 1) === 62 ? cursor + 2 : -1;
    }
    if (!isAsciiWhitespace(afterName)) return -1;

    let attrCount = 0;
    let sawQuote = false;
    visitedAttrStarts.length = 0;
    const markFailed = (persist: boolean) => {
      if (!persist) return;
      failedAttrStarts ??= new Uint8Array(html.length + 1);
      for (const offset of visitedAttrStarts) failedAttrStarts[offset] = 1;
    };

    while (true) {
      while (cursor < html.length && isAsciiWhitespace(html.charCodeAt(cursor))) cursor += 1;
      if (cursor >= html.length) {
        markFailed(attrCount > 0 || sawQuote);
        return -1;
      }
      const code = html.charCodeAt(cursor);
      if (code === 62) return cursor + 1;
      if (code === 47) {
        if (cursor + 1 < html.length && html.charCodeAt(cursor + 1) === 62) return cursor + 2;
        markFailed(attrCount > 0 || sawQuote);
        return -1;
      }
      if (failedAttrStarts?.[cursor]) {
        markFailed(true);
        return -1;
      }
      const nameEnd = scanAttrNameEnd(html, cursor, html.length);
      if (nameEnd < 0) {
        markFailed(attrCount > 0 || sawQuote);
        return -1;
      }
      const requiresValue = !isAttrNameStart(code);
      visitedAttrStarts.push(cursor);
      cursor = nameEnd;
      while (cursor < html.length && isAsciiWhitespace(html.charCodeAt(cursor))) cursor += 1;
      if (cursor < html.length && html.charCodeAt(cursor) === 61) {
        cursor += 1;
        while (cursor < html.length && isAsciiWhitespace(html.charCodeAt(cursor))) cursor += 1;
        if (cursor >= html.length) {
          markFailed(true);
          return -1;
        }
        const valueStart = html.charCodeAt(cursor);
        if (valueStart === 34 || valueStart === 39) {
          sawQuote = true;
          const closeQuote = html.indexOf(valueStart === 34 ? '"' : "'", cursor + 1);
          if (closeQuote < 0) {
            markFailed(true);
            return -1;
          }
          cursor = closeQuote + 1;
        } else {
          const unquotedStart = cursor;
          while (cursor < html.length && isUnquotedAttrValueChar(html.charCodeAt(cursor))) cursor += 1;
          if (cursor === unquotedStart) {
            markFailed(attrCount > 0 || sawQuote);
            return -1;
          }
          if (cursor < html.length && !isAsciiWhitespace(html.charCodeAt(cursor)) && html.charCodeAt(cursor) !== 62) {
            markFailed(attrCount > 0 || sawQuote);
            return -1;
          }
          if (html.charCodeAt(cursor) === 62 && html.charCodeAt(cursor - 1) === 47) {
            trailingUnquotedValueStart = unquotedStart - start;
          }
        }
        attrCount += 1;
        continue;
      }
      if (
        requiresValue ||
        (cursor === nameEnd &&
          (cursor >= html.length ||
            (html.charCodeAt(cursor) !== 62 &&
              !(html.charCodeAt(cursor) === 47 && html.charCodeAt(cursor + 1) === 62))))
      ) {
        markFailed(attrCount > 0 || sawQuote);
        return -1;
      }
      attrCount += 1;
    }
  };

  const scanTagEnd = (start: number) => {
    if (start + 1 >= html.length) return -1;
    const first = html.charCodeAt(start + 1);
    if (first === 33) {
      if (html.startsWith('<!--', start)) {
        if (nextCommentClose === -1) return -1;
        if (nextCommentClose < start + 4) {
          nextCommentClose = html.indexOf('-->', start + 4);
          if (nextCommentClose < 0) return -1;
        }
        return nextCommentClose + 3;
      }
      if (start + 2 < html.length && html.charCodeAt(start + 2) === 91) {
        return scanWordConditionalEnd(html, start);
      }
      return isDoctypePrefix(html, start) ? scanDoctypeEnd(start) : -1;
    }
    if (first === 47) {
      if (start + 2 >= html.length || !isAsciiAlpha(html.charCodeAt(start + 2))) return -1;
      let cursor = start + 3;
      while (cursor < html.length && isTagNameChar(html.charCodeAt(cursor))) cursor += 1;
      while (cursor < html.length && isAsciiWhitespace(html.charCodeAt(cursor))) cursor += 1;
      return cursor < html.length && html.charCodeAt(cursor) === 62 ? cursor + 1 : -1;
    }
    return isAsciiAlpha(first) ? scanOpenTagEnd(start) : -1;
  };

  while (index < html.length) {
    const openIndex = html.indexOf('<', index);
    if (openIndex < 0) break;
    trailingUnquotedValueStart = undefined;
    const tagEnd = scanTagEnd(openIndex);
    if (tagEnd < 0) {
      index = openIndex + 1;
      continue;
    }
    output += transformText(html.slice(textStart, openIndex));
    output += transformTag(html.slice(openIndex, tagEnd), trailingUnquotedValueStart);
    index = tagEnd;
    textStart = tagEnd;
    const rawTextTag = rawTextElementName(html, openIndex, tagEnd);
    if (rawTextTag) {
      const closeTag = rawTextTag === 'script' ? findScriptCloseTag(html, index) : findStyleCloseTag(html, index);
      if (!closeTag) {
        return output + transformRawText(html.slice(textStart));
      }
      const [closeStart, closeEnd] = closeTag;
      output += transformRawText(html.slice(textStart, closeStart));
      output += transformTag(html.slice(closeStart, closeEnd));
      index = closeEnd;
      textStart = closeEnd;
    }
  }
  return output + transformText(html.slice(textStart));
}

export function htmlTagAttribute(tag: string, name: string): string | undefined {
  const target = name.toLowerCase();
  if (tag.length < 4 || tag.charCodeAt(0) !== 60 || !isAsciiAlpha(tag.charCodeAt(1))) {
    return undefined;
  }
  let index = 2;
  while (index < tag.length && isTagNameChar(tag.charCodeAt(index))) index += 1;
  while (index < tag.length) {
    while (index < tag.length && isAsciiWhitespace(tag.charCodeAt(index))) index += 1;
    if (index >= tag.length) return undefined;
    const code = tag.charCodeAt(index);
    if (code === 62 || code === 47) return undefined;
    const nameStart = index;
    const nameEnd = scanAttrNameEnd(tag, nameStart, tag.length);
    if (nameEnd < 0) return undefined;
    const requiresValue = !isAttrNameStart(code);
    const attrName = tag.slice(nameStart, nameEnd).toLowerCase();
    index = nameEnd;
    while (index < tag.length && isAsciiWhitespace(tag.charCodeAt(index))) index += 1;
    let value = '';
    if (index < tag.length && tag.charCodeAt(index) === 61) {
      index += 1;
      while (index < tag.length && isAsciiWhitespace(tag.charCodeAt(index))) index += 1;
      if (index >= tag.length) return undefined;
      const quote = tag.charCodeAt(index);
      if (quote === 34 || quote === 39) {
        const closeQuote = tag.indexOf(quote === 34 ? '"' : "'", index + 1);
        if (closeQuote < 0) return undefined;
        value = tag.slice(index + 1, closeQuote);
        index = closeQuote + 1;
      } else {
        const valueStart = index;
        while (index < tag.length && isUnquotedAttrValueChar(tag.charCodeAt(index))) index += 1;
        value = tag.slice(valueStart, index);
      }
    } else if (requiresValue) {
      return undefined;
    }
    if (attrName === target) return value;
  }
  return undefined;
}
