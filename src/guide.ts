import { say } from './syslog.ts'

// Once the day's schedule is done nothing says what comes next. When the story has begun and
// nothing has moved for a while (no recording heard, no relic found, no new destination), the
// robot reads out what its radar is picking up, in the same voice as the schedule's nudges.

const AFTER = 45

/**
 * next(): what to say now and a key that changes whenever the player makes progress, or null
 * when there is nothing to point at. busy: a recording, the story log or the menu holds the
 * stage, so the clock waits.
 */
export function createGuide(next: () => { key: string; line: string } | null) {
  let key = ''
  let stalled = 0
  return {
    update(dt: number, busy: boolean) {
      if (busy) return
      const n = next()
      if (!n || n.key !== key) {
        key = n?.key ?? ''
        stalled = 0
        return
      }
      stalled += dt
      if (stalled > AFTER) {
        stalled = 0
        say(n.line)
      }
    },
  }
}
