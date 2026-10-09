import {
  yaohuoFileSizeLimit,
  type TopicCreationContext,
  type TopicDraftAttachment,
  type TopicCreationSource
} from '@/domain/forum/topicComposer';
import type { Fetcher } from '@/platform/network/request';
import { buildDiscourseActionRequest, discourseImageUrlFromUploadResponse } from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { uploadNodeSeekReplyImageWithApiKey } from '@/sources/nodeimage/upload';
import { uploadYaohuoReplyImage } from '@/sources/yaohuo/imageUpload';
import { normalizeReplyImageAsset, replyImageMarkupForSource } from '@/sources/imageUpload';
import { LINUXDO_BASE_URL } from '@/sources/linuxdo/protocol';

export function validateTopicAttachment(file: TopicDraftAttachment, context: TopicCreationContext) {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('文件为空或无法读取');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (file.kind === 'yaohuo-file') {
    if (context.source !== 'yaohuo' || !context.allowedFileExtensions.includes(extension))
      throw new Error('原站不支持此文件类型');
    const limit = yaohuoFileSizeLimit(file);
    if (file.size > limit) throw new Error(`妖火的此类文件不能超过 ${limit / 1024 / 1024} MiB`);
    return;
  }
  if (context.source === 'linuxdo') {
    if (!context.allowedExtensions.includes(extension)) throw new Error('linux.do 当前不允许此文件类型');
    if (file.kind === 'attachment' && !context.canUploadAttachments) throw new Error('当前账号不能上传附件');
    const limit = file.kind === 'image' ? context.maxImageBytes : context.maxAttachmentBytes;
    if (file.size > limit) throw new Error(`文件不能超过 ${(limit / 1024 / 1024).toFixed(1)} MiB`);
  } else {
    if (file.kind !== 'image') throw new Error('当前站点只支持图床图片');
    normalizeReplyImageAsset(file);
  }
}

export async function uploadTopicAttachment({
  file,
  source,
  context,
  fetcher,
  userAgent,
  ensureNodeImageApiKey,
  signal
}: {
  file: TopicDraftAttachment;
  source: TopicCreationSource;
  context: TopicCreationContext;
  fetcher: Fetcher;
  userAgent: string;
  ensureNodeImageApiKey: () => Promise<string | null>;
  signal: AbortSignal;
}) {
  validateTopicAttachment(file, context);
  if (file.kind === 'yaohuo-file') throw new Error('文件帖在最终发布时上传');
  if (source === 'linuxdo') {
    const response = await runLinuxDoAction({
      fetcher,
      userAgent,
      signal,
      request: buildDiscourseActionRequest({ type: 'upload', file })
    });
    const url = discourseImageUrlFromUploadResponse(response, LINUXDO_BASE_URL, 'linux.do');
    if (file.kind === 'image') return replyImageMarkupForSource(source, url, file.name);
    const name = file.name.replace(/[\[\]<>|\r\n]/g, ' ');
    return `[${name}|attachment](${url})`;
  }
  const image = normalizeReplyImageAsset(file);
  const url =
    source === 'nodeseek'
      ? await uploadNodeSeekReplyImageWithApiKey({ file: image, fetcher, signal, ensureApiKey: ensureNodeImageApiKey })
      : await uploadYaohuoReplyImage({ file: image, fetcher, signal });
  if (!url) throw new Error('请到账号中心获取 NodeImage 授权');
  return replyImageMarkupForSource(source, url, file.name);
}
