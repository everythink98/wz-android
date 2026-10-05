export interface DiscoursePostPolicy {
  postId: string;
  version: string;
  acceptLabel: string;
  revokeLabel: string;
  accepted: boolean;
  revoked: boolean;
  canAccept: boolean;
  canRevoke: boolean;
}
