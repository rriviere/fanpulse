import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import type { VisionObservation, VisionResultMessage } from '../src/types'

type Submission = {generation:number;event_id:string;event_label:string;observation:VisionObservation;session_id:string}

// This transport exists only in the test runner. Nothing here reaches Azure or
// becomes a fallback response in the application.
async function syntheticPage(page: Page, deferVotes = false) {
  let socket: WebSocketRoute
  const submissions: Submission[] = []
  const errors: string[] = []
  const pendingVotes: (() => Promise<void>)[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({time: new Date('2026-10-24T00:00:00Z')})
  await page.routeWebSocket('**/ws', ws => { socket = ws })
  const result = (item: Submission, direct: boolean): VisionResultMessage => ({
    type:'vision_result', session_id:item.session_id, generation:item.generation,
    window:{start_seconds:item.observation.video_timestamp_seconds,end_seconds:item.observation.video_timestamp_seconds},
    observation:item.observation, assessment:null,
    insight:{publish_insight:true,significance:80,headline:item.event_label,explanation:item.observation.evidence,uncertainty_note:null,
      poll:direct?null:{question:`What happens after ${item.event_label}?`,options:[{id:'attack',label:'Attack develops'},{id:'defence',label:'Defence recovers'}],duplicate_key:item.event_id}},
    policy:{outcome:'published',reason:direct?'synthetic_direct':'published'},
    latency:{vision_ms:0,agent_ms:2000,match_analyst_ms:1000,fan_engagement_ms:1000,total_ms:2000},
    provider:{vision_model:'synthetic-observation-adapter',agent:direct?'synthetic-direct':'test-agent',agents:[],retried_stages:[]},
    synthetic_event:{id:item.event_id,label:item.event_label,timestamp_seconds:item.observation.video_timestamp_seconds},
  })
  const enrich = (item: Submission) => {
    socket.send(JSON.stringify(result(item, false)))
    socket.send(JSON.stringify({type:'synthetic_complete',session_id:item.session_id,generation:item.generation,event_id:item.event_id,outcome:'complete'}))
  }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/synthetic')) {
      const item = {...route.request().postDataJSON(),session_id:url.pathname.split('/')[4]} as Submission
      submissions.push(item)
      await route.fulfill({status:202,json:{status:'queued'}})
      socket.send(JSON.stringify(result(item, true)))
    } else if (url.pathname === '/api/votes') {
      const body = route.request().postDataJSON()
      const complete=()=>route.fulfill({status:201,json:{poll_id:body.poll_id,counts:{[body.option_id]:1}}})
      if(deferVotes)pendingVotes.push(complete)
      else await complete()
    } else await route.fulfill({json:{status:'updated'}})
  })
  await page.route('**/media/match.mov', route => route.abort())
  await page.goto('/?debugSynthetic=1')
  await expect(page.getByRole('button', {name:'Synthetic match',exact:true})).toHaveClass('active')
  await expect(page.locator('.synthetic-stage')).toBeVisible()
  await expect(page.locator('.status')).toHaveText('Connected')
  await page.clock.pauseAt(new Date('2026-10-24T00:00:05Z'))
  await page.getByRole('button', {name:'Playback speed'}).click()
  await page.getByRole('button', {name:'Playback speed'}).click()
  return {submissions,enrich,errors,pendingVotes}
}

async function seek(page: Page, time: number) {
  await page.getByRole('slider', {name:'Match position'}).evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', {bubbles:true}))
    input.dispatchEvent(new Event('change', {bubbles:true}))
  }, time)
}

