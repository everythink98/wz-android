export function canUseLinuxDoLike(item: { canLike?: boolean } | null | undefined) {
  return item?.canLike !== false;
}
