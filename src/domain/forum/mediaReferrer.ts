export type MediaReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

export interface MediaReferrerContext {
  documentUrl: string;
  documentPolicy?: MediaReferrerPolicy;
}

const MEDIA_REFERRER_POLICIES = new Set<MediaReferrerPolicy>([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url'
]);

export function normalizeMediaReferrerPolicy(value: unknown): MediaReferrerPolicy | undefined {
  const candidate = String(value || '').toLowerCase() as MediaReferrerPolicy;
  return MEDIA_REFERRER_POLICIES.has(candidate) ? candidate : undefined;
}

export function normalizeMediaReferrerPolicyHeader(value: unknown): MediaReferrerPolicy | undefined {
  const candidates = String(value || '').split(',');
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = normalizeMediaReferrerPolicy(candidates[index].trim());
    if (candidate) return candidate;
  }
  return undefined;
}