test('delayed insight and vote stay on the held play, then clear exactly at the next phase', async ({page}, testInfo) => {
  const {submissions,enrich,errors} = await syntheticPage(page)
  await page.evaluate(() => {
    const samples: {clock:number;event:string;ball:{x:number;y:number};players:{id:string;x:number;y:number}[]}[] = []
    Object.assign(window, {syntheticSamples:samples})
    const sample = () => {
      const stage = document.querySelector<HTMLElement>('.synthetic-stage')
      const ball = document.querySelector<SVGElement>('.synthetic-ball')
      if (stage && ball) samples.push({clock:+stage.dataset.clock!,event:stage.dataset.eventId!,ball:{x:+ball.dataset.x!,y:+ball.dataset.y!},players:[...document.querySelectorAll<SVGElement>('[data-player-id]')].map(player => ({id:player.dataset.playerId!,x:+player.dataset.x!,y:+player.dataset.y!}))})
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  await page.clock.runFor(3500)
  await expect.poll(() => submissions.length).toBe(1)
  await expect(page.locator('.insight-origin')).toContainText(submissions[0].event_label)
  await page.clock.runFor(3000)
  const held = await page.locator('.synthetic-ball').getAttribute('transform')
  expect(Number(await page.locator('.synthetic-stage').getAttribute('data-clock'))).toBe(18)
  await page.clock.runFor(1000)
  expect(await page.locator('.synthetic-ball').getAttribute('transform')).toBe(held)
  enrich(submissions[0])
  await expect(page.locator('.poll-card h3')).toContainText(submissions[0].event_label)
  await page.clock.runFor(1000)
  await page.locator('.poll-card .options button').first().click()
  await expect(page.locator('.vote-meta')).toContainText('1 live vote')
  await page.clock.runFor(250)
  await page.screenshot({path:testInfo.outputPath('synthetic-moment.png'),fullPage:true})
  await page.clock.runFor(4250)
  expect(Number(await page.locator('.synthetic-stage').getAttribute('data-clock'))).toBe(18)
  await page.clock.runFor(3000)
  await expect(page.locator('.synthetic-stage')).toHaveAttribute('data-event-id','green-touchline-recovery')
  await expect(page.locator('.poll-card')).toHaveCount(0)
  await expect(page.locator('.observation-card')).toHaveCount(0)
  // Deliberately redeliver the first play's result after its phase ended.
  enrich(submissions[0])
  await page.clock.runFor(1000)
  await expect.poll(() => submissions.length).toBe(2)
  await expect(page.locator('.insight-origin')).toContainText(submissions[1].event_label)
  await expect(page.locator('.poll-card')).toHaveCount(0)
  enrich(submissions[1])
  await expect(page.locator('.poll-card h3')).toContainText(submissions[1].event_label)
  const discontinuities = await page.evaluate(() => {
    const {syntheticSamples:samples} = window as unknown as {syntheticSamples:{clock:number;event:string;ball:{x:number;y:number};players:{id:string;x:number;y:number}[]}[]}
    const failures: string[] = []
    for (let i = 1; i < samples.length; i++) {
      const a=samples[i-1],b=samples[i],dt=b.clock-a.clock
      if (dt < 0) failures.push(`clock rewound: ${a.clock} -> ${b.clock}`)
      if (dt <= 0) continue
      if (Math.hypot(a.ball.x-b.ball.x,a.ball.y-b.ball.y)>32*dt+.02) failures.push(`ball jumped at ${b.clock}`)
      b.players.forEach((player,index) => {
        if(Math.hypot(player.x-a.players[index].x,player.y-a.players[index].y)>9.5*dt+.02) failures.push(`${player.id} jumped at ${b.clock}`)
      })
    }
    return failures
  })
  expect(discontinuities).toEqual([])
  expect(errors).toEqual([])
})

test('pause accepts the pending result, resume does not duplicate it, and seek rejects the old play', async ({page}) => {
  const {submissions,enrich,errors} = await syntheticPage(page)
  await seek(page,11.8)
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  await page.clock.runFor(1000)
  await expect.poll(() => submissions.length).toBe(1)
  await page.getByRole('button', {name:'Pause match',exact:true}).first().click()
  const paused = await page.locator('.synthetic-stage').getAttribute('data-clock')
  enrich(submissions[0])
  await expect(page.locator('.poll-card')).toHaveCount(1)
  await page.clock.runFor(2000)
  expect(await page.locator('.synthetic-stage').getAttribute('data-clock')).toBe(paused)
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  await page.clock.runFor(1000)
  expect(submissions).toHaveLength(1)
  await seek(page,48)
  await expect(page.locator('.poll-card')).toHaveCount(0)
  enrich(submissions[0])
  await page.clock.runFor(5000)
  await expect(page.locator('.synthetic-stage')).toHaveAttribute('data-event-id','green-left-progression')
  await expect(page.locator('.poll-card')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('final play and end-of-match retain the final scene', async ({page}, testInfo) => {
  const {submissions,enrich,errors} = await syntheticPage(page)
  await seek(page,220)
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  await page.clock.runFor(1500)
  await expect.poll(() => submissions.length).toBe(1)
  expect(submissions[0].event_id).toBe('green-right-channel')
  enrich(submissions[0])
  await expect(page.locator('.poll-card h3')).toContainText('Green attack the right channel')
  await page.clock.runFor(12_000)
  await expect(page.locator('.synthetic-stage')).toHaveAttribute('data-event-id','green-right-channel')
  await expect(page.locator('.synthetic-stage')).toHaveAttribute('data-clock','240.0000')
  expect(Number(await page.locator('.synthetic-ball').getAttribute('data-x'))).toBe(-24)
  await page.screenshot({path:testInfo.outputPath('synthetic-final.png'),fullPage:true})
  expect(errors).toEqual([])
})

test('a delayed vote response cannot change the next play’s poll or vote counts', async ({page}) => {
  const {submissions,enrich,pendingVotes,errors} = await syntheticPage(page,true)
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  await page.clock.runFor(3500)
  await expect.poll(() => submissions.length).toBe(1)
  enrich(submissions[0])
  await expect(page.locator('.poll-card')).toHaveCount(1)
  await page.clock.runFor(1000)
  await page.locator('.poll-card .options button').first().click()
  await expect.poll(() => pendingVotes.length).toBe(1)
  await page.clock.runFor(10_000)
  await expect.poll(() => submissions.length).toBe(2)
  enrich(submissions[1])
  await expect(page.locator('.poll-origin')).toContainText(submissions[1].event_label)
  await pendingVotes[0]()
  await expect(page.locator('.vote-meta')).toContainText('0 live votes')
  await expect(page.locator('.poll-card .options button').first()).toBeEnabled()
  expect(errors).toEqual([])
})
