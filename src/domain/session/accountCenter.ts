import type { UserProfile } from '@/domain/forum/models';
import type { CredentialSite } from './sessionContracts';
import type { SessionSite } from './siteSessionState';

export type AccountCenterCommand =
  | { type: 'refresh' }
  | { type: 'open-user'; user: UserProfile }
  | { type: 'open-login'; site: SessionSite }
  | { type: 'open-login-with-fill'; site: SessionSite }
  | { type: 'save-credential'; site: CredentialSite; account: string; password: string; allowUnprotected?: boolean }
  | { type: 'delete-credential'; site: CredentialSite };

export type AccountCredentialFillAttempt = { site: CredentialSite; attempt: number };
