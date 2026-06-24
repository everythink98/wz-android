import { describe, expect, it } from 'vitest';

import { decodeHtml, sanitizeContentHtml, textContentFromHtml } from './localHtml';

describe('Android local HTML helpers', () => {
  it('extracts visible text without script or style contents', () => {
    expect(textContentFromHtml('<style>.x{color:red}</style><p>A&nbsp;B<br>C</p><script>alert(1)</script>')).toBe('A B C');
  });

  it('removes unsafe link and media protocols from sanitized content', () => {
    const result = sanitizeContentHtml(`
      <a href="javascript:alert(1)">js</a>
      <a href="data:text/html,<script>alert(1)</script>">data</a>
      <a href="vbscript:msgbox(1)">vb</a>
      <img src="data:text/html,hello">
      <img src="vbscript:msgbox(1)">
    `, 'https://example.com/base/');

    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('data:text/html');
    expect(result).not.toContain('vbscript:');
    expect(result).not.toContain('href=');
    expect(result).not.toContain('src=');
  });

  it('keeps allowed sanitized links and converts relative URLs', () => {
    const result = sanitizeContentHtml(`
      <a href="/topic/1">topic</a>
      <a href="mailto:user@example.com">mail</a>
      <img src="images/a.png">
      <img src="//cdn.example.com/a.png">
    `, 'https://example.com/base/');

    expect(result).toContain('href="https://example.com/topic/1"');
    expect(result).toContain('href="mailto:user@example.com"');
    expect(result).toContain('src="https://example.com/base/images/a.png"');
    expect(result).toContain('src="https://cdn.example.com/a.png"');
  });

  it('keeps Bilibili player iframes while sanitizing their attributes', () => {
    const result = sanitizeContentHtml(`
      <iframe
        src="//player.bilibili.com/player.html?isOutside=true&bvid=BV1GUdgBdESz&p=1"
        onload="alert(1)"
        style="width:100%"
        allowfullscreen="true"
      ></iframe>
    `, 'https://www.nodeseek.com/post-1-1');

    expect(result).toContain('<iframe');
    expect(result).toContain('src="https://player.bilibili.com/player.html?isOutside=true&bvid=BV1GUdgBdESz&p=1"');
    expect(result).not.toContain('onload=');
    expect(result).not.toContain('style=');
  });

  it('keeps safe source text color while removing other inline styles', () => {
    const result = sanitizeContentHtml(`
      <p style="color: #e00; background: #fff; border-color: red" onclick="alert(1)">red</p>
      <span style="color: rgb(1, 2, 3)">rgb</span>
      <strong style="color: rebeccapurple">keyword</strong>
      <em style="color: url(javascript:alert(1)); font-weight: bold">bad</em>
      <i style="color: not-a-color">invalid</i>
    `, 'https://example.com/base/');

    expect(result).toContain('style="color: #e00"');
    expect(result).toContain('style="color: rgb(1, 2, 3)"');
    expect(result).toContain('style="color: rebeccapurple"');
    expect(result).not.toContain('background');
    expect(result).not.toContain('border-color');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('font-weight');
    expect(result).not.toContain('not-a-color');
  });

  it('turns Bilibili video image syntax output into a player iframe', () => {
    const result = sanitizeContentHtml(`
      <p><img src="https://www.bilibili.com/video/BV1GUdgBdESz/?p=2" alt="image"></p>
    `, 'https://www.nodeseek.com/post-1-1');

    expect(result).toContain('<iframe');
    expect(result).toContain('src="https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz&p=2"');
    expect(result).not.toContain('<img');
  });

  it('turns untrusted iframes into openable link blocks instead of inline playback', () => {
    const result = sanitizeContentHtml(`
      <iframe src="https://www.youtube.com/embed/demo" onload="alert(1)"></iframe>
    `, 'https://www.nodeseek.com/post-1-1');

    expect(result).not.toContain('<iframe');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://www.youtube.com/embed/demo"');
    expect(result).toContain('嵌入内容 · www.youtube.com');
    expect(result).not.toContain('onload=');
  });

  it('keeps data image sources without allowing data links or non-image data media', () => {
    const result = sanitizeContentHtml(`
      <a href="data:image/png;base64,abc123">image link</a>
      <img src="data:image/png;base64,abc123">
      <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">
      <img src="data:text/html,hello">
    `, 'https://example.com/base/');

    expect(result).toContain('src="data:image/png;base64,abc123"');
    expect(result).not.toContain('data:image/svg+xml');
    expect(result).not.toContain('href=');
    expect(result).not.toContain('data:text/html');
  });

  it('removes forum image dimension and file size metadata', () => {
    const result = sanitizeContentHtml(`
      <p>
        <a class="lightbox" href="/uploads/default/original/1x/asset-123.png">
          <img src="/uploads/default/original/1x/asset-123.png" alt="photo">
          <div class="meta">
            <span class="filename">camera-shot.png</span>
            <span class="informations">1920×1080 210 KB</span>
          </div>
        </a>
      </p>
    `, 'https://linux.do');

    expect(result).toContain('<img');
    expect(result).not.toContain('camera-shot.png');
    expect(result).not.toContain('1920×1080');
    expect(result).not.toContain('210 KB');
  });

  it('keeps ordinary metadata text that is not image file metadata', () => {
    const result = sanitizeContentHtml('<div class="meta">附件大小 210 KB</div>', 'https://linux.do');

    expect(result).toContain('附件大小 210 KB');
  });

  it('removes classless image metadata text from forum image links', () => {
    const result = sanitizeContentHtml(`
      <a href="/uploads/default/original/1x/asset-123.png">
        <img src="/uploads/default/original/1x/asset-123.png" alt="photo">
        <div>图片1468×946 116 KB</div>
      </a>
    `, 'https://linux.do');

    expect(result).toContain('<img');
    expect(result).not.toContain('图片1468×946 116 KB');
  });

  it('keeps image wrappers while removing their metadata text', () => {
    const result = sanitizeContentHtml(`
      <div>
        <a href="/uploads/default/original/1x/asset-123.png">
          <img src="/uploads/default/original/1x/asset-123.png" alt="photo">
          <div>图片1468×946 116 KB</div>
        </a>
      </div>
    `, 'https://linux.do');

    expect(result).toContain('<img');
    expect(result).not.toContain('图片1468×946 116 KB');
  });

  it('removes image metadata text that uses the original image label', () => {
    const result = sanitizeContentHtml(`
      <a href="/uploads/default/original/1x/asset-123.png">
        <img src="/uploads/default/original/1x/asset-123.png" alt="image">
        <div>image1244×152 8.4 KB</div>
      </a>
    `, 'https://linux.do');

    expect(result).toContain('<img');
    expect(result).not.toContain('image1244×152 8.4 KB');
  });

  it('decodes apostrophe entities', () => {
    expect(decodeHtml('A&apos;B')).toBe("A'B");
  });
});
