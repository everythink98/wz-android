import type { UserDetails } from './models';

export type NodeSeekAccountOverview = {
  source: 'nodeseek';
  userId: string;
  profile: UserDetails;
  coin?: number;
  stardust?: number;
  follows?: number;
  fans?: number;
  collectionCount?: number;
};

export type YaohuoAccountOverview = {
  source: 'yaohuo';
  userId: string;
  profile: UserDetails;
  crystals?: number;
  experience?: number;
  memberLabel?: string;
  memberExpiresAt?: string;
};

export type AccountOverview = NodeSeekAccountOverview | YaohuoAccountOverview;

export type NodeSeekAttendanceRecord = {
  id: string;
  memberId: string;
  dayId: number;
  gain: number;
  createdAt: string;
};

export type NodeSeekAttendanceEntry = NodeSeekAttendanceRecord & { memberName: string };

export type NodeSeekAttendanceBoard = {
  source: 'nodeseek';
  userId: string;
  list: NodeSeekAttendanceEntry[];
  record: NodeSeekAttendanceRecord | null;
  order: number | null;
  total: number;
};

export type NodeSeekCheckInState =
  | { kind: 'idle' }
  | { kind: 'signed'; record: NodeSeekAttendanceRecord; order: number | null }
  | { kind: 'confirmed-pending' }
  | { kind: 'result-unknown' };

export type NodeSeekCreditEntry = {
  change: number;
  balance: number;
  reason: string;
  createdAt: string;
};

export type NodeSeekCreditCurrency = 'coin' | 'stardust';

export type NodeSeekStardustCreditPage = {
  source: 'nodeseek';
  userId: string;
  entries: NodeSeekCreditEntry[];
  hasMore: boolean;
  nextBeforeId: number | null;
};

export type NodeSeekCreditPage = {
  source: 'nodeseek';
  userId: string;
  entries: NodeSeekCreditEntry[];
  page: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
};
