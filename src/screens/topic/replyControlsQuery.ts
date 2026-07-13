export function replyControlsDraftAfterExternalQuery(
  currentDraft: string,
  lastCommittedQuery: string,
  externalQuery: string
) {
  return externalQuery === lastCommittedQuery ? currentDraft : externalQuery;
}
