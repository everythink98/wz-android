import { describe, expect, it } from 'vitest';
import { parseHtml } from './html';
import { sanitizeContentHtml } from './contentSanitizer';

describe('forum content sanitizer media referrer policy', () => {
  it('[REG-TOPIC-078] preserves valid policies through every media tag conversion', () => {
    const html = sanitizeContentHtml(
      `
        <img id="plain" src="https://cdn.example/plain.png" referrerpolicy="no-referrer">
        <img id="invalid" src="https://cdn.example/invalid.png" referrerpolicy="not-a-policy">
        <img id="comma-list" src="https://cdn.example/comma.png" referrerpolicy="no-referrer,unsafe-url">
        <video src="https://cdn.example/video.mp4" poster="https://cdn.example/poster.jpg" referrerpolicy="same-origin"></video>
        <video class="sticker" referrerpolicy="origin">
          <source src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm">
        </video>
        <aside class="onebox" data-onebox-src="https://example.com/card">
          <header><a href="https://example.com/card">Example</a></header>
          <h3><a href="https://example.com/card">Card title</a></h3>
          <img class="site-icon" src="https://cdn.example/icon.png" referrerpolicy="origin">
          <img class="thumbnail" src="https://cdn.example/card.png" referrerpolicy="no-referrer">
        </aside>
      `,
      'https://www.nodeseek.com/post-1-1'
    );
    const root = parseHtml(html);

    expect(root.querySelector('#plain')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(root.querySelector('#invalid')?.getAttribute('referrerpolicy')).toBeUndefined();
    expect(root.querySelector('#comma-list')?.getAttribute('referrerpolicy')).toBeUndefined();
    expect(root.querySelector('forum-video')?.getAttribute('poster')).toBe('https://cdn.example/poster.jpg');
    expect(root.querySelector('forum-video')?.getAttribute('referrerpolicy')).toBe('same-origin');
    expect(root.querySelector('forum-video-sticker')?.getAttribute('referrerpolicy')).toBe('origin');
    expect(root.querySelector('forum-link-card')?.getAttribute('icon-referrerpolicy')).toBe('origin');
    expect(root.querySelector('forum-link-card')?.getAttribute('image-referrerpolicy')).toBe('no-referrer');
  });

  it('[REG-TOPIC-082] removes an unsafe video poster without removing the playable source', () => {
    const html = sanitizeContentHtml(
      '<video src="https://cdn.example/video.mp4" poster="javascript:alert(1)"></video>',
      'https://www.yaohuo.me/bbs-1571173.html?lpage=11'
    );
    const video = parseHtml(html).querySelector('forum-video');

    expect(video?.getAttribute('src')).toBe('https://cdn.example/video.mp4');
    expect(video?.getAttribute('poster')).toBeUndefined();
  });

  it('[REG-TOPIC-078] normalizes mixed-case policy attributes before media conversion', () => {
    const html = sanitizeContentHtml(
      [
        '<img id="mixed-case-image" src="https://cdn.example/mixed-case.png" ReFeRrErPoLiCy="no-referrer">',
        '<video src="https://cdn.example/mixed-case.mp4" ReFeRrErPoLiCy="no-referrer"></video>'
      ].join(''),
      'https://www.nodeseek.com/post-1-1'
    );
    const root = parseHtml(html);

    expect(root.querySelector('#mixed-case-image')?.attributes).toHaveProperty('referrerpolicy', 'no-referrer');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toContain('ReFeRrErPoLiCy');
  });

  it('[REG-TOPIC-081] removes hidden placeholders before sanitizing their inline style', () => {
    const html = sanitizeContentHtml(
      [
        '<p>visible before</p>',
        '<div hidden>hidden attribute content</div>',
        '<div style="color: red; DISPLAY: none !important">hidden display content</div>',
        '<p style="color: blue">visible after</p>'
      ].join(''),
      'https://www.yaohuo.me/bbs-1540797.html'
    );

    expect(html).toContain('visible before');
    expect(html).toContain('visible after');
    expect(html).not.toContain('hidden attribute content');
    expect(html).not.toContain('hidden display content');
  });
});
