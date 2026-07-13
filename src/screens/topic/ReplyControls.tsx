import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';
import type { ReplyFilter } from '../../appTypes';
import { AppButton, IconButton, PillRail } from '../../components/AppControls';
import { createStyles, type ReaderTheme } from '../../theme';
import { replyControlsDraftAfterExternalQuery } from './replyControlsQuery';

export const ReplyControls = memo(function ReplyControls({
  canWrite,
  commentQuery,
  contentWidth,
  replyComposerOpen,
  replyFilter,
  replyTotalCount,
  styles,
  theme,
  unreadReplyCount,
  onCommentQueryChange,
  onReplyComposerOpenChange,
  onReplyFilterChange
}: {
  canWrite: boolean;
  commentQuery: string;
  contentWidth: number;
  replyComposerOpen: boolean;
  replyFilter: ReplyFilter;
  replyTotalCount: number;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  unreadReplyCount: number;
  onCommentQueryChange: (value: string) => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
}) {
  const [draftQuery, setDraftQuery] = useState(commentQuery);
  const lastCommittedQueryRef = useRef(commentQuery);
  const commitQuery = useCallback((value: string) => {
    if (value === lastCommittedQueryRef.current) {
      return;
    }
    lastCommittedQueryRef.current = value;
    onCommentQueryChange(value);
  }, [onCommentQueryChange]);

  useEffect(() => {
    setDraftQuery((current) => replyControlsDraftAfterExternalQuery(
      current,
      lastCommittedQueryRef.current,
      commentQuery
    ));
    if (commentQuery !== lastCommittedQueryRef.current) {
      lastCommittedQueryRef.current = commentQuery;
    }
  }, [commentQuery]);
  useEffect(() => {
    if (draftQuery === lastCommittedQueryRef.current) {
      return;
    }
    const timer = setTimeout(() => commitQuery(draftQuery), 180);
    return () => clearTimeout(timer);
  }, [commitQuery, draftQuery]);

  return (
    <View style={styles.topicListItemFrame}>
      <View style={[styles.replyHeader, { width: contentWidth }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{replyTotalCount} 条</Text></Text>
          {canWrite ? (
            <AppButton
              label={replyComposerOpen ? '收起回复' : '写回复'}
              variant={replyComposerOpen ? 'ghost' : 'default'}
              styles={styles}
              onPress={() => onReplyComposerOpenChange(!replyComposerOpen)}
            />
          ) : null}
        </View>
        <PillRail
          variant="subtabs"
          items={[
            { value: 'all', label: '全部' },
            { value: 'author', label: '只看楼主' },
            { value: 'images', label: '只看带图' },
            { value: 'newest', label: '倒序' }
          ]}
          value={replyFilter}
          styles={styles}
          onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
        />
        {unreadReplyCount > 0 ? <Text style={styles.noticeText}>新增 {unreadReplyCount} 条回复</Text> : null}
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={draftQuery}
            onBlur={() => commitQuery(draftQuery)}
            onChangeText={setDraftQuery}
            placeholder="评论内查找"
            placeholderTextColor={theme.muted}
          />
          {draftQuery ? <IconButton icon={X} label="清空查找" styles={styles} theme={theme} onPress={() => setDraftQuery('')} /> : null}
        </View>
      </View>
    </View>
  );
});
