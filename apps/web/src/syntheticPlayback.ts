import { eventAt, type SyntheticEvent, type SyntheticMatch } from './syntheticMatch'

type Request = { eventId: string; generation: number }
type EventState = { eventId: string; dueAt: number; generation: number; resultAt: number | null; failed: boolean; timedOut: boolean }

// Animation time and request gates are independent of React renders. Agent
// latency can hold the clock, but can never move it backwards.
export class SyntheticPlayback {
  clock = 0
  pending: Request | null = null
  private previousTick: number | null = null
  private lastRequestAt = -Infinity
  private submitted = new Set<string>()
  private current: EventState | null = null

  constructor(readonly match: SyntheticMatch) {}

  pause() { this.previousTick = null }

  seek(seconds: number) {
    this.clock = Math.max(0, Math.min(this.match.duration, seconds))
    this.previousTick = null
    this.current = null
    const active = eventAt(this.match, this.clock)
    this.submitted = new Set(this.match.events.filter(event => event.startTime < active.startTime).map(event => event.id))
    // Keep an old request reserved until the server finishes it. Seeking or
    // restarting must not accidentally double the real Foundry workload.
  }

  isCurrent(eventId: string, generation: number) {
    return this.current?.eventId === eventId && this.current.generation === generation
      && !this.current.timedOut && !this.current.failed
      && eventAt(this.match, this.clock).id === eventId
  }

  receiveResult(eventId: string, generation: number, now: number) {
    if (!this.isCurrent(eventId, generation)) return false
    if (this.current!.resultAt === null) this.current!.resultAt = now
    return true
  }

  finishRequest(eventId: string, generation: number) {
    if (this.pending?.eventId === eventId && this.pending.generation === generation) this.pending = null
  }

  failRequest(eventId: string, generation: number) {
    this.finishRequest(eventId, generation)
    if (this.current?.eventId === eventId && this.current.generation === generation) this.current.failed = true
  }

  advance(now: number, rate: number, generation: number) {
    // A background tab cannot skip whole plays on its next animation frame.
    const elapsed = this.previousTick === null ? 0 : Math.max(0, Math.min(.1, (now - this.previousTick) / 1000))
    this.previousTick = now
    const before = eventAt(this.match, this.clock)
    let next = Math.min(this.match.duration, this.clock + elapsed * rate)
    if (next >= before.time && this.current?.eventId !== before.id) {
      this.current = { eventId: before.id, dueAt: now, generation, resultAt: null, failed: this.clock > before.holdTime, timedOut: false }
    }
    const state = this.current
    let submission: SyntheticEvent | null = null
    let waiting = false
    if (state?.eventId === before.id) {
      if (state.resultAt === null && now - state.dueAt >= this.match.playback.agentTimeoutSeconds * 1000) state.timedOut = true
      if (!state.timedOut && !state.failed && !this.submitted.has(before.id) && !this.pending
        && now - this.lastRequestAt >= this.match.playback.minRequestIntervalSeconds * 1000) {
        this.submitted.add(before.id)
        this.pending = { eventId: before.id, generation }
        state.dueAt = now
        this.lastRequestAt = now
        submission = before
      }
      const resultRead = state.resultAt !== null && now - state.resultAt >= this.match.playback.resultHoldSeconds * 1000
      if (!resultRead && !state.failed && !state.timedOut && next >= before.holdTime) {
        next = Math.max(this.clock, before.holdTime)
        waiting = true
      }
    }
    this.clock = next
    const event = eventAt(this.match, next)
    return { clock: next, event, submission, waiting, resultReady: state?.eventId === event.id && state.resultAt !== null, timedOut: state?.eventId === event.id && state.timedOut, failed: state?.eventId === event.id && state.failed }
  }
}
