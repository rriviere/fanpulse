import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { eventAt, positionAt, sceneAt, validateMatch } from '../src/syntheticMatch'
import { SyntheticPlayback } from '../src/syntheticPlayback'

const raw = JSON.parse(readFileSync(new URL('../public/simulations/reference-match.v1.json', import.meta.url), 'utf8'))
const match = validateMatch(raw)
const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x - b.x, a.y - b.y)

test('external data rejects broken timelines, contacts, rosters and observations', () => {
  const corruptions = [
    (data: typeof match) => { data.players[1].id = data.players[0].id },
    (data: typeof match) => { data.players[0].keyframes[1].time = 0 },
    (data: typeof match) => { data.players[0].keyframes[1].x = 900 },
    (data: typeof match) => { data.ball[0].playerId = 'missing-player' },
    (data: typeof match) => { data.ball[0].x += 10 },
    (data: typeof match) => { data.events[1].startTime = data.events[0].holdTime },
    (data: typeof match) => { data.events[0].observation.video_timestamp_seconds += 1 },
    (data: typeof match) => { data.events[0].observation.event_type = 'not-an-event' },
    (data: typeof match) => { data.playback.minRequestIntervalSeconds = 1 },
  ]
  for (const corrupt of corruptions) {
    const changed = structuredClone(match)
    corrupt(changed)
    assert.throws(() => validateMatch(changed), /Invalid synthetic match/)
  }
})

test('every animation boundary is position-continuous, including kicks and phase changes', () => {
  const boundaries = new Set([
    ...match.ball.map(point => point.time),
    ...match.events.flatMap(event => [event.startTime, event.time, event.holdTime]),
    ...match.players.flatMap(player => player.keyframes.map(point => point.time)),
  ])
  const epsilon = .00001
  for (const time of boundaries) {
    const before = sceneAt(match, time - epsilon), after = sceneAt(match, time + epsilon)
    assert.ok(distance(before.ball, after.ball) < .001, `ball jumps at ${time}s`)
    for (let index = 0; index < before.players.length; index++) {
      assert.ok(distance(before.players[index], after.players[index]) < .001, `${before.players[index].id} jumps at ${time}s`)
    }
  }
})

test('player velocity is continuous across every authored keyframe', () => {
  const epsilon = .0001
  for (const player of match.players) for (const point of player.keyframes.slice(1, -1)) {
    const before = positionAt(player.keyframes, point.time - epsilon)
    const after = positionAt(player.keyframes, point.time + epsilon)
    const left = { x: (point.x - before.x) / epsilon, y: (point.y - before.y) / epsilon }
    const right = { x: (after.x - point.x) / epsilon, y: (after.y - point.y) / epsilon }
    assert.ok(distance(left, right) < .02, `${player.id} changes velocity abruptly at ${point.time}s`)
  }
})

test('the full match stays on the pitch, within football speeds, with controlled ball contact', () => {
  let previous = sceneAt(match, 0), maxBall = 0, maxPlayer = 0
  for (let frame = 1; frame <= match.duration * 60; frame++) {
    const current = sceneAt(match, frame / 60)
    maxBall = Math.max(maxBall, distance(previous.ball, current.ball) * 60)
    assert.ok(Math.abs(current.ball.x) <= 52.5 && Math.abs(current.ball.y) <= 34)
    current.players.forEach((player, index) => {
      maxPlayer = Math.max(maxPlayer, distance(previous.players[index], player) * 60)
      assert.ok(Math.abs(player.x) <= 52.5 && Math.abs(player.y) <= 34)
      if (player.id === current.carrier) assert.ok(Math.abs(distance(player, current.ball) - match.pitch.ballControlOffset) < 1e-8)
    })
    previous = current
  }
  assert.ok(maxBall > 12 && maxBall < 32, `maximum ball speed ${maxBall}`)
  assert.ok(maxPlayer > 4 && maxPlayer < 9.5, `maximum player speed ${maxPlayer}`)
})

