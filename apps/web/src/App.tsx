import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Bot, ChevronRight, CircleDot, Gauge, Pause, Play, Radio, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Counts, MatchEvent, Poll, SourceMode, ViewerMode, VisionResultMessage } from './types'
import {SyntheticPitch} from './SyntheticPitch'
import {SYNTHETIC_DURATION,SYNTHETIC_EVENTS} from './syntheticMatch'

const ANALYSIS_INTERVAL_SECONDS=10
const POLL_SIGNIFICANCE_THRESHOLD=60
const POLL_VOTING_SECONDS=45
const VOTED_POLL_DISPLAY_SECONDS=5
const viewerId=localStorage.getItem('fanpulse-viewer-id') || crypto.randomUUID()
localStorage.setItem('fanpulse-viewer-id',viewerId)
const analysisSessionId=sessionStorage.getItem('fanpulse-analysis-session') || crypto.randomUUID()
sessionStorage.setItem('fanpulse-analysis-session',analysisSessionId)

function App(){
  const video=useRef<HTMLVideoElement>(null)
  const [clock,setClock]=useState(0), [playing,setPlaying]=useState(false), [rate,setRate]=useState(1)
  const [sourceMode,setSourceMode]=useState<SourceMode>('video')
  const [mode,setMode]=useState<ViewerMode>('casual'), [timeline,setTimeline]=useState<MatchEvent[]>([])
  const [poll,setPoll]=useState<Poll|null>(null), [counts,setCounts]=useState<Counts>({}), [voted,setVoted]=useState<string|null>(null)
  const [pollClock,setPollClock]=useState(0)
  const [connected,setConnected]=useState(false), [videoMissing,setVideoMissing]=useState(false), [duration,setDuration]=useState(0)
  const [analysisStatus,setAnalysisStatus]=useState('paused'), [analysisLatency,setAnalysisLatency]=useState<number|null>(null)
  const [latestResult,setLatestResult]=useState<VisionResultMessage|null>(null)
  const generation=useRef(0), frameBuffer=useRef<{timestamp_seconds:number;data_url:string}[]>([])
  const nextSampleAt=useRef(0), lastWindowEnd=useRef(-1), lastStateSecond=useRef(-1), pollId=useRef<string|null>(null)
  const animationFrame=useRef(0), syntheticStartedAt=useRef(0), syntheticStartClock=useRef(0), clockRef=useRef(0), submittedEvents=useRef(new Set<number>())

  const applyVisionResult=useCallback((message:VisionResultMessage)=>{
    const id=`vision-${message.generation}-${message.window.end_seconds}`
    if(!['vision-direct','synthetic-direct'].includes(message.provider.agent)){
      if(message.insight.publish_insight&&message.insight.significance>=POLL_SIGNIFICANCE_THRESHOLD&&message.insight.poll){
        setPoll({id:`poll-${id}`,eventId:id,question:message.insight.poll.question,options:message.insight.poll.options,significance:message.insight.significance,reason:message.insight.explanation,agentTrace:[`Vision model · ${message.latency.vision_ms}ms`,`Match Analyst · ${message.latency.match_analyst_ms}ms`,`Fan Engagement · ${message.latency.fan_engagement_ms}ms`,'Policy · 60+ significance and dedup passed',`WebSocket · delivered · ${message.latency.total_ms}ms`],expiresAt:Date.now()+POLL_VOTING_SECONDS*1000});setPollClock(Date.now());setVoted(null);setCounts({})
      }
      return
    }
    setLatestResult(message);setAnalysisLatency(message.latency.total_ms);setAnalysisStatus('published')
    if(!message.insight.publish_insight){
      return
    }
    const event:MatchEvent={id,matchSecond:Math.round(message.window.end_seconds),videoSecond:message.window.end_seconds,type:message.observation.event_type,title:message.insight.headline,detail:message.insight.explanation,candidate:message.insight.significance>=POLL_SIGNIFICANCE_THRESHOLD}
    setTimeline(previous=>[event,...previous.filter(item=>item.id!==id)].slice(0,7))
  },[])

  useEffect(()=>{pollId.current=poll?.id||null},[poll?.id])
  useEffect(()=>{clockRef.current=clock},[clock])
  useEffect(()=>{
    if(!poll||voted)return
    const update=()=>{
      const now=Date.now();setPollClock(now)
      if(now>=poll.expiresAt)setPoll(current=>current?.id===poll.id?null:current)
    }
    update()
    const timer=window.setInterval(update,250)
    return()=>window.clearInterval(timer)
  },[poll,voted])
  useEffect(()=>{
    if(!poll||!voted)return
    const pollIdToClear=poll.id
    const timer=window.setTimeout(()=>{
      if(pollId.current!==pollIdToClear)return
      setPoll(null);setVoted(null);setCounts({})
    },VOTED_POLL_DISPLAY_SECONDS*1000)
    return()=>window.clearTimeout(timer)
  },[poll,voted])
  useEffect(()=>{
    const protocol=location.protocol==='https:'?'wss':'ws'
    let disposed=false,ws:WebSocket|undefined,reconnectTimer:number|undefined
    const connect=()=>{
      ws=new WebSocket(`${protocol}://${location.host}/ws`)
      ws.onopen=()=>{console.info('[FanPulse] WebSocket connected');setConnected(true)}
      ws.onclose=()=>{console.info('[FanPulse] WebSocket disconnected');setConnected(false);if(!disposed)reconnectTimer=window.setTimeout(connect,1500)}
      ws.onerror=()=>console.error('[FanPulse] WebSocket transport error')
      ws.onmessage=event=>{
        try{
          const message=JSON.parse(event.data)
          console.info('[FanPulse] WebSocket message',{type:message.type,generation:message.generation,session:message.session_id})
          if(message.type==='vote_results'&&message.poll_id===pollId.current)setCounts(message.counts)
          if(message.session_id!==analysisSessionId||message.generation!==generation.current)return
          if(message.type==='analysis_status'){
            setAnalysisStatus(message.status)
            if(message.status==='error')console.error('[FanPulse] analysis error',message.message)
          }
          if(message.type==='vision_result')applyVisionResult(message as VisionResultMessage)
        }catch(error){console.error('[FanPulse] invalid WebSocket message',error)}
      }
    }
    connect()
    return()=>{disposed=true;if(reconnectTimer)window.clearTimeout(reconnectTimer);ws?.close()}
  },[applyVisionResult])

  const postPlaybackState=useCallback(async (isPlaying:boolean,position:number)=>{
    try{
      const response=await fetch(`/api/analysis/sessions/${analysisSessionId}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generation:generation.current,playing:isPlaying,position_seconds:position})})
      if(!response.ok)throw new Error(`playback state rejected (${response.status})`)
    }catch(error){console.error('[FanPulse] playback state error',error);setAnalysisStatus('offline')}
  },[])

  const resetAnalysis=useCallback((position:number,isPlaying:boolean)=>{
    generation.current+=1;frameBuffer.current=[];nextSampleAt.current=Math.floor(position);lastWindowEnd.current=-1;lastStateSecond.current=-1
    setAnalysisStatus(isPlaying?'sampling':'paused');setAnalysisLatency(null)
    void postPlaybackState(isPlaying,position)
  },[postPlaybackState])

  useEffect(()=>{
    if(sourceMode!=='video'||!playing||videoMissing||!video.current)return
    const element=video.current,second=Math.floor(clock)
    if(second!==lastStateSecond.current){lastStateSecond.current=second;void postPlaybackState(true,clock)}
    if(clock+.05<nextSampleAt.current)return
    const canvas=document.createElement('canvas'),width=Math.min(768,element.videoWidth||768)
    if(!element.videoWidth||!element.videoHeight)return
    canvas.width=width;canvas.height=Math.round(element.videoHeight*width/element.videoWidth)
    canvas.getContext('2d')?.drawImage(element,0,0,canvas.width,canvas.height)
    const frame={timestamp_seconds:+clock.toFixed(3),data_url:canvas.toDataURL('image/jpeg',.7)}
    frameBuffer.current=[...frameBuffer.current,frame].slice(-5);nextSampleAt.current=second+1
    const frames=frameBuffer.current,end=frames.at(-1)?.timestamp_seconds??0
    if(frames.length===5&&end-lastWindowEnd.current>=ANALYSIS_INTERVAL_SECONDS-.5){
      lastWindowEnd.current=end;setAnalysisStatus('queued')
      const submittedGeneration=generation.current
      console.info('[FanPulse] frames submitted',{generation:submittedGeneration,start:frames[0].timestamp_seconds,end,frames:frames.length})
      void fetch(`/api/analysis/sessions/${analysisSessionId}/windows`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generation:submittedGeneration,viewer_mode:mode,frames})})
        .then(async response=>{if(!response.ok)throw new Error(`frame window rejected (${response.status}): ${await response.text()}`);console.info('[FanPulse] frame window accepted',await response.json())})
        .catch(error=>{console.error('[FanPulse] frame submission error',error);setAnalysisStatus('offline')})
    }
  },[clock,mode,playing,postPlaybackState,sourceMode,videoMissing])

  useEffect(()=>{
    if(sourceMode!=='synthetic'||!playing)return
    syntheticStartedAt.current=performance.now();syntheticStartClock.current=clockRef.current
    const tick=(now:number)=>{
      const next=Math.min(SYNTHETIC_DURATION,syntheticStartClock.current+(now-syntheticStartedAt.current)/1000*rate)
      setClock(next)
      const second=Math.floor(next)
      if(second!==lastStateSecond.current){lastStateSecond.current=second;void postPlaybackState(true,next)}
      for(const item of SYNTHETIC_EVENTS){
        if(next>=item.time&&!submittedEvents.current.has(item.time)){
          submittedEvents.current.add(item.time);setAnalysisStatus('queued')
          void fetch(`/api/analysis/sessions/${analysisSessionId}/synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generation:generation.current,viewer_mode:mode,observation:item.observation})})
            .then(async response=>{if(!response.ok)throw new Error(`synthetic event rejected (${response.status}): ${await response.text()}`)})
            .catch(error=>{console.error('[FanPulse] synthetic submission error',error);setAnalysisStatus('offline')})
        }
      }
      if(next>=SYNTHETIC_DURATION){setPlaying(false);void postPlaybackState(false,next);return}
      animationFrame.current=requestAnimationFrame(tick)
    }
    animationFrame.current=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(animationFrame.current)
  },[mode,playing,postPlaybackState,rate,sourceMode])

  async function vote(optionId:string){
    if(voted||!poll||Date.now()>=poll.expiresAt){setPoll(null);return}
    setVoted(optionId)
    try{
      const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poll_id:poll.id,option_id:optionId,viewer_id:viewerId})})
      if(!response.ok)throw Error(`vote rejected (${response.status})`)
      setCounts((await response.json()).counts);console.info('[FanPulse] vote recorded',{poll:poll.id,option:optionId})
    }catch(error){console.error('[FanPulse] vote error',error);setVoted(null)}
  }

  function reset(){
    video.current?.pause();if(video.current)video.current.currentTime=0
    submittedEvents.current.clear();setClock(0);setPlaying(false);setTimeline([]);setPoll(null);setLatestResult(null);setVoted(null);setCounts({});resetAnalysis(0,false)
  }
  function toggle(){
    if(sourceMode==='synthetic'){const next=!playing;setPlaying(next);setAnalysisStatus(next?'sampling':'paused');void postPlaybackState(next,clock);return}
    if(!videoMissing&&video.current){if(video.current.paused)void video.current.play();else video.current.pause()}
  }
  function switchSource(next:SourceMode){if(next===sourceMode)return;video.current?.pause();setSourceMode(next);setDuration(next==='synthetic'?SYNTHETIC_DURATION:video.current?.duration||0);reset()}
  const total=Object.values(counts).reduce((sum,count)=>sum+count,0)
  const pollSecondsRemaining=poll?Math.max(0,Math.ceil((poll.expiresAt-pollClock)/1000)):0
  const time=useMemo(()=>`${Math.floor(clock/60).toString().padStart(2,'0')}:${Math.floor(clock%60).toString().padStart(2,'0')}`,[clock])

  return <main>
    <header><div className="brand"><div className="mark"><Sparkles size={17}/></div><div><strong>FANPULSE</strong><span>Your Voice in the Game</span></div></div><div className="header-actions"><div className="source-switch"><button className={sourceMode==='video'?'active':''} onClick={()=>switchSource('video')}>Video</button><button className={sourceMode==='synthetic'?'active':''} onClick={()=>switchSource('synthetic')}>Synthetic match</button></div><span className="live"><i/> AI ACTIVE</span><div className="mode"><button className={mode==='casual'?'active':''} onClick={()=>setMode('casual')}>Casual</button><button className={mode==='analyst'?'active':''} onClick={()=>setMode('analyst')}>Tactical</button></div></div></header>
    <section className="scorebar"><div className="team"><b className="green-crest">G</b><span>Green United</span></div><div className="score"><strong>0 <em>—</em> 0</strong><span>{time} · {sourceMode==='synthetic'?'SYNTHETIC EVENT OBSERVATIONS':'VISION-DERIVED OBSERVATIONS'}</span></div><div className="team away"><span>Black FC</span><b className="black-crest">B</b></div></section>
    <div className="layout">
      <section className="viewer">
        <div className="video-shell">
          {sourceMode==='video'
            ?<video ref={video} src="/media/match.mov" playsInline onLoadedMetadata={event=>{setDuration(event.currentTarget.duration);console.info('[FanPulse] video loaded',{duration:event.currentTarget.duration,width:event.currentTarget.videoWidth,height:event.currentTarget.videoHeight})}} onTimeUpdate={event=>setClock(event.currentTarget.currentTime)} onPlay={event=>{setPlaying(true);setAnalysisStatus('sampling');void postPlaybackState(true,event.currentTarget.currentTime)}} onPause={event=>{setPlaying(false);resetAnalysis(event.currentTarget.currentTime,false)}} onSeeked={event=>resetAnalysis(event.currentTarget.currentTime,!event.currentTarget.paused)} onError={()=>{setVideoMissing(true);setAnalysisStatus('video unavailable')}} />
            :<SyntheticPitch clock={clock}/>}
          {sourceMode==='video'&&videoMissing&&<div className="placeholder"><div><Radio/><strong>VIDEO UNAVAILABLE</strong><p>Add the licensed recording at <code>apps/web/public/media/match.mov</code>.</p></div></div>}
          <div className="broadcast-badge"><CircleDot size={13}/> {sourceMode==='synthetic'?'SYNTHETIC · FIXED SEED':'VISION · REAL FRAMES'}</div>
          <AnimatePresence>{poll&&!voted&&<motion.div className="moment-toast" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Sparkles/><div><span>AI MOMENT DETECTED</span><strong>{poll.significance}% significance</strong></div><ChevronRight/></motion.div>}</AnimatePresence>
          <div className="controls"><button onClick={toggle} disabled={sourceMode==='video'&&videoMissing}>{playing?<Pause/>:<Play/>}</button><div className="progress"><input aria-label="Match position" type="range" min="0" max={duration||1} value={clock} disabled={sourceMode==='video'&&videoMissing} onChange={event=>{const position=+event.target.value;setClock(position);clockRef.current=position;syntheticStartClock.current=position;syntheticStartedAt.current=performance.now();submittedEvents.current=new Set(SYNTHETIC_EVENTS.filter(item=>item.time<position).map(item=>item.time));if(video.current)video.current.currentTime=position;resetAnalysis(position,playing)}}/><span style={{width:`${duration?clock/duration*100:0}%`}}/></div><span>{time}</span><button className="rate" onClick={()=>{const next=rate===4?1:rate*2;setRate(next);if(video.current)video.current.playbackRate=next}}>{rate}×</button></div>
        </div>
        <div className="under-video"><div><button className="primary" onClick={toggle} disabled={sourceMode==='video'&&videoMissing}>{playing?<><Pause/> Pause match</>:<><Play/> {sourceMode==='synthetic'?'Play synthetic match':'Play with vision'}</>}</button><button onClick={reset}><RefreshCw/> Restart</button></div></div>
        <Timeline items={timeline} sourceMode={sourceMode}/>
      </section>
      <aside>
        <div className="panel-heading"><div><span className="eyebrow"><Bot/> FOUNDRY AGENT TEAM</span><h2>Live intelligence</h2><small className="analysis-meta">{analysisStatus}{analysisLatency!==null?` · ${(analysisLatency/1000).toFixed(1)}s`:''}</small></div><span className={connected?'status connected':'status'}>{connected?'Connected':'Disconnected'}</span></div>
        <div className="intelligence-stack">
          <AnimatePresence mode="wait">{latestResult?<ObservationCard key={`${latestResult.generation}-${latestResult.window.end_seconds}`} result={latestResult}/>:<EmptyState/>}</AnimatePresence>
          <AnimatePresence>{poll&&<PollCard key={poll.id+mode} poll={poll} counts={counts} total={total} voted={voted} secondsRemaining={pollSecondsRemaining} vote={vote}/>}</AnimatePresence>
        </div>
      </aside>
    </div>
    <footer><span><ShieldCheck/> {sourceMode==='synthetic'?'Synthetic events are fictional and deterministic; insights are generated by Foundry agents.':'Vision observations are AI-generated from visible frames and may be incomplete.'}</span><span>{sourceMode==='synthetic'?'SYNTHETIC MATCH · REAL FOUNDRY AGENTS':'REAL VIDEO · REAL FOUNDRY INFERENCE'}</span></footer>
  </main>
}

