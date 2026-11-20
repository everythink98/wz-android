import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { normalizeNodeSeekStardustRefId, type NodeSeekStardustReceive } from '@/domain/forum/structuredComposer';
import type { NodeSeekStardustStatus } from '@/sources/nodeseek/stardust';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createReaderFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { topicActionDecisionMessage } from '../actions/topicActionDecision';
import type { TopicActionsController } from '../actions/useTopicActionsController';
import { Avatar } from '@/ui/avatar/Avatar';
import { NODESEEK_BASE_URL } from '@/sources/nodeseek/protocol';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontSize = createReaderFontSizer(settings);
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
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(16),
      fontWeight: '700',
      lineHeight: fontSize(22)
    },
    amount: {
      color: theme.warning,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(16),
      fontWeight: '700',
      lineHeight: fontSize(22),
      fontVariant: ['tabular-nums']
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
      lineHeight: fontSize(17),
      fontVariant: ['tabular-nums']
    },
    error: { color: theme.danger },
    actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }
  });
}

type PaymentRequest = { readonly receive: NodeSeekStardustReceive };
type PaymentState =
  | { phase: 'idle' | 'unknown' | 'paid'; receive: NodeSeekStardustReceive }
  | { phase: 'paying'; receive: NodeSeekStardustReceive; request: PaymentRequest };
function useStardustPaymentState(receive: NodeSeekStardustReceive) {
  const [snapshot, setSnapshot] = useRecyclingState<PaymentState>({ phase: 'idle', receive }, [receive]);
  const current = useRef(snapshot);
  const publish = useCallback(
    (next: PaymentState) => {
      current.current = next;
      setSnapshot(next);
    },
    [setSnapshot]
  );
  const begin = useCallback(
    (scope: NodeSeekStardustReceive) => {
      if (current.current.receive === scope && current.current.phase !== 'idle') return null;
      const request: PaymentRequest = { receive: scope };
      publish({ phase: 'paying', receive: scope, request });
      return request;
    },
    [publish]
  );
  const settle = useCallback(
    (
      request: PaymentRequest,
      outcome: Awaited<ReturnType<TopicActionsController['payNodeSeekStardust']>>,
      oneTime: boolean
    ) => {
      if (current.current.phase !== 'paying' || current.current.request !== request) return false;
      publish({
        receive: request.receive,
        phase: outcome === 'unknown' ? 'unknown' : outcome === 'submitted' && oneTime ? 'paid' : 'idle'
      });
      return true;
    },
    [publish]
  );
  const release = useCallback(
    (request: PaymentRequest) => {
      if (current.current.phase === 'paying' && current.current.request === request)
        publish({ phase: 'idle', receive: request.receive });
    },
    [publish]
  );
  return {
    paying: snapshot.phase === 'paying',
    paymentUnknown: snapshot.phase === 'unknown',
    oneTimePaid: snapshot.phase === 'paid',
    paymentNotice: snapshot.phase === 'unknown' ? '付款结果未知，请先在原站确认，切勿直接重复付款。' : '',
    begin,
    settle,
    release
  };
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
  const currentReceive = useCommittedRef(stableReceive);
  const {
    paying,
    paymentUnknown,
    oneTimePaid,
    paymentNotice,
    begin: beginPayment,
    settle: settlePayment,
    release: releasePayment
  } = useStardustPaymentState(stableReceive);
  const statusRequest = useRef<object | null>(null);
  const [status, setStatus] = useRecyclingState<NodeSeekStardustStatus | null>(null, [stableReceive]);
  const [refreshingStatus, setRefreshingStatus] = useRecyclingState(false, [stableReceive]);

  const loadStatus = useCallback(
    async (reason: 'refresh' | 'after-payment' = 'refresh') => {
      if (statusRequest.current && reason !== 'after-payment') return;
      const request = {};
      statusRequest.current = request;
      setRefreshingStatus(true);
      const nextStatus = await loadNodeSeekStardustStatus(stableReceive).catch(() => null);
      if (currentReceive.current !== stableReceive || statusRequest.current !== request) return;
      statusRequest.current = null;
      setRefreshingStatus(false);
      if (nextStatus) setStatus(nextStatus);
    },
    [currentReceive, loadNodeSeekStardustStatus, setRefreshingStatus, setStatus, stableReceive]
  );

  useEffect(() => {
    void loadStatus();
    return () => {
      statusRequest.current = null;
    };
  }, [loadStatus]);

  const validRef = normalizeNodeSeekStardustRefId(refId) !== null;
  const oneTimeClosed = oneTime && Boolean(oneTimePaid || status?.closed);
  const decision = decisionFor({
    action: 'pay',
    alreadyComplete: oneTimeClosed,
    pending: paying
  });
  const pay = useCallback(async () => {
    if (!validRef || oneTimeClosed || paymentUnknown || !decision.allowed) return;
    const request = beginPayment(stableReceive);
    if (!request) return;
    try {
      const outcome = await payNodeSeekStardust(stableReceive);
      if (currentReceive.current !== stableReceive) return;
      if (!settlePayment(request, outcome, oneTime)) return;
      if (outcome === 'submitted' && oneTime) {
        setStatus((current) => ({
          participantCount: current?.participantCount || 0,
          totalAmount: current?.totalAmount || 0,
          paid: true,
          closed: true
        }));
      }
      if (outcome !== 'canceled') void loadStatus('after-payment');
    } finally {
      if (currentReceive.current === stableReceive) releasePayment(request);
    }
  }, [
    currentReceive,
    decision.allowed,
    loadStatus,
    oneTime,
    oneTimeClosed,
    payNodeSeekStardust,
    paymentUnknown,
    setStatus,
    beginPayment,
    settlePayment,
    releasePayment,
    stableReceive,
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
