import { describe, expect, it } from 'vitest';
import type { NotificationDetail } from '@/domain/notifications/models';
import { prepareImagePreviewCatalog, projectImagePreviewCatalog } from '@/platform/media/imagePreviewCatalog';
import { notificationImagePreviewDescriptors } from './notificationImagePreview';

const detail: NotificationDetail = {
  notification: {
    source: 'linuxdo',
    id: 'pm:201',
    kind: 'private-message',
    actor: { name: 'Bob' },
    title: '私信',
    createdAt: null,
    unread: false,
    target: { type: 'private-conversation', conversationId: '201' }
  },
  title: '私信',
  contentHtml:
    '<a class="lightbox" href="/uploads/original.png"><img src="/uploads/thumb.png" referrerpolicy="no-referrer"></a>',
  messages: [
    {
      id: 'first',
      author: 'Bob',
      createdAt: null,
      contentHtml:
        '<img src="/uploads/original.png" referrerpolicy="no-referrer"><forum-sticker src="/uploads/sticker.png" width="64" height="64"></forum-sticker><img class="emoji" src="/images/emoji/smile.png" width="20" height="20">'
    },
    {
      id: 'second',
      author: 'Bob',
      createdAt: null,
      contentHtml:
        '<img class="sticker" src="data:image/png;base64,aW1hZ2U=" width="64" height="64"><img src="javascript:alert(1)">'
    }
  ]
};

describe('notification image preview descriptors', () => {
  it('preserves visible image order, lightbox originals, relative URLs and referrer policy while excluding emoji', () => {
    const descriptors = notificationImagePreviewDescriptors(detail, 'https://linux.do/t/201');
    expect(descriptors[0]).toMatchObject({
      source: 'https://linux.do/uploads/thumb.png',
      lightboxOriginal: 'https://linux.do/uploads/original.png',
      referrerPolicy: 'no-referrer'
    });
    expect(descriptors.map((item) => item.source)).toEqual([
      'https://linux.do/uploads/thumb.png',
      'https://linux.do/uploads/original.png',
      'https://linux.do/uploads/sticker.png',
      'data:image/png;base64,aW1hZ2U=',
      'javascript:alert(1)'
    ]);
    const catalog = projectImagePreviewCatalog(prepareImagePreviewCatalog(descriptors, 360, 1), {
      contentSource: 'linuxdo',
      sessionIdentity: 'linuxdo:7',
      referrer: { documentUrl: 'https://linux.do/t/201' }
    });
    expect(catalog.items.map((item) => item.originalUri)).toEqual([
      'https://linux.do/uploads/original.png',
      'https://linux.do/uploads/sticker.png',
      'data:image/png;base64,aW1hZ2U='
    ]);
  });
});