function PollCard({poll,counts,total,voted,secondsRemaining,vote}:{poll:Poll;counts:Counts;total:number;voted:string|null;secondsRemaining:number;vote:(id:string)=>void}){
  return <motion.div className="poll-card significant-poll" initial={{opacity:0,y:24,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:.98}} transition={{type:'spring',stiffness:260,damping:22}}><div className="poll-glow" aria-hidden="true"/><div className="signal"><span className="signal-icon"><Sparkles/></span><span>SIGNIFICANT MOMENT · FAN VOTE</span></div><div className={voted?'poll-timer voted':'poll-timer'}><span>{voted?'VOTE SUBMITTED':'VOTING CLOSES IN'}</span><strong>{voted?'✓':`${secondsRemaining}s`}</strong></div><h3>{poll.question}</h3><p className="reason">{poll.reason}</p><div className="options">{poll.options.map(option=>{const count=counts[option.id]||0,pct=total?Math.round(count/total*100):0;return <button disabled={!!voted} className={voted===option.id?'selected':''} onClick={()=>vote(option.id)} key={option.id}><span className="fill" style={{width:voted?`${pct}%`:'0'}}/><span>{option.label}</span>{voted&&<b>{pct}%</b>}</button>})}</div><div className="vote-meta"><span><Users/> {total} live {total===1?'vote':'votes'}</span><span>One vote per viewer</span></div></motion.div>
}
function EmptyState(){return <motion.div className="empty" initial={{opacity:0}} animate={{opacity:1}}><div><Gauge/><i/></div><h3>Watching the match</h3><p>Foundry vision, Match Analyst, and Fan Engagement are looking for grounded, meaningful moments. Routine play is shown with its reason instead of becoming a poll.</p></motion.div>}
function ObservationCard({result}:{result:VisionResultMessage}){const synthetic=result.provider.agent==='synthetic-direct';return <motion.div className="observation-card" initial={{opacity:0,x:18}} animate={{opacity:1,x:0}}><div className="observation-state published"><Activity/><span>INSIGHT PUBLISHED</span><b className={`confidence-level ${result.observation.confidence}`}>{result.observation.confidence.toUpperCase()} CONFIDENCE</b></div><h3>{result.observation.description}</h3><p>{result.observation.evidence}</p><dl><div><dt>Visible event</dt><dd>{result.observation.event_type.replaceAll('_',' ')}</dd></div><div><dt>Evidence</dt><dd>{result.observation.confidence} confidence · {result.observation.evidence_basis.replaceAll('_',' ')}</dd></div><div><dt>Decision</dt><dd>{synthetic?'Synthetic observation adapter':'Vision direct'}</dd></div></dl></motion.div>}
function Timeline({items,sourceMode}:{items:MatchEvent[];sourceMode:SourceMode}){return <section className="timeline"><div className="timeline-title"><span>Match timeline</span><small>{sourceMode==='synthetic'?'SYNTHETIC EVENT OBSERVATIONS':'VISION OBSERVATIONS'}</small></div><div className="event-list">{items.length?items.map(event=><motion.div initial={{opacity:0}} animate={{opacity:1}} className="event" key={event.id}><time>{Math.floor(event.matchSecond/60).toString().padStart(2,'0')}:{(event.matchSecond%60).toString().padStart(2,'0')}</time><i className={event.candidate?'hot':''}/><div><strong>{event.title}</strong><span>{event.detail}</span></div></motion.div>):<p className="waiting">Play the {sourceMode==='synthetic'?'synthetic match':'video'} to begin Foundry analysis.</p>}</div></section>}
export default App