test('pass flight does not ease to a stop between players', () => {
  const index = match.ball.findIndex(point => point.motion === 'pass')
  const from = match.ball[index], to = match.ball[index + 1], span = to.time - from.time
  const steps = [.1, .2, .3, .4, .5].map(fraction => sceneAt(match, from.time + fraction * span).ball)
  for (let i = 2; i < steps.length; i++) assert.ok(Math.abs(distance(steps[i - 1], steps[i]) - distance(steps[0], steps[1])) < 1e-8)
})

test('event observations refer to their visible players, team, pitch region and completed action', () => {
  const expected = [
    ['black-11', 32, 21], ['green-5', 16, 26], ['green-9', -25, -23],
    ['green-10', -43, 2], ['black-9', 24, -14], ['green-1', 46, 0],
    ['green-6', 0, -15], ['green-9', -47, -22], ['green-5', -36, -8],
    ['green-10', -42, 1], ['green-10', -42, 2], ['green-11', -43, 19],
  ] as const
  match.events.forEach((event, index) => {
    const scene = sceneAt(match, event.time)
    assert.equal(scene.eventId, event.id)
    assert.equal(scene.carrier, expected[index][0])
    assert.ok(distance(scene.ball, {x:expected[index][1],y:expected[index][2]}) < .02)
    assert.equal(event.observation.video_timestamp_seconds, event.time)
    if (index !== 5) assert.equal(scene.players.find(player => player.id === scene.carrier)!.team, event.observation.team)
  })
})

test('past the final event, neither ball nor scene returns to the first play', () => {
  const finalEvent = match.events.at(-1)!
  for (const time of [finalEvent.time, finalEvent.time + 4, 240, 999]) assert.equal(sceneAt(match, time).eventId, finalEvent.id)
  assert.deepEqual(sceneAt(match, 999).ball, {x:-24,y:6})
  assert.deepEqual(eventAt(match, 240), finalEvent)
})

function harness(rate = 1) {
  const playback = new SyntheticPlayback(match)
  let now = 0
  const submissions: {id:string;at:number;clock:number}[] = []
  const tick = (milliseconds = 20, generation = 1) => {
    now += milliseconds
    const step = playback.advance(now, rate, generation)
    if (step.submission) submissions.push({ id:step.submission.id, at:now, clock:step.clock })
    return step
  }
  const until = (condition: () => boolean, limit = 120_000) => {
    const end = now + limit
    while (!condition() && now < end) tick()
    assert.ok(condition(), 'virtual playback condition timed out')
  }
  return {playback,tick,until,submissions,get now(){return now}}
}

test('slow agents hold the final position without rewinding, then allow six real seconds to read', () => {
  const h = harness(4), event = match.events[0]
  h.until(() => h.playback.clock >= event.holdTime)
  const held = sceneAt(match, h.playback.clock)
  for (let i = 0; i < 100; i++) h.tick()
  assert.equal(h.playback.clock, event.holdTime)
  assert.deepEqual(sceneAt(match, h.playback.clock).ball, held.ball)
  const resultAt = h.now
  assert.ok(h.playback.receiveResult(event.id, 1, resultAt))
  h.playback.finishRequest(event.id, 1)
  while (h.now - resultAt < 5980) h.tick()
  assert.equal(h.playback.clock, event.holdTime)
  h.tick(40)
  assert.ok(h.playback.clock > event.holdTime)
})

