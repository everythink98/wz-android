import type { HTMLElement } from 'node-html-parser';
import { accessRequirementFromNoticeText } from '@/domain/forum/accessRequirements';
import { sanitizeContentHtmlWithRoot } from '@/domain/forum/contentSanitizer';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  isInlineForumImage,
  knownForumStickerSourceDimensions,
  normalizeForumContentMediaNodes,
  ORIGINAL_IMAGE_SOURCE_ATTR
} from '@/domain/forum/forumContentMedia';
import { absoluteUrl, escapeHtmlAttribute, escapeHtmlText, textContentFromHtml } from '@/domain/forum/html';
import type { TopicDetail, TopicPoll } from '@/domain/forum/models';
import { selectImageOriginalSource } from '@/platform/media/imagePreviewCatalog';

const MAX_CONTENT_LENGTH = 150_000;
const IMAGE_TAGS = new Set(['img', INLINE_FORUM_IMAGE_TAG, FORUM_STICKER_TAG]);
const MEDIA_LAYOUT_TAGS = new Set([FORUM_STICKER_ROW_TAG, FORUM_INLINE_MEDIA_LINE_TAG]);

function assertContentSize(html: string) {
  if (html.length > MAX_CONTENT_LENGTH) throw new Error('正文过长，无法生成完整分享图片，请分享链接。');
}

function smallImageDimensions(attributes: Record<string, string>) {
  const dimension = (value = '') => {
    if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(value.trim())) return undefined;
    const number = Number.parseFloat(value);
    return number > 0 && number <= 256 ? number : undefined;
  };
  const known = knownForumStickerSourceDimensions(attributes);
  const width = dimension(attributes.width) || known?.width;
  const height = dimension(attributes.height) || known?.height;
  return {
    width: width || (!height && isInlineForumImage(attributes) ? 24 : undefined),
    height
  };
}

function imageHtml(src: string, alt = '', referrerPolicy = '', dimensions?: ReturnType<typeof smallImageDimensions>) {
  return src
    ? `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" referrerpolicy="${escapeHtmlAttribute(referrerPolicy)}"${dimensions?.width ? ` width="${dimensions.width}"` : ''}${dimensions?.height ? ` height="${dimensions.height}"` : ''}>`
    : '';
}

function linkedNotice(label: string, url: string) {
  return `<p>${escapeHtmlText(label)}${url ? ` · <a href="${escapeHtmlAttribute(url)}">${escapeHtmlText(url)}</a>` : '，请在原站查看'}</p>`;
}

function pollHtml(poll: TopicPoll) {
  return `<section><p><strong>${escapeHtmlText(poll.title || '投票')}</strong></p><ul>${poll.options
    .map((option) => `<li>${escapeHtmlText(option.label)}</li>`)
    .join('')}</ul></section>`;
}

