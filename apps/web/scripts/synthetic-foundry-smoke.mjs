import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'

// Explicit manual real-service test. Never part of npm test or CI: at most two
// observations can reach the API, regardless of how quickly the browser plays.
const browser = await chromium.launch({channel:'chrome'})
const page = await browser.newPage({viewport:{width:1600,height:1050}})
const output = new URL('../../../.cache/synthetic-preview/', import.meta.url)
await mkdir(output, {recursive:true})
const submissions = []
const results = []
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/analysis/sessions/*/synthetic', async route => {
  if (submissions.length >= 2) return route.fulfill({status:503,json:{detail:'Manual smoke test request cap reached'}})
  submissions.push(route.request().postDataJSON())
  return route.continue()
})

try {
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button', {name:'Synthetic match',exact:true}).click()
  await page.getByRole('button', {name:'Playback speed'}).click()
  await page.getByRole('button', {name:'Playback speed'}).click()
  await page.getByRole('button', {name:'Play synthetic match'}).click()
  for (const [index,eventId] of ['black-right-progression','green-touchline-recovery'].entries()) {
    await page.waitForFunction(id => {
      const stage = document.querySelector('.synthetic-stage')
      const state = document.querySelector('.observation-state span')?.textContent
      return stage?.getAttribute('data-event-id') === id && state && state !== 'MOMENT DETECTED'
    }, eventId, {timeout:45_000})
    results.push(await page.evaluate(() => ({
      eventId:document.querySelector('.synthetic-stage')?.getAttribute('data-event-id'),
      clock:document.querySelector('.synthetic-stage')?.getAttribute('data-clock'),
      origin:document.querySelector('.insight-origin')?.textContent,
      decision:document.querySelector('.observation-state span')?.textContent,
      latency:document.querySelector('.analysis-meta')?.textContent,
      poll:document.querySelector('.poll-origin')?.textContent ?? null,
      connected:document.querySelector('.status')?.textContent,
    })))
    await page.screenshot({path:new URL(`moment-${index+1}.png`,output).pathname,fullPage:true})
  }
  await page.getByRole('button', {name:'Pause match',exact:true}).first().click()
  console.log(JSON.stringify({submissions:submissions.map(item => item.event_id),results,errors},null,2))
  if (submissions.length !== 2 || results.length !== 2 || errors.length) process.exitCode=1
} finally {
  await browser.close()
}
