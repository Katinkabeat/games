// Shared "Report a player" control for game settings menus.
// Renders a settings row that opens a modal: type-to-search a username
// (resolves to a real account), give a reason, submit via the submit_report
// RPC. Feedback is shown inline — the component deliberately depends on
// neither a toast library nor a specific supabase import.
//
// Opening the modal does NOT close the surrounding dropdown: SQDropdown
// unmounts its children when closed (returns null), which would tear this
// modal down mid-flow. The modal's fixed/z-50 overlay covers the dropdown.
//
// Props:
//   supabase     — the host game's configured client (carries its auth session).
//   game         — slug written to the report row (e.g. "wordy").
//   renderTrigger — optional. Render-prop for the menu row, called with
//                   { open }. Use it when the host menu doesn't use the
//                   .settings-dropdown container (e.g. Rungles styles its own
//                   buttons), so the row can match the surrounding rows.
//                   Defaults to a standard SQSettingsRow.

import { useEffect, useRef, useState } from 'react';
import SQModal from './SQModal.jsx';
import SQButton from './SQButton.jsx';
import { SQSettingsRow } from './SQSettingsMenu.jsx';

export default function SQReportPlayer({ supabase, game, renderTrigger }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState({ kind: 'idle', msg: '' }); // idle | submitting | done | error
  const meId = useRef(null);

  // Resolve the current user once, to exclude self from search results.
  useEffect(() => {
    if (!open || meId.current) return undefined;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) meId.current = data?.user?.id ?? null;
    });
    return () => { active = false; };
  }, [open, supabase]);

  // Debounced username search — mirrors the hub Friends view query.
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (selected || q.length < 2) { setMatches([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      let req = supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${q}%`)
        .is('deactivated_at', null)
        .eq('is_anonymized', false)
        .order('username')
        .limit(10);
      if (meId.current) req = req.neq('id', meId.current);
      const { data, error } = await req;
      if (cancelled) return;
      if (error) { setStatus({ kind: 'error', msg: error.message }); return; }
      setMatches(data || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, selected, open, supabase]);

  function reset() {
    setQuery('');
    setMatches([]);
    setSelected(null);
    setReason('');
    setStatus({ kind: 'idle', msg: '' });
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    if (!selected || !reason.trim()) return;
    setStatus({ kind: 'submitting', msg: '' });
    const { error } = await supabase.rpc('submit_report', {
      reported_user: selected.id,
      game,
      reason: reason.trim(),
    });
    if (error) { setStatus({ kind: 'error', msg: error.message }); return; }
    setStatus({
      kind: 'done',
      msg: 'Report submitted — thanks for letting us know. Our admins will review it.',
    });
  }

  const inputCls =
    'w-full rounded-lg border border-black/10 dark:border-white/10 ' +
    'bg-white/70 dark:bg-black/20 px-3 py-2 text-sm';

  return (
    <>
      {renderTrigger
        ? renderTrigger({ open: () => setOpen(true) })
        : <SQSettingsRow label="Report a player" onClick={() => setOpen(true)} />}
      <SQModal open={open} onClose={close} title="Report a player">
        {status.kind === 'done' ? (
          <div className="space-y-4">
            <p className="text-sm">{status.msg}</p>
            <div className="flex justify-end">
              <SQButton variant="secondary" onClick={close}>Done</SQButton>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-bold mb-1">Who are you reporting?</label>
              {selected ? (
                <div className="settings-row flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">@{selected.username}</span>
                  <button
                    type="button"
                    className="text-xs underline opacity-70 hover:opacity-100"
                    onClick={() => { setSelected(null); setQuery(''); }}
                  >
                    change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={query}
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Start typing their username…"
                    className={inputCls}
                  />
                  {matches.length > 0 && (
                    <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-black/10 dark:border-white/10 divide-y divide-black/5">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                            onClick={() => { setSelected(m); setMatches([]); }}
                          >
                            @{m.username}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {query.trim().length >= 2 && matches.length === 0 && (
                    <p className="mt-1 text-xs opacity-60">No matching players.</p>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold mb-1">What's wrong?</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Describe what happened. Admins will review."
                className={`${inputCls} resize-none`}
              />
            </div>

            {status.kind === 'error' && (
              <p className="text-sm text-rose-600">{status.msg}</p>
            )}

            <div className="flex justify-end gap-2">
              <SQButton variant="secondary" onClick={close}>Cancel</SQButton>
              <SQButton
                variant="danger"
                onClick={submit}
                disabled={!selected || !reason.trim() || status.kind === 'submitting'}
              >
                {status.kind === 'submitting' ? 'Submitting…' : 'Submit report'}
              </SQButton>
            </div>
          </div>
        )}
      </SQModal>
    </>
  );
}
