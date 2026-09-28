// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TopicDraft } from '@/domain/forum/topicComposer';
import {
  persistTopicDraftAttachment,
  removeTopicDraftAttachmentFile,
  verifyTopicDraftAttachments
} from './topicDraftAttachments';

const harness = vi.hoisted(() => ({ directory: '', failCopy: false, saved: null as TopicDraft | null }));
vi.mock('@/platform/persistence/topicDrafts', () => ({ loadTopicDraft: async () => harness.saved }));
vi.mock('expo-file-system', async () => {
  const fs = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  type Part = string | { uri: string };
  const uriFor = (parts: Part[]) => {
    const [root, ...names] = parts.map((part) => (typeof part === 'string' ? part : part.uri));
    return pathToFileURL(join(fileURLToPath(root), ...names)).href;
  };
  class Directory {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = uriFor(parts) + '/';
    }
    create() {
      fs.mkdirSync(fileURLToPath(this.uri), { recursive: true });
    }
  }
  class File {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = uriFor(parts);
    }
    get exists() {
      return fs.existsSync(fileURLToPath(this.uri));
    }
    get size() {
      return fs.statSync(fileURLToPath(this.uri)).size;
    }
    copy(target: File) {
      if (harness.failCopy) {
        fs.writeFileSync(fileURLToPath(target.uri), 'partial');
        throw new Error('disk full');
      }
      fs.copyFileSync(fileURLToPath(this.uri), fileURLToPath(target.uri));
    }
    delete() {
      fs.unlinkSync(fileURLToPath(this.uri));
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return pathToFileURL(harness.directory).href + '/';
      }
    }
  };
});

const draft: TopicDraft = {
  id: 'draft-one',
  source: 'nodeseek',
  identityKey: 'nodeseek:42',
  revision: 1,
  updatedAt: 1,
  title: '测试',
  body: '正文保持原样',
  mode: 'source',
  categoryId: 'daily',
  rank: 0,
  attachments: [],
  pendingNodeSeekPolls: []
};
const asset = () => {
  const path = join(harness.directory, 'picker-original.png');
  writeFileSync(path, 'image bytes');
  return { uri: pathToFileURL(path).href, name: '截图.png', mimeType: 'image/png', size: 11 };
};
beforeEach(() => {
  harness.directory = mkdtempSync(join(tmpdir(), 'wz-draft-files-'));
  harness.failCopy = false;
  harness.saved = null;
});
afterEach(() => rmSync(harness.directory, { recursive: true, force: true }));

describe('durable draft attachments', () => {
  it('copies the picker file into an owned persistent directory and restores it after the original disappears', async () => {
    const picked = asset();
    const attachment = await persistTopicDraftAttachment({ draft, asset: picked, kind: 'image' });
    expect(attachment.uri).not.toBe(picked.uri);
    expect(readFileSync(fileURLToPath(attachment.uri), 'utf8')).toBe('image bytes');
    rmSync(fileURLToPath(picked.uri));
    expect(await verifyTopicDraftAttachments({ ...draft, attachments: [attachment] })).toEqual({
      ...draft,
      attachments: [attachment]
    });
  });

  it('retains text and attachment metadata when a local file is missing or an upload was interrupted', async () => {
    const attachment = await persistTopicDraftAttachment({ draft, asset: asset(), kind: 'image' });
    const restored = await verifyTopicDraftAttachments({
      ...draft,
      attachments: [{ ...attachment, status: 'uploading' }]
    });
    expect(restored.attachments[0].status).toBe('unknown');
    rmSync(fileURLToPath(attachment.uri));
    const missing = await verifyTopicDraftAttachments(restored);
    expect(missing.body).toBe(draft.body);
    expect(missing.attachments[0]).toMatchObject({ id: attachment.id, uri: attachment.uri, status: 'failed' });
  });

  it('deletes only an owned attachment after its persisted reference is removed', async () => {
    const picked = asset();
    const attachment = await persistTopicDraftAttachment({ draft, asset: picked, kind: 'attachment' });
    harness.saved = { ...draft, attachments: [attachment] };
    await removeTopicDraftAttachmentFile(draft, attachment);
    expect(existsSync(fileURLToPath(attachment.uri))).toBe(true);
    harness.saved = { ...draft, revision: 2 };
    await removeTopicDraftAttachmentFile({ ...draft, identityKey: 'nodeseek:84' }, attachment);
    await removeTopicDraftAttachmentFile(draft, { ...attachment, uri: picked.uri });
    expect(existsSync(fileURLToPath(attachment.uri))).toBe(true);
    expect(existsSync(fileURLToPath(picked.uri))).toBe(true);
    await removeTopicDraftAttachmentFile(draft, attachment);
    expect(existsSync(fileURLToPath(attachment.uri))).toBe(false);
    expect(existsSync(fileURLToPath(picked.uri))).toBe(true);
  });

  it('keeps confirmed remote uploads usable without a local file while final-submit files still require it', async () => {
    const attachment = await persistTopicDraftAttachment({ draft, asset: asset(), kind: 'image' });
    rmSync(fileURLToPath(attachment.uri));
    const uploaded = { ...attachment, status: 'uploaded' as const, markup: '![图片](https://img.invalid/image.png)' };
    expect((await verifyTopicDraftAttachments({ ...draft, attachments: [uploaded] })).attachments).toEqual([uploaded]);
    expect(
      (await verifyTopicDraftAttachments({ ...draft, attachments: [{ ...uploaded, kind: 'yaohuo-file' }] }))
        .attachments[0].status
    ).toBe('failed');
  });

  it('keeps the picker original on copy failure and rejects path traversal owners', async () => {
    const picked = asset();
    harness.failCopy = true;
    await expect(persistTopicDraftAttachment({ draft, asset: picked, kind: 'attachment' })).rejects.toThrow(
      'disk full'
    );
    expect(readFileSync(fileURLToPath(picked.uri), 'utf8')).toBe('image bytes');
    await expect(
      persistTopicDraftAttachment({ draft: { ...draft, id: '../outside' }, asset: picked, kind: 'attachment' })
    ).rejects.toThrow('身份');
  });
});
