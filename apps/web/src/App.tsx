import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Bot, ChevronRight, CircleDot, Gauge, Pause, Play, Radio, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Counts, MatchEvent, Poll, SourceMode, ViewerMode, VisionResultMessage } from './types'
import {SyntheticPitch} from './SyntheticPitch'
import {eventAt,loadSyntheticMatch, type SyntheticMatch} from './syntheticMatch'
import {SyntheticPlayback} from './syntheticPlayback'

const ANALYSIS_INTERVAL_SECONDS=10
const POLL_SIGNIFICANCE_THRESHOLD=60
const POLL_VOTING_SECONDS=45
const VOTED_POLL_DISPLAY_SECONDS=5
const viewerId=localStorage.getItem('fanpulse-viewer-id') || crypto.randomUUID()
localStorage.setItem('fanpulse-viewer-id',viewerId)
// Refreshing starts a new playback session instead of reusing an older generation.
const analysisSessionId=crypto.randomUUID()
sessionStorage.setItem('fanpulse-analysis-session',analysisSessionId)
const debugSynthetic=new URLSearchParams(location.search).has('debugSynthetic')

function App(){
  const video=useRef<HTMLVideoElement>(null)
  const videoNotice=useRef<HTMLDialogElement>(null)
  const [clock,setClock]=useState(0), [playing,setPlaying]=useState(false), [rate,setRate]=useState(1)
  const [sourceMode,setSourceMode]=useState<SourceMode>('synthetic')
  const [mode,setMode]=useState<ViewerMode>('casual'), [timeline,setTimeline]=useState<MatchEvent[]>([])
  const [poll,setPoll]=useState<Poll|null>(null), [counts,setCounts]=useState<Counts>({}), [voted,setVoted]=useState<string|null>(null)
  const [pollClock,setPollClock]=useState(0)
  const [connected,setConnected]=useState(false), [videoMissing,setVideoMissing]=useState(false), [duration,setDuration]=useState(0)
  const [analysisStatus,setAnalysisStatus]=useState('paused'), [analysisLatency,setAnalysisLatency]=useState<number|null>(null)
  const [latestResult,setLatestResult]=useState<VisionResultMessage|null>(null)
  const [syntheticMatch,setSyntheticMatch]=useState<SyntheticMatch|null>(null), [syntheticError,setSyntheticError]=useState<string|null>(null)
  const [syntheticHold,setSyntheticHold]=useState<string|null>(null)
  const [syntheticDiagnostics,setSyntheticDiagnostics]=useState<Record<string,unknown>>({})
  const generation=useRef(0), frameBuffer=useRef<{timestamp_seconds:number;data_url:string}[]>([])
  const nextSampleAt=useRef(0), lastWindowEnd=useRef(-1), lastStateSecond=useRef(-1), pollId=useRef<string|null>(null)
  const animationFrame=useRef(0), syntheticPlayback=useRef<SyntheticPlayback|null>(null), displayedSyntheticEvent=useRef<string|null>(null)
  const playbackStateChain=useRef<Promise<boolean>>(Promise.resolve(true))

  useEffect(()=>{
    const controller=new AbortController()
    void loadSyntheticMatch(controller.signal).then(match=>{
      syntheticPlayback.current=new SyntheticPlayback(match)
      setSyntheticMatch(match)
    }).catch(error=>{
      if(!controller.signal.aborted)setSyntheticError(error instanceof Error?error.message:'Match data could not be loaded')
    })
    return()=>controller.abort()
  },[])

  const applyVisionResult=useCallback((message:VisionResultMessage)=>{
    const syntheticEvent=message.synthetic_event??null
    if(syntheticEvent&&!syntheticPlayback.current?.isCurrent(syntheticEvent.id,message.generation)){
      console.info('[FanPulse] synthetic result discarded',{event:syntheticEvent.id})
      return
    }
    const id=syntheticEvent?`synthetic-${message.generation}-${syntheticEvent.id}`:`vision-${message.generation}-${message.window.end_seconds}`
    if(!['vision-direct','synthetic-direct'].includes(message.provider.agent)){
      if(syntheticEvent){
        syntheticPlayback.current?.receiveResult(syntheticEvent.id,message.generation,performance.now())
        setLatestResult(message);setAnalysisLatency(message.latency.total_ms);setAnalysisStatus('published')
        if(message.insight.publish_insight){
          const event:MatchEvent={id,matchSecond:Math.round(syntheticEvent.timestamp_seconds),videoSecond:syntheticEvent.timestamp_seconds,type:message.observation.event_type,title:message.insight.headline,detail:message.insight.explanation,candidate:message.insight.significance>=POLL_SIGNIFICANCE_THRESHOLD}
          setTimeline(previous=>[event,...previous.filter(item=>item.id!==id)].slice(0,7))
        }
      }
      if(message.insight.publish_insight&&message.insight.significance>=POLL_SIGNIFICANCE_THRESHOLD&&message.insight.poll){
        pollId.current=`poll-${id}`
        setPoll({id:`poll-${id}`,eventId:id,eventLabel:syntheticEvent?.label,eventTimestamp:syntheticEvent?.timestamp_seconds,question:message.insight.poll.question,options:message.insight.poll.options,significance:message.insight.significance,reason:message.insight.explanation,agentTrace:[`${syntheticEvent?'Synthetic event adapter':'Vision model'} · ${message.latency.vision_ms}ms`,`Match Analyst · ${message.latency.match_analyst_ms}ms`,`Fan Engagement · ${message.latency.fan_engagement_ms}ms`,'Policy · 60+ significance and dedup passed',`WebSocket · delivered · ${message.latency.total_ms}ms`],expiresAt:Date.now()+POLL_VOTING_SECONDS*1000});setPollClock(Date.now());setVoted(null);setCounts({})
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
      ws.onopen=()=>{if(disposed)return;console.info('[FanPulse] WebSocket connected');setConnected(true)}
      ws.onclose=()=>{
        if(disposed)return
        console.info('[FanPulse] WebSocket disconnected');setConnected(false)
        const pending=syntheticPlayback.current?.pending
        if(pending)syntheticPlayback.current?.failRequest(pending.eventId,pending.generation)
        reconnectTimer=window.setTimeout(connect,1500)
      }
      ws.onerror=()=>console.error('[FanPulse] WebSocket transport error')
      ws.onmessage=event=>{
        try{
          const message=JSON.parse(event.data)
          console.info('[FanPulse] WebSocket message',{type:message.type,generation:message.generation,session:message.session_id})
          if(message.type==='vote_results'&&message.poll_id===pollId.current)setCounts(message.counts)
          if(message.session_id!==analysisSessionId)return
          // Completion also releases requests from an old seek/restart generation.
          if(message.type==='synthetic_complete'){
            if(message.outcome==='complete')syntheticPlayback.current?.finishRequest(message.event_id,message.generation)
            else syntheticPlayback.current?.failRequest(message.event_id,message.generation)
          }
          if(message.generation!==generation.current)return
          if(message.type==='analysis_status'){
            if(message.event_id&&!syntheticPlayback.current?.isCurrent(message.event_id,message.generation))return
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

  const postPlaybackState=useCallback((isPlaying:boolean,position:number,submittedGeneration=generation.current)=>{
    const body=JSON.stringify({generation:submittedGeneration,playing:isPlaying,position_seconds:position})
    // Preserve ordering when pause/seek races an already posted clock update.
    const request=playbackStateChain.current.then(async()=>{
      try{
        const response=await fetch(`/api/analysis/sessions/${analysisSessionId}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(5000)})
        if(!response.ok)throw new Error(`playback state rejected (${response.status})`)
        return true
      }catch(error){
        console.error('[FanPulse] playback state error',error)
        if(submittedGeneration===generation.current)setAnalysisStatus('offline')
        return false
      }
    })
    playbackStateChain.current=request
    return request
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
    const playback=syntheticPlayback.current
    if(sourceMode!=='synthetic'||!playing||!playback)return
    const tick=(now:number)=>{
      const step=playback.advance(now,rate,generation.current),next=step.clock
      if(displayedSyntheticEvent.current!==step.event.id){
        displayedSyntheticEvent.current=step.event.id
        pollId.current=null
        setLatestResult(null);setPoll(null);setVoted(null);setCounts({});setAnalysisLatency(null);setAnalysisStatus('watching the play')
      }
      setClock(next)
      if(debugSynthetic)setSyntheticDiagnostics({clock:+next.toFixed(3),event:step.event.id,request:playback.pending,generation:generation.current})
      setSyntheticHold(step.waiting?(step.resultReady?'Moment held for your insight and vote':'Analysing this play…'):null)
      if(step.timedOut)setAnalysisStatus('analysis delayed · continuing')
      if(step.failed)setAnalysisStatus('analysis unavailable · continuing')
      const second=Math.floor(next)
      if(second!==lastStateSecond.current){lastStateSecond.current=second;void postPlaybackState(true,next)}
      const item=step.submission
      if(item){
        const submittedGeneration=generation.current
        setAnalysisStatus('queued')
        void (async()=>{
          // Establish this generation/position before submitting its observation.
          if(!await postPlaybackState(true,next,submittedGeneration))throw new Error('Playback state is unavailable')
          if(submittedGeneration!==generation.current){playback.failRequest(item.id,submittedGeneration);return}
          const response=await fetch(`/api/analysis/sessions/${analysisSessionId}/synthetic`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generation:submittedGeneration,viewer_mode:mode,event_id:item.id,event_label:item.label,observation:item.observation})})
          if(!response.ok)throw new Error(`synthetic event rejected (${response.status})`)
          const accepted=await response.json()
          if(accepted.status==='ignored')throw new Error(`synthetic event ignored (${accepted.reason})`)
        })().catch(error=>{
          console.error('[FanPulse] synthetic submission error',error)
          playback.failRequest(item.id,submittedGeneration)
        })
      }
      if(next>=playback.match.duration){setPlaying(false);void postPlaybackState(false,next);return}
      animationFrame.current=requestAnimationFrame(tick)
    }
    animationFrame.current=requestAnimationFrame(tick)
    return()=>{cancelAnimationFrame(animationFrame.current);playback.pause()}
  },[mode,playing,postPlaybackState,rate,sourceMode,syntheticMatch])

  async function vote(optionId:string){
    if(voted||!poll||Date.now()>=poll.expiresAt){setPoll(null);return}
    const submittedPollId=poll.id
    setVoted(optionId)
    try{
      const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poll_id:poll.id,option_id:optionId,viewer_id:viewerId})})
      if(!response.ok)throw Error(`vote rejected (${response.status})`)
      const result=await response.json()
      if(pollId.current===submittedPollId)setCounts(result.counts)
      console.info('[FanPulse] vote recorded',{poll:submittedPollId,option:optionId})
    }catch(error){console.error('[FanPulse] vote error',error);if(pollId.current===submittedPollId)setVoted(null)}
  }

  function reset(){
    pollId.current=null
    video.current?.pause();if(video.current)video.current.currentTime=0
    syntheticPlayback.current?.seek(0);displayedSyntheticEvent.current=null;setSyntheticHold(null);setClock(0);setPlaying(false);setTimeline([]);setPoll(null);setLatestResult(null);setVoted(null);setCounts({});resetAnalysis(0,false)
  }
  function toggle(){
    if(sourceMode==='synthetic'){
      if(playing){
        syntheticPlayback.current?.pause();setPlaying(false);setAnalysisStatus('paused');void postPlaybackState(false,clock)
      }else if(syntheticMatch){
        if(clock>=syntheticMatch.duration){reset();setPlaying(true);void postPlaybackState(true,0)}
        else{setPlaying(true);setAnalysisStatus('watching the play');void postPlaybackState(true,clock)}
      }
      return
    }
    if(!videoMissing&&video.current){if(video.current.paused)void video.current.play();else video.current.pause()}
  }
  function switchSource(next:SourceMode){if(next===sourceMode)return;video.current?.pause();setSourceMode(next);setDuration(next==='synthetic'?syntheticMatch?.duration??0:video.current?.duration||0);reset()}
  function seekTo(position:number){
    pollId.current=null
    setClock(position);setLatestResult(null);setPoll(null);setVoted(null);setCounts({});setSyntheticHold(null)
    if(sourceMode==='synthetic'){syntheticPlayback.current?.seek(position);displayedSyntheticEvent.current=null}
    if(video.current)video.current.currentTime=position
    resetAnalysis(position,playing)
  }
  const playbackUnavailable=sourceMode==='video'?videoMissing:!syntheticMatch
  const playbackDuration=sourceMode==='synthetic'?syntheticMatch?.duration??0:duration
  const currentSceneKey=sourceMode==='synthetic'&&syntheticMatch?eventAt(syntheticMatch,clock).id:sourceMode
  const total=Object.values(counts).reduce((sum,count)=>sum+count,0)
  const pollSecondsRemaining=poll?Math.max(0,Math.ceil((poll.expiresAt-pollClock)/1000)):0
  const time=useMemo(()=>`${Math.floor(clock/60).toString().padStart(2,'0')}:${Math.floor(clock%60).toString().padStart(2,'0')}`,[clock])

  return <main>
    <header><div className="brand"><div className="mark"><Sparkles size={17}/></div><div><strong>FANPULSE</strong><span>Your Voice in the Game</span></div></div><div className="header-actions"><div className="source-switch"><button className={sourceMode==='video'?'active':''} onClick={()=>{if(playing)toggle();videoNotice.current?.showModal()}}>Video</button><button className={sourceMode==='synthetic'?'active':''} onClick={()=>switchSource('synthetic')}>Synthetic match</button></div><span className="live"><i/> AI ACTIVE</span><div className="mode"><button className={mode==='casual'?'active':''} onClick={()=>setMode('casual')}>Casual</button><button className={mode==='analyst'?'active':''} onClick={()=>setMode('analyst')}>Tactical</button></div></div></header>
    <dialog ref={videoNotice} className="video-demo-dialog" aria-labelledby="video-demo-title" aria-describedby="video-demo-description">
      <span className="demo-eyebrow"><ShieldCheck size={18}/> HACKATHON SUBMISSION NOTICE</span>
      <h2 id="video-demo-title">Video mode — demo only</h2>
      <p id="video-demo-description">Video mode is an optional demonstration and is not part of this hackathon submission. Judges should exclude this mode, its real footage, and its outputs from their evaluation.</p>
      <p>Please evaluate <strong>Synthetic match</strong>, which uses fictional match data and real Foundry agents.</p>
      <form method="dialog"><button value="cancel" autoFocus>Cancel</button><button type="button" className="continue-demo" onClick={()=>{videoNotice.current?.close();switchSource('video')}}>Continue to video demo</button></form>
    </dialog>
    {sourceMode==='video'&&<section className="video-demo-notice" aria-label="Video demonstration notice"><ShieldCheck size={22}/><div><strong>DEMO ONLY · EXCLUDED FROM HACKATHON SUBMISSION</strong><p>Video mode and its outputs are provided for demonstration only and should not be considered for judging. Please evaluate Synthetic match.</p></div><button onClick={()=>switchSource('synthetic')}>Return to Synthetic match</button></section>}
    <section className="scorebar" aria-label="Match scoreboard"><div className="scoreline"><div className="team"><b className="green-crest">G</b><span>Green United</span></div><div className="score"><strong>0 <em>—</em> 0</strong></div><div className="team away"><b className="black-crest">B</b><span>Black FC</span></div></div><span className="match-meta">{time} · {sourceMode==='synthetic'?'SYNTHETIC EVENT OBSERVATIONS':'VISION-DERIVED OBSERVATIONS'}</span></section>
    <div className="layout">
      <section className="viewer">
        <div className="video-shell">
          {sourceMode==='video'
            ?<video ref={video} src="/media/match.mov" playsInline onLoadedMetadata={event=>{setDuration(event.currentTarget.duration);console.info('[FanPulse] video loaded',{duration:event.currentTarget.duration,width:event.currentTarget.videoWidth,height:event.currentTarget.videoHeight})}} onTimeUpdate={event=>setClock(event.currentTarget.currentTime)} onPlay={event=>{setPlaying(true);setAnalysisStatus('sampling');void postPlaybackState(true,event.currentTarget.currentTime)}} onPause={event=>{setPlaying(false);resetAnalysis(event.currentTarget.currentTime,false)}} onSeeked={event=>resetAnalysis(event.currentTarget.currentTime,!event.currentTarget.paused)} onError={()=>{setVideoMissing(true);setAnalysisStatus('video unavailable')}} />
            :syntheticMatch?<SyntheticPitch match={syntheticMatch} clock={clock}/>:<div className="placeholder"><div><Activity/><strong>{syntheticError?'MATCH DATA UNAVAILABLE':'LOADING SYNTHETIC MATCH'}</strong><p>{syntheticError??'Preparing the match timeline…'}</p></div></div>}
          {sourceMode==='video'&&videoMissing&&<div className="placeholder"><div><Radio/><strong>VIDEO UNAVAILABLE</strong><p>Add the licensed recording at <code>apps/web/public/media/match.mov</code>.</p></div></div>}
          <div className="broadcast-badge"><CircleDot size={13}/> {sourceMode==='synthetic'?'SYNTHETIC · FIXED SEED':'DEMO ONLY · VISION · REAL FRAMES'}</div>
          {sourceMode==='synthetic'&&syntheticHold&&<div className="synthetic-hold" role="status">{syntheticHold}</div>}
          {sourceMode==='synthetic'&&debugSynthetic&&<output className="synthetic-diagnostics">{JSON.stringify({...syntheticDiagnostics,result:latestResult?.synthetic_event?.id,poll:poll?.eventId})}</output>}
          <AnimatePresence key={currentSceneKey}>{poll&&!voted&&<motion.div className="moment-toast" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Sparkles/><div><span>AI MOMENT DETECTED</span><strong>{poll.significance}% significance</strong></div><ChevronRight/></motion.div>}</AnimatePresence>
          <div className="controls"><button onClick={toggle} aria-label={playing?'Pause match':'Play match'} disabled={playbackUnavailable}>{playing?<Pause/>:<Play/>}</button><div className="progress"><input aria-label="Match position" type="range" min="0" max={playbackDuration||1} step="0.1" value={clock} disabled={playbackUnavailable} onChange={event=>seekTo(+event.target.value)}/><span style={{width:`${playbackDuration?clock/playbackDuration*100:0}%`}}/></div><span>{time}</span><button className="rate" aria-label="Playback speed" onClick={()=>{const next=rate===4?1:rate*2;setRate(next);if(video.current)video.current.playbackRate=next}}>{rate}×</button></div>
        </div>
        <div className="under-video"><div><button className="primary" onClick={toggle} disabled={playbackUnavailable}>{playing?<><Pause/> Pause match</>:<><Play/> {sourceMode==='synthetic'?'Play synthetic match':'Play with vision'}</>}</button><button onClick={reset}><RefreshCw/> Restart</button></div></div>
        <Timeline items={timeline} sourceMode={sourceMode}/>
      </section>
      <aside>
        <div className="panel-heading"><div><span className="eyebrow"><Bot/> FOUNDRY AGENT TEAM</span><h2>Live intelligence</h2><small className="analysis-meta">{analysisStatus}{analysisLatency!==null?` · ${(analysisLatency/1000).toFixed(1)}s`:''}</small></div><span className={connected?'status connected':'status'}>{connected?'Connected':'Disconnected'}</span></div>
        <div className="intelligence-stack" key={currentSceneKey}>
          <AnimatePresence mode="wait">{latestResult?<ObservationCard key={`${latestResult.generation}-${latestResult.window.end_seconds}`} result={latestResult}/>:<EmptyState sourceMode={sourceMode}/>}</AnimatePresence>
          <AnimatePresence>{poll&&<PollCard key={poll.id+mode} poll={poll} counts={counts} total={total} voted={voted} secondsRemaining={pollSecondsRemaining} vote={vote}/>}</AnimatePresence>
        </div>
      </aside>
    </div>
    <footer><span><ShieldCheck/> {sourceMode==='synthetic'?'Synthetic events are fictional and deterministic; insights are generated by Foundry agents.':'Vision observations are AI-generated from visible frames and may be incomplete.'}</span><span>{sourceMode==='synthetic'?'SYNTHETIC MATCH · REAL FOUNDRY AGENTS':'REAL VIDEO · REAL FOUNDRY INFERENCE'}</span></footer>
  </main>
}

function PollCard({poll,counts,total,voted,secondsRemaining,vote}:{poll:Poll;counts:Counts;total:number;voted:string|null;secondsRemaining:number;vote:(id:string)=>void}){
  const origin=poll.eventTimestamp===undefined?null:`${Math.floor(poll.eventTimestamp/60).toString().padStart(2,'0')}:${Math.floor(poll.eventTimestamp%60).toString().padStart(2,'0')} · ${poll.eventLabel}`
  return <motion.div className="poll-card significant-poll" initial={{opacity:0,y:24,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:.98}} transition={{type:'spring',stiffness:260,damping:22}}><div className="poll-glow" aria-hidden="true"/><div className="signal"><span className="signal-icon"><Sparkles/></span><span>SIGNIFICANT MOMENT · FAN VOTE</span></div>{origin&&<div className="poll-origin">{origin}</div>}<div className={voted?'poll-timer voted':'poll-timer'}><span>{voted?'VOTE SUBMITTED':origin?'VOTE ON THIS PLAY':'VOTING CLOSES IN'}</span><strong>{voted?'✓':origin?'Until next play':`${secondsRemaining}s`}</strong></div><h3>{poll.question}</h3><p className="reason">{poll.reason}</p><div className="options">{poll.options.map(option=>{const count=counts[option.id]||0,pct=total?Math.round(count/total*100):0;return <button disabled={!!voted} className={voted===option.id?'selected':''} onClick={()=>vote(option.id)} key={option.id}><span className="fill" style={{width:voted?`${pct}%`:'0'}}/><span>{option.label}</span>{voted&&<b>{pct}%</b>}</button>})}</div><div className="vote-meta"><span><Users/> {total} live {total===1?'vote':'votes'}</span><span>One vote per viewer</span></div></motion.div>
}
function EmptyState({sourceMode}:{sourceMode:SourceMode}){return <motion.div className="empty" initial={{opacity:0}} animate={{opacity:1}}><div><Gauge/><i/></div><h3>Watching the match</h3><p>{sourceMode==='synthetic'?'Match Analyst and Fan Engagement assess the same synthetic events that drive the animation. Insights and votes appear here for the current play.':'Foundry vision, Match Analyst, and Fan Engagement are looking for grounded, meaningful moments. Routine play is shown with its reason instead of becoming a poll.'}</p></motion.div>}
function ObservationCard({result}:{result:VisionResultMessage}){const synthetic=result.provider.vision_model==='synthetic-observation-adapter',direct=['vision-direct','synthetic-direct'].includes(result.provider.agent),published=result.policy.outcome==='published',origin=result.synthetic_event;return <motion.div className="observation-card" initial={{opacity:0,x:18}} animate={{opacity:1,x:0}}><div className={`observation-state ${published?'published':'suppressed'}`}><Activity/><span>{direct?'MOMENT DETECTED':published?'INSIGHT PUBLISHED':'MOMENT ASSESSED'}</span><b className={`confidence-level ${result.observation.confidence}`}>{result.observation.confidence.toUpperCase()} CONFIDENCE</b></div>{origin&&<small className="insight-origin">{Math.floor(origin.timestamp_seconds/60).toString().padStart(2,'0')}:{Math.floor(origin.timestamp_seconds%60).toString().padStart(2,'0')} · {origin.label}</small>}<h3>{result.observation.description}</h3><p>{result.observation.evidence}</p><dl><div><dt>Visible event</dt><dd>{result.observation.event_type.replaceAll('_',' ')}</dd></div><div><dt>Evidence</dt><dd>{result.observation.confidence} confidence · {result.observation.evidence_basis.replaceAll('_',' ')}</dd></div><div><dt>Decision</dt><dd>{direct?(synthetic?'Awaiting Foundry agents':'Vision direct'):published?'Foundry agents · published':'Foundry agents · suppressed'}</dd></div></dl></motion.div>}
function Timeline({items,sourceMode}:{items:MatchEvent[];sourceMode:SourceMode}){return <section className="timeline"><div className="timeline-title"><span>Match timeline</span><small>{sourceMode==='synthetic'?'SYNTHETIC EVENT OBSERVATIONS':'VISION OBSERVATIONS'}</small></div><div className="event-list">{items.length?items.map(event=><motion.div initial={{opacity:0}} animate={{opacity:1}} className="event" key={event.id}><time>{Math.floor(event.matchSecond/60).toString().padStart(2,'0')}:{(event.matchSecond%60).toString().padStart(2,'0')}</time><i className={event.candidate?'hot':''}/><div><strong>{event.title}</strong><span>{event.detail}</span></div></motion.div>):<p className="waiting">Play the {sourceMode==='synthetic'?'synthetic match':'video'} to begin Foundry analysis.</p>}</div></section>}
export default App
