// Three-way render branch used by every hub admin sub-page: loading
// state -> empty state -> list. Caller owns the actual <li> markup
// (each admin page has different row chrome) and passes it as
// children. AdminList just owns the branching + <ul> wrapper.
export default function AdminList({
  loading,
  items,
  emptyText,
  loadingText = 'Loading…',
  children,
  ulClassName = 'space-y-2',
}) {
  if (loading) {
    return <p className="text-sm text-wordy-500 italic">{loadingText}</p>;
  }
  if (!items || items.length === 0) {
    return <p className="text-sm text-wordy-500 italic">{emptyText}</p>;
  }
  return <ul className={ulClassName}>{children}</ul>;
}
