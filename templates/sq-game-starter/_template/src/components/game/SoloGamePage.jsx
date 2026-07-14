import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import { supabase } from '../../lib/supabase.js'

// Solo play page. `gameId` is the Atlantic YMD, so the daily seed is the same
// for everyone that day.
//
// TODO:
//   - load solo game state by `gameId` (or create-if-missing for fresh starts)
//   - render the {{name}} solo play surface
//   - call recordResult(gameId, score) exactly once when the run ends
//
// RESUME (optional): if you persist an in-progress run so a reload continues it
// instead of re-rolling the seed, store the snapshot in a {{slug}}_daily_runs
// table and let the write-guard RPC delete it (see the migration). Never grant
// delete-own on that table. IMPORTANT: a resume feature turns an unnoticed
// result-write failure into a replay loop — the player finishes, the write
// silently fails, the snapshot survives, and every reopen drops them back at
// the end of the run. That is exactly why recordResult below is not
// fire-and-forget. See [[feedback_sq_result_write_resilience]].
export default function SoloGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const userId = session?.user?.id

  // Name this `recordState`, NOT `saveState` — games commonly already import a
  // `saveState()` helper for localStorage persistence, and shadowing it with a
  // state variable turns `saveState(state)` into "call a string" at runtime.
  const [recordState, setRecordState] = useState('idle') // idle | saving | error | saved
  const [dayClosed, setDayClosed]     = useState(false)  // run finished after its day ended
  const lastResultRef = useRef(null)                     // for the retry button

  // Record a finished run. This MUST NOT be fire-and-forget: a swallowed
  // failure loses the score, and (with resume) leaves the run replayable.
  //
  // The usual failure is a stale/expired access token after a backgrounded
  // mobile tab — supabase-js's refresh timer gets throttled, so the request
  // 401s. Refreshing the session and retrying recovers it silently.
  //
  // The one failure we must NOT retry is the guard rejecting a non-today
  // play_date (a run that crossed midnight): retrying can never succeed, so we
  // say "this day has ended" instead of spinning.
  async function recordResult(playDate, score) {
    if (!userId || !playDate) return
    lastResultRef.current = { playDate, score }
    setRecordState('saving')

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.rpc('{{slug}}_record_solo_result', {
        p_play_date: playDate,
        p_score: score,
      })
      if (!error) { setRecordState('saved'); return }

      if (/is not today/.test(error.message ?? '')) {
        setDayClosed(true)
        setRecordState('error')
        return
      }

      console.error(`[{{slug}}] record result failed (attempt ${attempt + 1})`, error)
      await supabase.auth.refreshSession().catch(() => {})
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
    setRecordState('error')
  }

  function retrySave() {
    const r = lastResultRef.current
    if (r) recordResult(r.playDate, r.score)
  }

  return (
    <SQBoardShell
      width="narrow"
      header={
        <SQLobbyHeader
          title="{{name}}"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
        />
      }
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={() => navigate('/')}
          centerSlot={null}
          rightSlot={null /* TODO solo-game status, e.g. moves remaining */}
        />
      }
    >
      <div className="py-6">
        <h1 className="font-display text-2xl mb-2">Solo game {gameId}</h1>
        <p className="opacity-80">
          Solo board placeholder — render the {{name}} solo play surface here.
        </p>
        {/* TODO render this on your end-of-run screen, not here.
            That end-of-run card ALSO needs the canonical SQ exit row, directly
            below the result line and NEVER gated by outcome or save state (a
            loss, a give-up and a day-closed run all get the same doors out):

              <div className="flex gap-2 justify-center mt-4">
                <button className="btn-secondary" onClick={() => navigate('/')}>← Lobby</button>
                <button className="btn-primary" onClick={() => navigate('/stats')}>🏆 Leaderboard</button>
              </div>

            Put it on the end screen itself, not only on the "already played
            today" re-entry panel — those are different surfaces, and mistaking
            one for the other is how Oublex shipped without it (c240 → c279). */}
        <SaveStatus
          recordState={recordState}
          dayClosed={dayClosed}
          onRetrySave={retrySave}
        />
      </div>
    </SQBoardShell>
  )
}

// Reflect the REAL save state. Never show an unconditional "your score is
// logged" — if the write failed, say so and offer a retry, otherwise the
// player believes a lost run counted.
function SaveStatus({ recordState, dayClosed, onRetrySave }) {
  if (dayClosed) {
    return (
      <p className="text-sm mt-3">
        This run's day ended at midnight, so it won't be recorded. Today's game
        is ready when you are.
      </p>
    )
  }
  if (recordState === 'error') {
    return (
      <div className="mt-3">
        <p className="text-sm font-bold text-rose-500">Couldn't save your run.</p>
        <button className="btn-primary mt-2" onClick={onRetrySave}>Retry saving</button>
      </div>
    )
  }
  if (recordState === 'saving') return <p className="text-xs opacity-70 mt-3">Saving your run…</p>
  if (recordState === 'saved')  return <p className="text-xs opacity-70 mt-3">Run logged. One attempt per day.</p>
  return null
}
