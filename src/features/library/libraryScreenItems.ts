import type { FeedSource } from '@/domain/forum/models';
import { type FollowedUserRecord, type TopicRecord, userKey } from '@/domain/reader/readerData';
import type { LibraryTab } from '@/domain/forum/feed';
import { groupLibraryRecordsByTime } from './model/libraryFilters';

export type LibraryListItem =
  | { type: 'section'; key: string; label: string; first: boolean }
  | { type: 'record'; key: string; record: TopicRecord; first: boolean };

export type LibraryDataItem = FollowedUserRecord | LibraryListItem;

function libraryRecordKey(record: TopicRecord) {
  return `${record.topic.source}:${record.topic.id}`;
}

export function filterFollowedUsersBySource(followedUsers: FollowedUserRecord[], sourceFilter: FeedSource) {
  return sourceFilter === 'all' ? followedUsers : followedUsers.filter((record) => record.user.source === sourceFilter);
}

export function createLibraryListItems(records: TopicRecord[]) {
  return groupLibraryRecordsByTime(records).flatMap((section, index) => [
    { type: 'section' as const, key: `section:${section.label}`, label: section.label, first: index === 0 },
    ...section.records.map((record, recordIndex) => ({
      type: 'record' as const,
      key: libraryRecordKey(record),
      record,
      first: index === 0 && recordIndex === 0
    }))
  ]);
}

export function libraryCountLabel({
  filteredRecords,
  followedUsers,
  libraryTab,
  records,
  userRecords
}: {
  filteredRecords: TopicRecord[];
  followedUsers: FollowedUserRecord[];
  libraryTab: LibraryTab;
  records: TopicRecord[];
  userRecords: FollowedUserRecord[];
}) {
  if (libraryTab === 'users') {
    return `${userRecords.length} / ${followedUsers.length} 人`;
  }
  return filteredRecords.length === records.length
    ? `${records.length} 条`
    : `${filteredRecords.length} / ${records.length} 条`;
}

export function libraryDataItemKey(item: LibraryDataItem, libraryTab: LibraryTab) {
  return libraryTab === 'users' ? userKey((item as FollowedUserRecord).user) : (item as LibraryListItem).key;
}

export function libraryDataItemType(item: LibraryDataItem, libraryTab: LibraryTab) {
  return libraryTab === 'users' ? 'user' : (item as LibraryListItem).type;
}
