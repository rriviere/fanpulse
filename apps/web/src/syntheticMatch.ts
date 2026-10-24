import type { VisionObservation } from './types'

export type Point = { x: number; y: number }
export type PositionKeyframe = Point & { time: number }
export type SyntheticPlayer = {
  id: string
  team: 'black' | 'green'
  number: number
  role: string
  keyframes: PositionKeyframe[]
}
export type BallKeyframe = PositionKeyframe & {
  motion: 'carry' | 'pass' | 'hold'
  playerId?: string
}
export type SyntheticEvent = {
  id: string
  startTime: number
  time: number
  holdTime: number
  label: string
  observation: VisionObservation
}
export type SyntheticMatch = {
  version: 1
  id: string
  duration: number
  provenance: string
  pitch: { length: number; width: number; ballControlOffset: number }
  playback: { minRequestIntervalSeconds: number; resultHoldSeconds: number; agentTimeoutSeconds: number }
  players: SyntheticPlayer[]
  ball: BallKeyframe[]
  events: SyntheticEvent[]
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid synthetic match: ${message}`)
}

// Coordinates are metres from the pitch centre. Validate external content before
// it can drive either the animation or an agent submission.
export function validateMatch(data: unknown): SyntheticMatch {
  requireValid(data && typeof data === 'object', 'expected an object')
  const match = data as SyntheticMatch
  requireValid(match.version === 1 && typeof match.id === 'string', 'unsupported version or missing ID')
  requireValid(Number.isFinite(match.duration) && match.duration > 0, 'invalid duration')
  requireValid(match.pitch?.length === 105 && match.pitch?.width === 68, 'expected a 105 × 68 metre pitch')
  requireValid(Number.isFinite(match.pitch.ballControlOffset) && match.pitch.ballControlOffset >= 1 && match.pitch.ballControlOffset <= 3, 'invalid ball control offset')
  requireValid(typeof match.provenance === 'string' && match.provenance.length > 0, 'missing provenance')
  requireValid(match.playback?.minRequestIntervalSeconds >= 10, 'analysis interval must be at least 10 seconds')
  requireValid(match.playback.resultHoldSeconds >= 6 && match.playback.agentTimeoutSeconds >= 18, 'invalid result timing')
  requireValid(Array.isArray(match.players) && match.players.length === 22, 'expected 22 players')
  requireValid(Array.isArray(match.ball) && Array.isArray(match.events) && match.events.length > 0, 'missing ball or events')
  const ids = new Set<string>()
  const numbers = new Set<string>()
  const validateTrack = (track: PositionKeyframe[], name: string, speedLimit: number) => {
    requireValid(Array.isArray(track) && track.length >= 2, `${name}: missing keyframes`)
    requireValid(track[0].time === 0 && track.at(-1)!.time === match.duration, `${name}: track must cover the match`)
    track.forEach((point, index) => {
      requireValid([point.time, point.x, point.y].every(Number.isFinite), `${name}: non-finite keyframe`)
      requireValid(Math.abs(point.x) <= 52.5 && Math.abs(point.y) <= 34, `${name}: outside the pitch`)
      if (index === 0) return
      const previous = track[index - 1], span = point.time - previous.time
      requireValid(span > 0, `${name}: timestamps must be unique and ordered`)
      requireValid(distance(previous, point) / span <= speedLimit, `${name}: excessive speed at ${point.time}s`)
    })
  }
  for (const player of match.players) {
    requireValid(typeof player.id === 'string' && !ids.has(player.id), 'duplicate or invalid player ID')
    requireValid(['black', 'green'].includes(player.team), 'invalid team')
    requireValid(Number.isInteger(player.number) && player.number >= 1 && player.number <= 11, 'invalid shirt number')
    requireValid(typeof player.role === 'string', 'missing player role')
    requireValid(!numbers.has(`${player.team}-${player.number}`), 'duplicate shirt number')
    ids.add(player.id); numbers.add(`${player.team}-${player.number}`)
    validateTrack(player.keyframes, player.id, 8)
  }
  requireValid(match.players.filter(player => player.team === 'black').length === 11, 'expected 11 players per team')
  validateTrack(match.ball, 'ball', 32)
  match.ball.forEach((point, index) => {
    requireValid(['carry', 'pass', 'hold'].includes(point.motion), 'invalid ball motion')
    if (point.motion === 'pass') return
    requireValid(point.playerId && ids.has(point.playerId), 'unknown ball carrier')
    const player = match.players.find(item => item.id === point.playerId)!
    for (const endpoint of [point, match.ball[index + 1] ?? point]) {
      const position = positionAt(player.keyframes, endpoint.time)
      const foot = { x: position.x + (player.team === 'black' ? 1 : -1) * match.pitch.ballControlOffset, y: position.y }
      requireValid(distance(foot, endpoint) < .02, `ball separates from ${player.id} at ${endpoint.time}s`)
    }
    if (point.motion === 'hold' && index < match.ball.length - 1) {
      requireValid(distance(point, match.ball[index + 1]) < .02, 'a held ball cannot move')
    }
  })
  const eventIds = new Set<string>()
  const eventTypes = ['attacking_sequence', 'attacking_pressure', 'counterattack', 'dangerous_movement', 'potential_shot', 'defensive_transition', 'team_shape_change', 'sustained_momentum', 'unusual_moment', 'no_significant_event', 'unknown']
  match.events.forEach((event, index) => {
    requireValid(typeof event.id === 'string' && /^[a-z0-9-]{3,80}$/.test(event.id) && !eventIds.has(event.id), 'duplicate or invalid event ID')
    eventIds.add(event.id)
    requireValid(typeof event.label === 'string' && event.label.length >= 3 && event.label.length <= 100, 'invalid event label')
    requireValid([event.startTime, event.time, event.holdTime].every(Number.isFinite), 'invalid event timestamps')
    requireValid(index === 0 ? event.startTime === 0 : event.startTime > match.events[index - 1].holdTime, 'overlapping events')
    requireValid(event.startTime < event.time && event.time <= event.holdTime && event.holdTime < (match.events[index + 1]?.startTime ?? match.duration), 'invalid event boundaries')
    requireValid(event.holdTime - event.time <= 12, 'event hold is outside the backend freshness window')
    const observation = event.observation
    requireValid(observation?.video_timestamp_seconds === event.time, 'observation timestamp differs from the animation')
    requireValid(eventTypes.includes(observation.event_type), 'invalid observation event type')
    requireValid(['black', 'green'].includes(observation.team), 'invalid observation team')
    requireValid(['low', 'medium', 'high'].includes(observation.confidence), 'invalid confidence')
    requireValid(['directly_visible', 'reasonable_interpretation', 'insufficient_evidence'].includes(observation.evidence_basis), 'invalid evidence basis')
    requireValid(typeof observation.is_significant === 'boolean', 'invalid significance')
    requireValid(typeof observation.description === 'string' && observation.description.length > 0 && observation.description.length <= 300, 'invalid description')
    requireValid(typeof observation.evidence === 'string' && observation.evidence.length > 0 && observation.evidence.length <= 400, 'invalid evidence')
  })
  return match
}

export async function loadSyntheticMatch(signal?: AbortSignal): Promise<SyntheticMatch> {
  const response = await fetch('/simulations/reference-match.v1.json', { signal })
  if (!response.ok) throw new Error(`Match data unavailable (${response.status})`)
  return validateMatch(await response.json())
}

function segmentAt(track: PositionKeyframe[], time: number): number {
  let low = 0, high = track.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (track[middle].time <= time) low = middle
    else high = middle
  }
  return low
}

// Shared tangents give continuous velocity. Shape-preserving cubic interpolation
// prevents overshooting a run, a receiving position, or a touchline.
function tangent(track: PositionKeyframe[], index: number, axis: 'x' | 'y'): number {
  if (index === 0 || index === track.length - 1) return 0
  const previous = track[index - 1], current = track[index], next = track[index + 1]
  const before = current.time - previous.time, after = next.time - current.time
  const a = (current[axis] - previous[axis]) / before, b = (next[axis] - current[axis]) / after
  if (a * b <= 0) return 0
  const w1 = 2 * after + before, w2 = after + 2 * before
  return (w1 + w2) / (w1 / a + w2 / b)
}

export function positionAt(track: PositionKeyframe[], seconds: number): Point {
  const time = clamp(seconds, track[0].time, track.at(-1)!.time)
  const index = segmentAt(track, time), from = track[index], to = track[index + 1]
  const span = to.time - from.time, t = (time - from.time) / span
  const interpolate = (axis: 'x' | 'y') => (2 * t ** 3 - 3 * t ** 2 + 1) * from[axis]
    + (t ** 3 - 2 * t ** 2 + t) * span * tangent(track, index, axis)
    + (-2 * t ** 3 + 3 * t ** 2) * to[axis]
    + (t ** 3 - t ** 2) * span * tangent(track, index + 1, axis)
  return { x: interpolate('x'), y: interpolate('y') }
}

export function eventAt(match: SyntheticMatch, seconds: number): SyntheticEvent {
  return [...match.events].reverse().find(event => event.startTime <= seconds) ?? match.events[0]
}

export function sceneAt(match: SyntheticMatch, seconds: number) {
  const time = clamp(seconds, 0, match.duration)
  const players = match.players.map(player => ({ ...player, ...positionAt(player.keyframes, time) }))
  const index = segmentAt(match.ball, time), from = match.ball[index], to = match.ball[index + 1]
  let ball: Point, carrier: string | null = null
  if (from.motion === 'carry' || from.motion === 'hold') {
    const player = players.find(item => item.id === from.playerId)!
    ball = { x: player.x + (player.team === 'black' ? 1 : -1) * match.pitch.ballControlOffset, y: player.y }
    carrier = player.id
  } else {
    const progress = (time - from.time) / (to.time - from.time)
    ball = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
  }
  const event = eventAt(match, time)
  return { players, ball, carrier, label: event.label, eventId: event.id, motion: from.motion }
}