test('all twelve events at 1×, 2× and 4× are ordered, submitted once and rate-limited in real time', () => {
  for (const rate of [1, 2, 4]) {
    const h = harness(rate)
    let previous = 0
    while (h.playback.clock < match.duration && h.now < 500_000) {
      const step = h.tick()
      assert.ok(step.clock >= previous)
      previous = step.clock
      if (step.submission) {
        assert.ok(step.clock >= step.submission.time)
        assert.ok(h.playback.receiveResult(step.submission.id, 1, h.now))
        h.playback.finishRequest(step.submission.id, 1)
      }
    }
    assert.equal(h.playback.clock, match.duration)
    assert.deepEqual(h.submissions.map(item => item.id), match.events.map(event => event.id))
    for (let index = 1; index < h.submissions.length; index++) assert.ok(h.submissions[index].at - h.submissions[index - 1].at >= 10_000)
  }
})

test('timeout releases animation but reserves the actual request until its completion', () => {
  const h = harness(4), event = match.events[0]
  h.until(() => h.submissions.length === 1)
  const request = h.playback.pending
  h.until(() => h.playback.clock > match.events[1].time)
  assert.equal(h.submissions.length, 1)
  assert.deepEqual(h.playback.pending, request)
  assert.equal(h.playback.receiveResult(event.id, 1, h.now), false)
  h.playback.finishRequest(event.id, 1)
  h.until(() => h.submissions.length === 2)
  assert.equal(h.submissions[1].id, match.events[1].id)
})

test('pause/resume does not duplicate a request or advance the animation while paused', () => {
  const h = harness(2)
  h.until(() => h.submissions.length === 1)
  const clock = h.playback.clock, pending = h.playback.pending
  h.playback.pause()
  h.tick(5000)
  assert.equal(h.playback.clock, clock)
  assert.deepEqual(h.playback.pending, pending)
  assert.equal(h.submissions.length, 1)
})

test('seeking reserves old requests, rejects their results, and submits only the selected play', () => {
  const h = harness(4)
  h.until(() => h.submissions.length === 1)
  const old = h.playback.pending!
  h.playback.seek(102)
  h.tick(20, 2)
  assert.equal(h.playback.receiveResult(old.eventId, old.generation, h.now), false)
  assert.deepEqual(h.playback.pending, old)
  assert.equal(h.submissions.length, 1)
  h.playback.finishRequest(old.eventId, old.generation)
  for (let i = 0; i < 600 && h.submissions.length === 1; i++) h.tick(20, 2)
  assert.equal(h.submissions.length, 2)
  assert.equal(h.submissions[1].id, match.events[5].id)
})

test('rate changes and background-tab gaps cannot jump the simulation forward', () => {
  const h = harness()
  h.tick()
  h.tick()
  const before = h.playback.clock
  h.tick(60_000)
  assert.ok(h.playback.clock - before <= .100001)
  assert.equal(h.submissions.length, 0)
  const playback = new SyntheticPlayback(match)
  playback.advance(0, 1, 1)
  playback.advance(100, 1, 1)
  playback.advance(200, 4, 1)
  assert.equal(playback.clock, .5)
  playback.pause()
  playback.advance(20_000, 2, 1)
  assert.equal(playback.clock, .5)
})

test('restart rejects an older generation of the same event and cannot overlap its request', () => {
  const h = harness(4)
  h.until(() => h.submissions.length === 1)
  const old = h.playback.pending!
  h.playback.seek(0)
  for (let i = 0; i < 500; i++) h.tick(20, 2)
  assert.equal(h.submissions.length, 1)
  assert.equal(h.playback.receiveResult(old.eventId, 1, h.now), false)
  h.playback.finishRequest(old.eventId, 1)
  h.tick(20, 2)
  assert.equal(h.submissions.length, 2)
  assert.equal(h.submissions[1].id, old.eventId)
  assert.ok(h.playback.receiveResult(old.eventId, 2, h.now))
})

test('seeking beyond a completed action does not rewind or submit an obsolete observation', () => {
  const h = harness(4)
  h.playback.seek(239)
  h.tick(20, 2)
  assert.equal(h.playback.clock, 239)
  assert.equal(h.submissions.length, 0)
  h.tick(20, 2)
  assert.ok(h.playback.clock > 239)
})
