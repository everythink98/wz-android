import { Pressable, Text, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { CheckCircle, CheckSquare, Circle, Square, Users } from 'lucide-react-native';
import type { Source, TopicPoll } from '../../types';
import { pollParticipationLabel, pollTotalVotes } from '../../topicPollDisplay';
import { androidRipple, createStyles, type ReaderTheme } from '../../theme';
import { AppButton, triggerPressFeedback } from '../../components/AppControls';

function topicPollKey(poll: TopicPoll, index: number) {
  return poll.id || poll.name || `poll-${index}`;
}

function pollChoiceRangeLabel(poll: TopicPoll) {
  if (!poll.multiple) {
    return undefined;
  }
  return [
    typeof poll.min === 'number' ? `至少 ${poll.min} 项` : undefined,
    typeof poll.max === 'number' ? `最多 ${poll.max} 项` : undefined
  ].filter(Boolean).join('，') || undefined;
}

function pollTypeLabel(poll: TopicPoll) {
  const labels: Record<string, string> = {
    ranked_choice: '排序投票',
    number: '数字投票'
  };
  return (poll.type ? labels[poll.type] : undefined) || (poll.multiple ? '多选' : '单选');
}

function pollSelectionRangeStatus(poll: TopicPoll, selectedCount: number) {
  if (!poll.multiple) {
    return undefined;
  }
  if (typeof poll.min === 'number' && selectedCount > 0 && selectedCount < poll.min) {
    return `至少选择 ${poll.min} 项`;
  }
  if (typeof poll.max === 'number' && selectedCount > poll.max) {
    return `最多选择 ${poll.max} 项`;
  }
  return undefined;
}

export function TopicPolls({
  actionBusy,
  canWritePollSource,
  embeddedInArticle,
  keyPrefix,
  onTogglePollSelection,
  onVotePoll,
  pollSelections,
  polls,
  source,
  styles,
  theme
}: {
  actionBusy: boolean;
  canWritePollSource: boolean;
  embeddedInArticle?: boolean;
  keyPrefix: string;
  onTogglePollSelection: (key: string, poll: TopicPoll, optionId: string) => void;
  onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
  pollSelections: Record<string, string[]>;
  polls: TopicPoll[];
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  const { getMappingKey } = useMappingHelper();
  if (!polls.length) {
    return null;
  }
  const canVotePollSource = source === 'nodeseek' || source === 'linuxdo' || source === 'yaohuo';
  return (
    <View style={styles.pollStack}>
      {polls.map((poll, index) => {
        const pollKey = `${keyPrefix}-${topicPollKey(poll, index)}`;
        const hasCounts = poll.options.some((option) => typeof option.count === 'number');
        const totalVotes = pollTotalVotes(poll);
        const selectedOptionIds = pollSelections[pollKey] || poll.options.filter((option) => option.selected).map((option) => option.id);
        const selectedSet = new Set(selectedOptionIds);
        const linuxDoPollReady = source !== 'linuxdo' || Boolean(poll.postId && poll.name);
        const pollReadonly = Boolean(poll.readonly || !canVotePollSource);
        const pollOptionDisabled = actionBusy || pollReadonly || Boolean(poll.closed || poll.voted || !canWritePollSource || !linuxDoPollReady);
        const selectionRangeStatus = pollSelectionRangeStatus(poll, selectedOptionIds.length);
        const pollStatus = poll.closed
          ? '已关闭'
          : poll.voted
            ? '已投票'
            : pollReadonly
              ? '只读结果'
              : !canWritePollSource
                ? '未登录'
                : !linuxDoPollReady
                  ? '信息不完整'
                  : '可投票';
        const pollMetaItems = [
          pollTypeLabel(poll),
          pollChoiceRangeLabel(poll),
          typeof poll.public === 'boolean' ? (poll.public ? '公开' : '不公开') : undefined
        ].filter((item): item is string => Boolean(item));
        const pollParticipation = pollParticipationLabel(poll);
        const submitLabel = poll.closed
          ? '投票已关闭'
          : poll.voted
            ? '已投票'
            : pollReadonly
              ? '只读结果'
              : !canWritePollSource
                ? '登录后投票'
                : !linuxDoPollReady
                  ? '刷新后投票'
                  : selectionRangeStatus || '提交投票';
        const submitDisabled = pollOptionDisabled || !selectedOptionIds.length || Boolean(selectionRangeStatus);
        return (
          <View key={getMappingKey(pollKey, index)} style={[styles.pollBlock, embeddedInArticle && index === 0 && styles.pollBlockFirstInArticle]}>
            <View style={styles.pollHeader}>
              <Text style={styles.pollTitle}>{poll.title || '投票'}</Text>
            </View>
            <View style={styles.pollOptionList}>
              {poll.options.map((option, optionIndex) => {
                const selected = selectedSet.has(option.id);
                const OptionIcon = poll.multiple
                  ? selected ? CheckSquare : Square
                  : selected ? CheckCircle : Circle;
                const percentValue = hasCounts && totalVotes > 0 && typeof option.count === 'number'
                  ? Math.round((option.count / totalVotes) * 100)
                  : undefined;
                const countText = typeof option.count === 'number'
                  ? `${option.count} 票${percentValue !== undefined ? ` · ${percentValue}%` : ''}`
                  : '';
                return (
                  <Pressable
                    key={getMappingKey(option.id, optionIndex)}
                    accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: selected, disabled: pollOptionDisabled }}
                    android_ripple={androidRipple(theme.primarySoft)}
                    disabled={pollOptionDisabled}
                    style={[styles.pollOptionRow, optionIndex > 0 && styles.pollOptionDivider, selected && styles.pollOptionRowSelected]}
                    onPress={() => {
                      triggerPressFeedback();
                      onTogglePollSelection(pollKey, poll, option.id);
                    }}
                  >
                    {percentValue !== undefined ? (
                      <View pointerEvents="none" style={[styles.pollOptionProgress, { width: `${percentValue}%` }]} />
                    ) : null}
                    <View style={styles.pollOptionContent}>
                      <View style={styles.pollOptionIcon}>
                        <OptionIcon size={18} color={selected ? theme.primary : theme.muted} strokeWidth={1.8} />
                      </View>
                      <View style={styles.pollOptionTextBlock}>
                        <Text style={styles.pollOptionText}>{option.label}</Text>
                        {countText ? <Text style={styles.pollOptionCount}>{countText}</Text> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.pollFooter}>
              <View style={styles.pollMetaWrap}>
                {pollParticipation ? (
                  <View style={styles.pollParticipationPill}>
                    <Users size={14} color={theme.primary} strokeWidth={2} />
                    <Text style={styles.pollParticipationText}>{pollParticipation}</Text>
                  </View>
                ) : null}
                {pollMetaItems.map((item, index) => (
                  <Text key={getMappingKey(item, index)} style={styles.pollMetaPill}>{item}</Text>
                ))}
                <Text style={styles.pollStatePill}>{pollStatus}</Text>
              </View>
              {canVotePollSource ? (
                <View style={styles.pollSubmitRow}>
                  <AppButton
                    compact
                    label={submitLabel}
                    variant={submitDisabled ? 'ghost' : 'primary'}
                    styles={styles}
                    disabled={submitDisabled}
                    onPress={() => onVotePoll(poll, selectedOptionIds)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
