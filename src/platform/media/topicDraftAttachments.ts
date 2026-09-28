import { Directory, File, Paths } from 'expo-file-system';
import type { TopicDraft, TopicDraftAttachment } from '@/domain/forum/topicComposer';
import { loadTopicDraft } from '@/platform/persistence/topicDrafts';
import { topicDraftTarget } from '@/domain/forum/topicComposer';

type DraftOwner = Pick<TopicDraft, 'id' | 'source' | 'identityKey' | 'edit'>;
const safeId = /^[A-Za-z0-9_-]{1,128}$/;

function directory(draft: DraftOwner) {
  if (
    !safeId.test(draft.id) ||
    !['nodeseek', 'linuxdo', 'yaohuo'].includes(draft.source) ||
    !draft.identityKey.startsWith(`${draft.source}:`) ||
    draft.identityKey === `${draft.source}:anonymous`
  )
    throw new Error('附件草稿身份不正确');
  return new Directory(
    Paths.document,
    'topic-draft-attachments',
    draft.source,
    `account-${encodeURIComponent(draft.identityKey)}`,
    draft.id
  );
}

function ownedFile(draft: DraftOwner, attachment: TopicDraftAttachment) {
  if (!safeId.test(attachment.id)) throw new Error('附件标识不正确');
  const folder = directory(draft);
  const uri = attachment.uri;
  const prefix = `${folder.uri.replace(/\/$/, '')}/`;
  if (!uri.startsWith(prefix)) return null;
  const name = uri.slice(prefix.length);
  if (!new RegExp(`^${attachment.id}\\.[a-zA-Z0-9]{1,12}$`).test(name)) return null;
  const file = new File(folder, name);
  return file.uri === uri ? file : null;
}

export async function persistTopicDraftAttachment({
  draft,
  asset,
  kind
}: {
  draft: DraftOwner;
  asset: { uri: string; name: string; mimeType?: string; size?: number };
  kind: TopicDraftAttachment['kind'];
}): Promise<TopicDraftAttachment> {
  const attachment: TopicDraftAttachment = {
    id: `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
    ...asset,
    mimeType: asset.mimeType || 'application/octet-stream',
    size: asset.size || 0,
    kind,
    status: 'queued',
    description: ''
  };
  if (!safeId.test(attachment.id) || !/^(file|content):\/\//.test(attachment.uri)) throw new Error('请选择本机文件');
  const folder = directory(draft);
  folder.create({ intermediates: true, idempotent: true });
  const extension = attachment.name.match(/\.([a-zA-Z0-9]{1,12})$/)?.[1] || 'bin';
  const target = new File(folder, `${attachment.id}.${extension}`);
  if (target.exists) throw new Error('附件标识已存在，请重新选择文件');
  try {
    const original = new File(attachment.uri);
    await original.copy(target);
    if (!target.exists || target.size <= 0) throw new Error('附件为空或无法读取');
    return { ...attachment, uri: target.uri, size: target.size };
  } catch (error) {
    // This function created only this destination; never delete a picker original or another draft.
    if (target.exists) target.delete();
    throw error;
  }
}

export async function verifyTopicDraftAttachments(draft: TopicDraft): Promise<TopicDraft> {
  const attachments: TopicDraftAttachment[] = draft.attachments.map((attachment) => {
    // A confirmed remote URL remains usable after the local picked file disappears.
    if (attachment.kind !== 'yaohuo-file' && attachment.status === 'uploaded' && attachment.markup?.trim())
      return attachment;
    const file = ownedFile(draft, attachment);
    if (!file?.exists || file.size !== attachment.size || file.size <= 0) {
      return { ...attachment, status: 'failed', error: '本机附件已丢失或变化，请重新选择文件' };
    }
    if (attachment.status === 'uploading') {
      return { ...attachment, status: 'unknown', error: '上次附件上传结果尚未确认，请先核实' };
    }
    return attachment;
  });
  return { ...draft, attachments };
}

/** Call only after the new draft (or its deletion) has durably committed. */
export async function removeTopicDraftAttachmentFile(draft: DraftOwner, attachment: TopicDraftAttachment) {
  const file = ownedFile(draft, attachment);
  if (!file) return;
  const saved = await loadTopicDraft(draft.source, draft.identityKey, topicDraftTarget(draft));
  if (saved?.attachments.some((item) => item.uri === attachment.uri)) return;
  if (file.exists) file.delete();
}
