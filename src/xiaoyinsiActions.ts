import { buildDiscourseActionRequest, type DiscourseAction, type DiscourseActionRequest } from '@/discourseActions';

function positiveInteger(value: string | number, name: string) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    throw new Error(`${name} 不正确`);
  }
  return text;
}

export function buildXiaoyinsiActionRequest(action: DiscourseAction): DiscourseActionRequest {
  if (action.type === 'set-bookmark' && !action.active && !action.bookmarkId && action.targetType === 'Topic') {
    return {
      path: `/t/${positiveInteger(action.targetId, '收藏对象 id')}/remove_bookmarks`,
      method: 'PUT',
      headers: {},
      body: undefined
    };
  }
  return buildDiscourseActionRequest(action);
}
