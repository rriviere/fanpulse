const startSeconds = Number(process.argv[2] ?? 78)
const runSeconds = Number(process.argv[3] ?? 45)
const playbackRate = Number(process.argv[4] ?? 1)
const pageUrl = process.env.FANPULSE_SMOKE_URL ?? 'http://localhost:5173'

const targets = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json())
const target = targets.find(item => item.type === 'page' && item.url.startsWith(pageUrl))
if (!target) throw new Error('FanPulse Chrome tab was not found on debugging port 9222')

const socket = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let sequence = 0
const browserLogs = []

socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const {resolve, reject} = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const values = message.params.args.map(item => item.value ?? item.description)
    browserLogs.push(values)
    console.log('[browser]', ...values)
  }
}

await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

function command(method, params = {}) {
  const id = ++sequence
  socket.send(JSON.stringify({id, method, params}))
  return new Promise((resolve, reject) => pending.set(id, {resolve, reject}))
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

await command('Runtime.enable')
await evaluate(`(() => {
  const live = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Live vision')
  if (!live) throw new Error('Live vision button not found')
  live.click()
  return true
})()`)
await wait(500)

const started = await evaluate(`(async () => {
  const video = document.querySelector('video')
  if (!video) throw new Error('Video element not found')
  if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, {once:true}))
  video.playbackRate = ${playbackRate}
  video.currentTime = ${startSeconds}
  await new Promise(resolve => video.addEventListener('seeked', resolve, {once:true}))
  await video.play()
  return {currentTime:video.currentTime, paused:video.paused, readyState:video.readyState, duration:video.duration, playbackRate:video.playbackRate}
})()`)
console.log(JSON.stringify({started}))

await wait(8000)
const duringInference = await evaluate(`(() => {
  const video = document.querySelector('video')
  return {currentTime:video.currentTime, paused:video.paused, status:document.querySelector('.analysis-meta')?.textContent}
})()`)
console.log(JSON.stringify({duringInference}))

await wait(Math.max(0, runSeconds * 1000 - 8000))
const beforeVote = await evaluate(`(() => {
  const video = document.querySelector('video')
  return {
    currentTime:video.currentTime,
    paused:video.paused,
    status:document.querySelector('.analysis-meta')?.textContent,
    connected:document.querySelector('.status')?.textContent,
    timeline:[...document.querySelectorAll('.event strong')].map(item => item.textContent),
    pollQuestion:document.querySelector('.poll-card h3')?.textContent ?? null,
    options:[...document.querySelectorAll('.poll-card .options button')].map(item => item.textContent.trim()),
  }
})()`)
console.log(JSON.stringify({beforeVote}))

let afterVote = null
if (beforeVote.pollQuestion) {
  await evaluate(`document.querySelector('.poll-card .options button')?.click()`)
  await wait(1500)
  afterVote = await evaluate(`(() => ({
    selected:document.querySelector('.poll-card .options button.selected')?.textContent.trim() ?? null,
    voteMeta:document.querySelector('.vote-meta')?.textContent.trim() ?? null,
  }))()`)
  console.log(JSON.stringify({afterVote}))
}

const fanPulseLogs = browserLogs.filter(values => String(values[0]).startsWith('[FanPulse]'))
const result = {started, duringInference, beforeVote, afterVote, fanPulseLogCount:fanPulseLogs.length}
console.log('PHASE5_BROWSER_RESULT=' + JSON.stringify(result))

await evaluate(`document.querySelector('video')?.pause()`)
socket.close()

if (started.paused || duringInference.paused || duringInference.currentTime <= started.currentTime + 5) {
  process.exitCode = 1
}
