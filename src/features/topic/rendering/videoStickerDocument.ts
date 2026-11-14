import { escapeHtmlAttribute } from '@/domain/forum/html';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';

export const VIDEO_STICKER_READY_MESSAGE = 'wz-video-sticker-ready';
export const VIDEO_STICKER_ERROR_MESSAGE = 'wz-video-sticker-error';
export const VIDEO_STICKER_PROGRESS_MESSAGE = 'wz-video-sticker-progress';

export function videoStickerBrowserHtml(src: string, origin: string, referrerPolicy: MediaReferrerPolicy) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="${referrerPolicy}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${escapeHtmlAttribute(origin)}; style-src 'unsafe-inline'; script-src 'nonce-wz-video-sticker'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; object-src 'none'; worker-src 'none'">
<style>
html, body, video { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
video { display: block; object-fit: contain; }
</style>
</head>
<body>
<video autoplay loop muted playsinline webkit-playsinline disablepictureinpicture src="${escapeHtmlAttribute(src)}"></video>
<script nonce="wz-video-sticker">
(() => {
  const video = document.querySelector('video');
  let settled = false;
  let lastBufferedEnd = -1;
  const post = (message) => window.ReactNativeWebView.postMessage(message);
  const play = () => video.play().catch(() => {});
  const progress = () => {
    if (settled) return;
    let bufferedEnd = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      bufferedEnd = Math.max(bufferedEnd, video.buffered.end(index));
    }
    if (!Number.isFinite(bufferedEnd) || bufferedEnd <= lastBufferedEnd) return;
    lastBufferedEnd = bufferedEnd;
    post('${VIDEO_STICKER_PROGRESS_MESSAGE}:' + String(1 + bufferedEnd));
  };
  const ready = () => {
    if (settled) return;
    settled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => post('${VIDEO_STICKER_READY_MESSAGE}')));
  };
  video.addEventListener('progress', progress);
  video.addEventListener('loadedmetadata', progress, { once: true });
  video.addEventListener('loadeddata', ready, { once: true });
  video.addEventListener('error', () => post('${VIDEO_STICKER_ERROR_MESSAGE}'), { once: true });
  document.addEventListener('visibilitychange', () => document.hidden ? video.pause() : play());
  if (video.readyState >= 2) ready();
  play();
})();
</script>
</body>
</html>`;
}
