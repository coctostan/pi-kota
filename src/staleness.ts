export function isIndexStale(
  indexedAtCommit: string | null,
  currentHead: string | null,
): boolean {
  if (!indexedAtCommit || !currentHead) return false;
  return indexedAtCommit !== currentHead;
}
