// Shared elapsed-time formatter for all SQ surfaces (lobby rows, "last move",
// inactivity / turn-age copy, admin panels). One rule, defined once, so the
// wording can't drift between games again.
//
// Rule (Rae, c186): show minutes under an hour, hours under 24h, days after.
//   < 1m  -> "just now"
//   < 1h  -> "Xm ago"
//   < 24h -> "Xh ago"
//   >= 24h -> "Xd ago"   (plateaus at days; no weeks/months rollup)
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}
