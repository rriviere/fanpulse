import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Bot, ChevronRight, CircleDot, Gauge, Pause, Play, Radio, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Counts, MatchEvent, Poll, ViewerMode, VisionResultMessage } from './types'

const ANALYSIS_INTERVAL_SECONDS=10
const viewerId=localStorage.getItem('fanpulse-viewer-id') || crypto.randomUUID()
localStorage.setItem('fanpulse-viewer-id',viewerId)
const analysisSessionId=sessionStorage.getItem('fanpulse-analysis-session') || crypto.randomUUID()
sessionStorage.setItem('fanpulse-analysis-session',analysisSessionId)

function App(){
  const video=useRef<HTMLVideoElement>(null)
  const [clock,setClock]=useState(0), [playing,setPlaying]=useState(false), [rate,setRate]=useState(1)
  const [mode,setMode]=useState<ViewerMode>('casual'), [timeline,setTimeline]=useState<MatchEvent[]>([])
  const [poll,setPoll]=useState<Poll|null>(null), [counts,setCounts]=useState<Counts>({}), [voted,setVoted]=useState<string|null>(null)
  const [connected,setConnected]=useState(false), [videoMissing,setVideoMissing]=useState(false), [duration,setDuration]=useState(0)
  const [analysisStatus,setAnalysisStatus]=useState('paused'), [analysisLatency,setAnalysisLatency]=useState<number|null>(null)
  const [latestResult,setLatestResult]=useState<VisionResultMessage|null>(null)
  const generation=useRef(0), frameBuffer=useRef<{timestamp_seconds:number;data_url:string}[]>([])
  const nextSampleAt=useRef(0), lastWindowEnd=useRef(-1), lastStateSecond=useRef(-1), pollId=useRef<string|null>(null)

  const applyVisionResult=useCallback((message:VisionResultMessage)=>{
    setLatestResult(message);setAnalysisLatency(message.latency.total_ms);setAnalysisStatus(message.policy.outcome==='published'?'published':'routine')
    const id=`vision-${message.generation}-${message.window.end_seconds}`
    if(message.provider.agent==='vision-direct'){setPoll(null);setVoted(null);setCounts({})}
    if(!message.insight.publish_insight){
      if(message.provider.agent!=='vision-direct')setTimeline(previous=>previous.filter(item=>item.id!==id))
      return
    }
    const event:MatchEvent={id,matchSecond:Math.round(message.window.end_seconds),videoSecond:message.window.end_seconds,type:message.observation.event_type,title:message.insight.headline,detail:message.insight.explanation,candidate:message.insight.significance>=70}
    setTimeline(previous=>[event,...previous.filter(item=>item.id!==id)].slice(0,7))
    if(message.insight.poll){setPoll({id:`poll-${id}`,eventId:id,question:message.insight.poll.question,options:message.insight.poll.options,significance:message.insight.significance,reason:message.insight.explanation,agentTrace:[`Vision model · ${message.latency.vision_ms}ms`,`Match Analyst · ${message.latency.match_analyst_ms}ms`,`Fan Engagement · ${message.latency.fan_engagement_ms}ms`,'Policy · threshold and dedup passed',`WebSocket · delivered · ${message.latency.total_ms}ms`]});setVoted(null);setCounts({})}
  },[])

  useEffect(()=>{pollId.current=poll?.id||null},[poll?.id])
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
    if(!playing||videoMissing||!video.current)return
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
  },[clock,mode,playing,postPlaybackState,videoMissing])

  async function vote(optionId:string){
    if(voted||!poll)return
    setVoted(optionId)
    try{
      const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poll_id:poll.id,option_id:optionId,viewer_id:viewerId})})
      if(!response.ok)throw Error(`vote rejected (${response.status})`)
      setCounts((await response.json()).counts);console.info('[FanPulse] vote recorded',{poll:poll.id,option:optionId})
    }catch(error){console.error('[FanPulse] vote error',error);setVoted(null)}
  }

  function reset(){
    video.current?.pause();if(video.current)video.current.currentTime=0
    setClock(0);setPlaying(false);setTimeline([]);setPoll(null);setLatestResult(null);setVoted(null);setCounts({});resetAnalysis(0,false)
  }
  function toggle(){if(!videoMissing&&video.current){if(video.current.paused)void video.current.play();else video.current.pause()}}
  const total=Object.values(counts).reduce((sum,count)=>sum+count,0)
  const time=useMemo(()=>`${Math.floor(clock/60).toString().padStart(2,'0')}:${Math.floor(clock%60).toString().padStart(2,'0')}`,[clock])

  return <main>
    <header><div className="brand"><div className="mark"><Sparkles size={17}/></div><div><strong>FANPULSE</strong><span>Your Voice in the Game</span></div></div><div className="header-actions"><span className="live"><i/> AI ACTIVE</span><div className="mode"><button className={mode==='casual'?'active':''} onClick={()=>setMode('casual')}>Casual</button><button className={mode==='analyst'?'active':''} onClick={()=>setMode('analyst')}>Tactical</button></div></div></header>
    <section className="scorebar"><div className="team"><b style={{background:'#2f9d69'}}>G</b><span>Green kit</span></div><div className="score"><strong>LIVE</strong><span>{time} · VISION-DERIVED OBSERVATIONS</span></div><div className="team away"><span>Dark kit</span><b style={{background:'#252330'}}>D</b></div></section>
    <div className="layout">
      <section className="viewer">
        <div className="video-shell">
          <video ref={video} src="/media/match.mov" playsInline onLoadedMetadata={event=>{setDuration(event.currentTarget.duration);console.info('[FanPulse] video loaded',{duration:event.currentTarget.duration,width:event.currentTarget.videoWidth,height:event.currentTarget.videoHeight})}} onTimeUpdate={event=>setClock(event.currentTarget.currentTime)} onPlay={event=>{console.info('[FanPulse] playback started',{timestamp:event.currentTarget.currentTime});setPlaying(true);setAnalysisStatus('sampling');void postPlaybackState(true,event.currentTarget.currentTime)}} onPause={event=>{console.info('[FanPulse] playback paused',{timestamp:event.currentTarget.currentTime});setPlaying(false);resetAnalysis(event.currentTarget.currentTime,false)}} onSeeked={event=>{console.info('[FanPulse] playback seeked',{timestamp:event.currentTarget.currentTime});resetAnalysis(event.currentTarget.currentTime,!event.currentTarget.paused)}} onError={()=>{console.error('[FanPulse] video could not be loaded');setVideoMissing(true);setAnalysisStatus('video unavailable')}} />
          {videoMissing&&<div className="placeholder"><div><Radio/><strong>VIDEO UNAVAILABLE</strong><p>Add the licensed recording at <code>apps/web/public/media/match.mov</code>.</p></div></div>}
          <div className="broadcast-badge"><CircleDot size={13}/> VISION · REAL FRAMES</div>
          <AnimatePresence>{poll&&!voted&&<motion.div className="moment-toast" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Sparkles/><div><span>AI MOMENT DETECTED</span><strong>{poll.significance}% significance</strong></div><ChevronRight/></motion.div>}</AnimatePresence>
          <div className="controls"><button onClick={toggle} disabled={videoMissing}>{playing?<Pause/>:<Play/>}</button><div className="progress"><input aria-label="Video position" type="range" min="0" max={duration||1} value={clock} disabled={videoMissing} onChange={event=>{const position=+event.target.value;setClock(position);if(video.current)video.current.currentTime=position}}/><span style={{width:`${duration?clock/duration*100:0}%`}}/></div><span>{time}</span><button className="rate" onClick={()=>{const next=rate===4?1:rate*2;setRate(next);if(video.current)video.current.playbackRate=next}}>{rate}×</button></div>
        </div>
        <div className="under-video"><div><button className="primary" onClick={toggle} disabled={videoMissing}>{playing?<><Pause/> Pause video</>:<><Play/> Play with vision</>}</button><button onClick={reset}><RefreshCw/> Reset</button></div></div>
        <Timeline items={timeline}/>
      </section>
      <aside>
        <div className="panel-heading"><div><span className="eyebrow"><Bot/> FOUNDRY AGENT TEAM</span><h2>Live intelligence</h2><small className="analysis-meta">{analysisStatus}{analysisLatency!==null?` · ${(analysisLatency/1000).toFixed(1)}s`:''}</small></div><span className={connected?'status connected':'status'}>{connected?'Connected':'Disconnected'}</span></div>
        <div className="intelligence-stack">
          <AnimatePresence mode="wait">{latestResult?<ObservationCard key={`${latestResult.generation}-${latestResult.window.end_seconds}`} result={latestResult}/>:<EmptyState/>}</AnimatePresence>
          <AnimatePresence>{poll&&<PollCard key={poll.id+mode} poll={poll} counts={counts} total={total} voted={voted} vote={vote}/>}</AnimatePresence>
        </div>
        <AgentTrace poll={poll} result={latestResult}/>
      </aside>
    </div>
    <footer><span><ShieldCheck/> Vision observations are AI-generated from visible frames and may be incomplete.</span><span>REAL VIDEO · REAL FOUNDRY INFERENCE</span></footer>
  </main>
}

