import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { normalizeNodeSeekStardustRefId, type NodeSeekStardustReceive } from '@/domain/forum/structuredComposer';
import type { NodeSeekStardustStatus } from '@/sources/nodeseek/stardust';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { topicActionDecisionMessage } from '../actions/topicActionDecision';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { Avatar } from '@/ui/avatar/Avatar';
import { NODESEEK_BASE_URL } from '@/sources/nodeseek/protocol';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      backgroundColor: alphaColor(theme.favorite, theme.dark ? 0.08 : 0.035),
      borderColor: alphaColor(theme.favorite, theme.dark ? 0.32 : 0.38),
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 10,
      marginVertical: 8,
      padding: 14
    },
    header: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    title: {
      color: theme.ink,
      flex: 1,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(16),
      fontWeight: '700'
    },
    amount: {
      color: theme.warning,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(16),
      fontWeight: '700'
    },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(14),
      lineHeight: fontSize(20)
    },
    meta: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(12),
      lineHeight: fontSize(17)
    },
    error: { color: theme.danger },
    actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }
  });
}

export function NodeSeekStardustCard({
  actions,
  receive
}: {
  actions: TopicActionsController;
  receive: NodeSeekStardustReceive;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const { actionBusy, decisionFor, loadNodeSeekStardustStatus, payNodeSeekStardust } = actions;
  const { receiverMemberId, amount, refId, description, oneTime } = receive;
  const stableReceive = useMemo(
    () => ({ receiverMemberId, amount, refId, description, oneTime }),
    [amount, description, oneTime, receiverMemberId, refId]
  );
  const requestRef = useRef(0);
  const [status, setStatus] = useState<NodeSeekStardustStatus | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [paymentUnknown, setPaymentUnknown] = useState(false);
  const [oneTimePaid, setOneTimePaid] = useState(false);
  const loadStatus = useCallback(async () => {
    const request = ++requestRef.current;
    const nextStatus = await loadNodeSeekStardustStatus(stableReceive).catch(() => null);
    if (request === requestRef.current && nextStatus) setStatus(nextStatus);
  }, [loadNodeSeekStardustStatus, stableReceive]);

  useEffect(() => {
    void loadStatus();
    return () => {
      requestRef.current += 1;
    };
  }, [loadStatus]);

  useEffect(() => {
    setStatus(null);
    setPaymentNotice('');
    setPaymentUnknown(false);
    setOneTimePaid(false);
  }, [stableReceive]);

  const validRef = normalizeNodeSeekStardustRefId(refId) !== null;
  const oneTimeClosed = oneTime && Boolean(oneTimePaid || status?.closed);
  const decision = decisionFor({
    action: 'pay',
    alreadyComplete: oneTimeClosed,
    pending: paying
  });
  const pay = useCallback(async () => {
    if (!validRef || oneTimeClosed || paymentUnknown || !decision.allowed) return;
    setPaying(true);
    setPaymentNotice('');
    try {
      const outcome = await payNodeSeekStardust(stableReceive);
      if (outcome === 'unknown') {
        setPaymentUnknown(true);
        setPaymentNotice('付款结果未知，请先在原站确认，切勿直接重复付款。');
      } else if (outcome === 'submitted' && oneTime) {
        setOneTimePaid(true);
        setStatus((current) => ({
          participantCount: current?.participantCount || 0,
          totalAmount: current?.totalAmount || 0,
          paid: true,
          closed: true
        }));
      }
      if (outcome !== 'canceled') void loadStatus();
    } finally {
      setPaying(false);
    }
  }, [
    decision.allowed,
    loadStatus,
    oneTime,
    oneTimeClosed,
    payNodeSeekStardust,
    paymentUnknown,
    stableReceive,
    validRef
  ]);

  const statusText = status
    ? status.closed
      ? '该收款已关闭'
      : status.paid
        ? '当前账号已付款'
        : `${status.participantCount} 人已付 · 累计 ${status.totalAmount} Stardust`
    : '';
  const buttonLabel = !validRef
    ? 'Ref 无效'
    : paymentUnknown
      ? '结果待确认'
      : oneTimeClosed
        ? '已关闭'
        : paying
          ? '正在确认…'
          : `支付 ${receive.amount} Stardust`;

  return (
    <View
      accessibilityLabel={`NodeSeek Stardust 收款，${receive.amount} Stardust`}
      style={styles.card}
      testID="nodeseek-stardust-card"
    >
      <View style={styles.header}>
        <Avatar
          contentSource="nodeseek"
          name={`#${receive.receiverMemberId}`}
          small
          uri={`${NODESEEK_BASE_URL}/avatar/${receive.receiverMemberId}.png`}
        />
        <Text style={styles.title}>Stardust 收款</Text>
        <Text style={styles.amount}>{receive.amount} Stardust</Text>
      </View>
      {receive.description ? <Text style={styles.text}>{receive.description}</Text> : null}
      <Text style={styles.meta}>
        收款人 #{receive.receiverMemberId} · Ref {receive.refId}
        {receive.oneTime ? ' · 一次性付款' : ''}
      </Text>
      {statusText ? (
        <Text accessibilityLiveRegion="polite" style={styles.meta}>
          {statusText}
        </Text>
      ) : null}
      {!validRef ? <Text style={[styles.meta, styles.error]}>此卡片的 Ref 无效，不能付款</Text> : null}
      {paymentNotice ? (
        <Text accessibilityLiveRegion="assertive" style={[styles.meta, styles.error]}>
          {paymentNotice}
        </Text>
      ) : null}
      {!decision.allowed && validRef && !paymentUnknown && !oneTimeClosed ? (
        <Text style={styles.meta}>{topicActionDecisionMessage(decision)}</Text>
      ) : null}
      <View style={styles.actions}>
        <AppButton
          compact
          variant="primary"
          label={buttonLabel}
          disabled={!validRef || paymentUnknown || oneTimeClosed || !decision.allowed || paying || actionBusy}
          onPress={() => void pay()}
        />
      </View>
    </View>
  );
}