export function prepareTopicShareContent(topic: TopicDetail): { html: string; imageCount: number } {
  assertContentSize(topic.contentHtml);
  const originalText = textContentFromHtml(topic.contentHtml);
  if (topic.accessRequirement && (!originalText || accessRequirementFromNoticeText(originalText))) {
    throw new Error('当前没有权限读取正文，无法生成分享图片。');
  }
  if (!topic.contentHtml.trim()) throw new Error('正文尚未加载，无法生成分享图片。');

  const { root } = sanitizeContentHtmlWithRoot(topic.contentHtml, topic.url, (content) => {
    // Keep safe embeds as visible references before the reading sanitizer removes unsupported players.
    for (const frame of content.querySelectorAll('iframe')) {
      frame.replaceWith(
        `<forum-share-embed href="${escapeHtmlAttribute(frame.getAttribute('src') || '')}"></forum-share-embed>`
      );
    }
    for (const image of content.querySelectorAll('img, forum-inline-image, forum-sticker')) {
      if (image.rawTagName.toLowerCase() !== 'img') {
        if (!image.getAttribute('alt') && image.textContent) image.setAttribute('alt', image.textContent);
        image.set_content('');
      }
      for (const name of ['data-src', 'data-original', 'data-forum-original-src']) {
        const value = absoluteUrl(image.getAttribute(name), topic.url);
        if (value) image.setAttribute(name, value);
      }
    }
    for (const font of content.querySelectorAll('font[color]')) {
      font.setAttribute('style', `color: ${font.getAttribute('color')}; ${font.getAttribute('style') || ''}`);
    }
  });
  const canonicalImageSources = new Map<HTMLElement, string>();
  for (const image of root.querySelectorAll('img, forum-inline-image, forum-sticker')) {
    const source = selectImageOriginalSource({
      [ORIGINAL_IMAGE_SOURCE_ATTR]: image.getAttribute(ORIGINAL_IMAGE_SOURCE_ATTR)
    });
    if (source) canonicalImageSources.set(image, source);
  }
  normalizeForumContentMediaNodes(root);
  const includedPolls = new Set<TopicPoll>();
  for (const node of root.querySelectorAll('*').reverse()) {
    const tag = node.rawTagName.toLowerCase();
    const attribute = (name: string) => node.getAttribute(name) || '';
    if (tag === 'forum-link-card') {
      node.replaceWith(
        `<section><p><strong>${escapeHtmlText(attribute('title') || attribute('site'))}</strong></p>` +
          `<p>${escapeHtmlText(attribute('description'))}</p>` +
          imageHtml(attribute('image-src'), attribute('title'), attribute('image-referrerpolicy')) +
          linkedNotice(attribute('site') || '链接', attribute('href')) +
          '</section>'
      );
    } else if (
      tag === 'forum-audio' ||
      tag === 'forum-video' ||
      tag === 'forum-video-sticker' ||
      tag === 'iframe' ||
      tag === 'forum-share-embed'
    ) {
      const label =
        tag === 'forum-audio' ? '音频' : tag === 'iframe' || tag === 'forum-share-embed' ? '嵌入内容' : '视频';
      node.replaceWith(
        imageHtml(
          attribute('poster') || attribute('data-fallback-src'),
          attribute('alt'),
          attribute('referrerpolicy'),
          smallImageDimensions(node.attributes)
        ) +
          linkedNotice(label, tag === 'forum-share-embed' ? attribute('href') : attribute('src')) +
          (tag === 'forum-audio' ? node.innerHTML : '')
      );
    } else if (tag === 'forum-discourse-poll' || tag === 'forum-nodeseek-poll') {
      const poll = topic.polls?.find((candidate) =>
        tag === 'forum-nodeseek-poll'
          ? Boolean(attribute('id')) && candidate.id === attribute('id')
          : Boolean(attribute('name')) && candidate.name === attribute('name')
      );
      if (poll) includedPolls.add(poll);
      node.replaceWith(poll ? pollHtml(poll) : linkedNotice('投票', ''));
    } else if (tag === 'forum-math-block' || tag === 'forum-math-inline') {
      node.tagName = tag === 'forum-math-block' ? 'pre' : 'code';
    } else if (tag === 'forum-terminal-tab') {
      node.replaceWith(
        `<section><p><strong>${escapeHtmlText(attribute('title'))}</strong></p>${node.innerHTML}</section>`
      );
    } else if (node.classList.contains('forum-terminal-code')) {
      node.tagName = 'pre';
    } else if (tag === 'forum-reply-reference') {
      node.replaceWith(
        `<span>${escapeHtmlText([attribute('data-mention'), attribute('data-floor')].filter(Boolean).join(' '))}</span>`
      );
    } else if (tag === 'forum-nodeseek-stardust') {
      node.replaceWith(
        `<span>星尘支付${attribute('amount') ? ` · ${escapeHtmlText(attribute('amount'))} 星尘` : ''}，请在原站查看</span>`
      );
    } else if (tag === 'summary') {
      node.tagName = 'p';
    } else if (tag === 'details' || (tag.startsWith('forum-') && !IMAGE_TAGS.has(tag) && !MEDIA_LAYOUT_TAGS.has(tag))) {
      node.tagName = 'div';
    }
  }
  for (const poll of topic.polls || []) {
    if (!includedPolls.has(poll)) root.insertAdjacentHTML('beforeend', pollHtml(poll));
  }

  let imageCount = 0;
  for (const node of root.querySelectorAll('*')) {
    const tag = node.rawTagName.toLowerCase();
    const isImage = IMAGE_TAGS.has(tag);
    const dimensions = isImage ? smallImageDimensions(node.attributes) : undefined;
    if (isImage) {
      const canonicalSource = canonicalImageSources.get(node);
      if (canonicalSource) node.setAttribute(ORIGINAL_IMAGE_SOURCE_ATTR, canonicalSource);
      const source = selectImageOriginalSource(node.attributes);
      if (source) node.setAttribute('src', source);
      if (!node.getAttribute('alt') && node.textContent) node.setAttribute('alt', node.textContent);
      node.set_content('');
      if (tag === 'img' && isInlineForumImage(node.attributes)) node.tagName = INLINE_FORUM_IMAGE_TAG;
    }
    const allowedAttributes = [
      'style',
      'class',
      ...(isImage
        ? ['src', 'alt', 'referrerpolicy']
        : tag === 'a'
          ? ['href']
          : tag === 'td' || tag === 'th'
            ? ['colspan', 'rowspan']
            : tag === 'ol'
              ? ['start', 'reversed', 'type']
              : tag === 'li'
                ? ['value']
                : tag === 'font' && /^[1-7]$/.test(node.getAttribute('size') || '')
                  ? ['size']
                  : [])
    ];
    for (const name of Object.keys(node.attributes)) {
      if (!allowedAttributes.includes(name.toLowerCase())) node.removeAttribute(name);
    }
    if (isImage) {
      if (node.getAttribute('src')) {
        node.setAttribute('data-share-image-index', String(imageCount++));
        if (dimensions?.width) node.setAttribute('data-share-width', String(dimensions.width));
        if (dimensions?.height) node.setAttribute('data-share-height', String(dimensions.height));
      } else node.replaceWith(`<span>${escapeHtmlText(node.getAttribute('alt') || '图片地址无效')}</span>`);
    }
  }
  const html = root.toString();
  assertContentSize(html);
  if (!imageCount && !textContentFromHtml(html)) throw new Error('正文没有可分享的文字或图片。');
  return { html, imageCount };
}