function PollCard({poll,counts,total,voted,vote}:{poll:Poll;counts:Counts;total:number;voted:string|null;vote:(id:string)=>void}){
  return <motion.div className="poll-card" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} exit={{opacity:0,y:10}}><div className="signal"><Users/><span>FAN ENGAGEMENT</span><b>{poll.significance}</b></div><h3>{poll.question}</h3><p className="reason">{poll.reason}</p><div className="options">{poll.options.map(option=>{const count=counts[option.id]||0,pct=total?Math.round(count/total*100):0;return <button disabled={!!voted} className={voted===option.id?'selected':''} onClick={()=>vote(option.id)} key={option.id}><span className="fill" style={{width:voted?`${pct}%`:'0'}}/><span>{option.label}</span>{voted&&<b>{pct}%</b>}</button>})}</div><div className="vote-meta"><span><Users/> {total} live {total===1?'vote':'votes'}</span><span>One vote per viewer</span></div></motion.div>
}
function EmptyState(){return <motion.div className="empty" initial={{opacity:0}} animate={{opacity:1}}><div><Gauge/><i/></div><h3>Watching the match</h3><p>Foundry vision, Match Analyst, and Fan Engagement are looking for grounded, meaningful moments. Routine play is shown with its reason instead of becoming a poll.</p></motion.div>}
function ObservationCard({result}:{result:VisionResultMessage}){const published=result.policy.outcome==='published';return <motion.div className="observation-card" initial={{opacity:0,x:18}} animate={{opacity:1,x:0}}><div className={published?'observation-state published':'observation-state'}><Activity/><span>{published?'INSIGHT PUBLISHED':'ROUTINE MOMENT'}</span><b>{result.insight.significance}</b></div><h3>{result.assessment?.summary||result.observation.description}</h3><p>{result.assessment?.rationale||result.observation.evidence}</p><dl><div><dt>Visible event</dt><dd>{result.observation.event_type.replaceAll('_',' ')}</dd></div><div><dt>Evidence</dt><dd>{result.observation.confidence} confidence · {result.observation.evidence_basis.replaceAll('_',' ')}</dd></div><div><dt>Decision</dt><dd>{result.policy.reason.replaceAll('_',' ')}</dd></div></dl>{result.assessment?.uncertainty_note&&<small>{result.assessment.uncertainty_note}</small>}</motion.div>}
function AgentTrace({poll,result}:{poll:Poll|null;result:VisionResultMessage|null}){const direct=result?.provider.agent==='vision-direct';const trace=result?[`Vision model · ${result.latency.vision_ms}ms`,direct?'Match Analyst · enriching asynchronously':`Match Analyst · ${result.latency.match_analyst_ms}ms · ${result.assessment?.significance??result.insight.significance}/100`,direct?'Fan Engagement · waiting for assessment':result.latency.fan_engagement_ms?`Fan Engagement · ${result.latency.fan_engagement_ms}ms`:'Fan Engagement · skipped for routine play',`Policy · ${result.policy.reason.replaceAll('_',' ')}`,`WebSocket · delivered · ${result.latency.total_ms}ms`]:['Frame sampler · awaiting next window','Vision model · awaiting frames','Match Analyst · standing by','Fan Engagement · standing by','Policy/WebSocket · awaiting decision'];return <div className="trace"><span className="eyebrow">TWO-AGENT FOUNDRY PIPELINE</span>{(poll?.agentTrace||trace).map((item,index)=><div key={`${index}-${item}`}><i className={poll||result?'done':''}>{index+1}</i><span>{item}</span></div>)}</div>}
function Timeline({items}:{items:MatchEvent[]}){return <section className="timeline"><div className="timeline-title"><span>Match timeline</span><small>VISION OBSERVATIONS</small></div><div className="event-list">{items.length?items.map(event=><motion.div initial={{opacity:0}} animate={{opacity:1}} className="event" key={event.id}><time>{Math.floor(event.matchSecond/60).toString().padStart(2,'0')}:{(event.matchSecond%60).toString().padStart(2,'0')}</time><i className={event.candidate?'hot':''}/><div><strong>{event.title}</strong><span>{event.detail}</span></div></motion.div>):<p className="waiting">Play the video to begin real Foundry analysis.</p>}</div></section>}
export default App
