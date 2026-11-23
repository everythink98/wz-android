import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { normalizeNodeSeekStardustRefId, type NodeSeekStardustReceive } from '@/domain/forum/structuredComposer';
import type { NodeSeekStardustStatus } from '@/sources/nodeseek/stardust';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createUiFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
import { topicActionDecisionMessage } from '../actions/topicActionDecision';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { Avatar } from '@/ui/avatar/Avatar';
import { NODESEEK_BASE_URL } from '@/sources/nodeseek/protocol';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = createUiFontSizer(settings);
  return StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      backgroundColor: alphaColor(theme.favorite, theme.dark ? 0.08 : 0.035),
      borderColor: alphaColor(theme.favorite, theme.dark ? 0.32 : 0.38),
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 10,
      marginVertical: 8,
      padding: 14
    },
    header: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    title: {
      color: theme.ink,
      flex: 1,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(16), fontSize(22)),
      fontWeight: '700'
    },
    amount: {
      color: theme.warning,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(16), fontSize(22)),
      fontWeight: '700',
      fontVariant: ['tabular-nums']
    },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(14), fontSize(20))
    },
    meta: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(fontSize(12), fontSize(17)),
      fontVariant: ['tabular-nums']
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
  const { actionBusy, decisionFor, loadNodeSeekStardustStatus, payNodeSeekStardust, stardustPayments, stardustPayer } =
    actions;
  const { receiverMemberId, amount, refId, description, oneTime } = receive;
  const stableReceive = useMemo(
    () => ({ receiverMemberId, amount, refId, description, oneTime }),
    [amount, description, oneTime, receiverMemberId, refId]
  );
  const paymentKey = JSON.stringify([stardustPayer, receiverMemberId.replace(/^0+(?=\d)/, ''), refId]);
  const readPhase = useCallback(() => stardustPayments.phase(paymentKey), [paymentKey, stardustPayments]);
  const phase = useSyncExternalStore(stardustPayments.subscribe, readPhase);
  const paying = phase === 'paying';
  const paymentUnknown = phase === 'unknown';
  const paymentNotice = paymentUnknown ? '付款结果未知，请先在原站确认，切勿直接重复付款。' : '';
  const binding = useMemo(() => ({ receive: stableReceive, paymentKey }), [stableReceive, paymentKey]);
  const currentBinding = useCommittedRef(binding);
  const statusRequest = useRef<object | null>(null);
  const [status, setStatus] = useRecyclingState<NodeSeekStardustStatus | null>(null, [binding]);
  const [refreshingStatus, setRefreshingStatus] = useRecyclingState(false, [binding]);

  const loadStatus = useCallback(
    async (reason: 'refresh' | 'after-payment' = 'refresh') => {
      if (statusRequest.current && reason !== 'after-payment') return;
      const request = {};
      statusRequest.current = request;
      setRefreshingStatus(true);
      const nextStatus = await loadNodeSeekStardustStatus(binding.receive).catch(() => null);
      if (currentBinding.current !== binding || statusRequest.current !== request) return;
      statusRequest.current = null;
      setRefreshingStatus(false);
      if (nextStatus) setStatus(nextStatus);
    },
    [binding, currentBinding, loadNodeSeekStardustStatus, setRefreshingStatus, setStatus]
  );

  useEffect(() => {
    void loadStatus();
    return () => {
      statusRequest.current = null;
    };
  }, [loadStatus]);

  const validRef = normalizeNodeSeekStardustRefId(refId) !== null;
  const oneTimeClosed = phase === 'paid' || (oneTime && Boolean(status?.closed));
  const decision = decisionFor({
    action: 'pay',
    alreadyComplete: oneTimeClosed,
    pending: paying
  });
  const pay = useCallback(async () => {
    if (!validRef || oneTimeClosed || paymentUnknown || !decision.allowed) return;
    const outcome = await stardustPayments.pay(paymentKey, oneTime, () => payNodeSeekStardust(stableReceive));
    if (!outcome || currentBinding.current !== binding) return;
    if (outcome === 'submitted' && oneTime) {
      setStatus((current) => ({
        participantCount: current?.participantCount || 0,
        totalAmount: current?.totalAmount || 0,
        paid: true,
        closed: true
      }));
    }
    if (outcome !== 'canceled') void loadStatus('after-payment');
  }, [
    binding,
    currentBinding,
    decision.allowed,
    loadStatus,
    oneTime,
    oneTimeClosed,
    payNodeSeekStardust,
    paymentKey,
    paymentUnknown,
    setStatus,
    stableReceive,
    stardustPayments,
    validRef
  ]);

  const statusText = status
    ? status.closed
      ? oneTimeClosed && !paymentUnknown
        ? ''
        : '该收款已关闭'
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
          ? '确认中'
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
        {paymentUnknown ? (
          <AppButton
            compact
            icon={RefreshCw}
            label="刷新状态"
            loading={refreshingStatus}
            onPress={() => void loadStatus()}
          />
        ) : null}
        <AppButton
          compact
          variant="primary"
          label={buttonLabel}
          loading={paying}
          disabled={!validRef || paymentUnknown || oneTimeClosed || !decision.allowed || paying || actionBusy}
          onPress={() => void pay()}
        />
      </View>
    </View>
  );
}
