import {
  type CompiledForumContent,
  type CompiledForumContentSegment,
  type ForumContentIslandRegion,
  type ForumContentIslandSegment,
  type ForumContentMaterializationRegion,
  type ForumContentSelectableRegion,
  type ForumContentSelectableSegment
} from '@/domain/forum/topicContentSplit';

export function forumContentSegments(content: Pick<CompiledForumContent, 'regions'>) {
  return content.regions.flatMap<CompiledForumContentSegment>(forumContentRegionSegments);
}

export function forumContentRegionSegments(region: ForumContentMaterializationRegion): CompiledForumContentSegment[] {
  return region.kind === 'selectable' ? [...region.segments] : [region.segment];
}

export function singleForumContentSegment(region: ForumContentMaterializationRegion) {
  const segments = forumContentRegionSegments(region);
  if (segments.length !== 1) throw new Error('Expected one forum content segment.');
  return segments[0]!;
}

export function forumContentRegionForSegment(segment: ForumContentSelectableSegment): ForumContentSelectableRegion;
export function forumContentRegionForSegment<Segment extends ForumContentIslandSegment>(
  segment: Segment
): Omit<ForumContentIslandRegion, 'segment'> & { segment: Segment };
export function forumContentRegionForSegment(segment: CompiledForumContentSegment): ForumContentMaterializationRegion {
  const base = {
    fallbackText: 'text' in segment ? segment.text : '',
    keySuffix: segment.keySuffix,
    materializationBudget: { metrics: null, regionCount: 1 },
    networkMediaCount: segment.networkMediaCount
  };
  return segment.type === 'richText' || segment.type === 'table'
    ? { ...base, kind: 'selectable', segments: [segment] }
    : { ...base, kind: 'island', segment };
}
