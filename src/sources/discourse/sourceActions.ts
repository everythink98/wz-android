import {
  buildDiscourseActionRequest,
  discourseImageUrlFromUploadResponse,
  type DiscourseAction,
  type DiscourseActionRequest
} from './actionRequest';
import { sourceCatalog, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { buildXiaoyinsiActionRequest } from '@/sources/xiaoyinsi/actionRequest';

type DiscourseActionBuilder = (action: DiscourseAction) => DiscourseActionRequest;

const actionBuilders = {
  linuxdo: buildDiscourseActionRequest,
  xiaoyinsi: buildXiaoyinsiActionRequest
} satisfies Record<DiscourseSource, DiscourseActionBuilder>;

export function buildDiscourseSourceActionRequest(source: DiscourseSource, action: DiscourseAction) {
  return actionBuilders[source](action);
}

export function discourseSourceUploadUrl(source: DiscourseSource, data: unknown) {
  const site = sourceCatalog[source];
  return discourseImageUrlFromUploadResponse(data, site.baseUrl, site.label);
}
