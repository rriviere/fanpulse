import {useMemo} from 'react'
import {sceneAt, type SyntheticMatch} from './syntheticMatch'

export function SyntheticPitch({match,clock}:{match:SyntheticMatch;clock:number}){
 const scene=useMemo(()=>sceneAt(match,clock),[match,clock])
 const tx=(x:number)=>60+(x+52.5)/105*1080,ty=(y:number)=>36+(y+34)/68*648
 return <div className="synthetic-stage" aria-label="Synthetic 11 versus 11 tactical match" data-clock={clock.toFixed(4)} data-event-id={scene.eventId}>
  <svg viewBox="0 0 1200 720" role="img">
   <defs><pattern id="grass" width="216" height="648" patternUnits="userSpaceOnUse"><rect width="108" height="648" fill="#174d32"/><rect x="108" width="108" height="648" fill="#1b5738"/></pattern><pattern id="green-stripes" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8" fill="#286B48"/><rect x="4" width="4" height="8" fill="#A5B5A9"/></pattern><filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity=".45"/></filter></defs>
   <rect width="1200" height="720" fill="#10291e"/><rect x="60" y="36" width="1080" height="648" fill="url(#grass)" stroke="#f5f5f5" strokeWidth="3"/>
   <g fill="none" stroke="#f5f5f5" strokeWidth="3" opacity=".88"><line x1="600" y1="36" x2="600" y2="684"/><circle cx="600" cy="360" r="87"/><circle cx="600" cy="360" r="3" fill="#fff"/><rect x="60" y="168" width="170" height="384"/><rect x="970" y="168" width="170" height="384"/><rect x="60" y="273" width="65" height="174"/><rect x="1075" y="273" width="65" height="174"/><path d="M230 290a87 87 0 0 1 0 140M970 290a87 87 0 0 0 0 140"/></g>
   <g className="synthetic-players">{scene.players.map(player=>{const x=tx(player.x),y=ty(player.y),carrier=player.id===scene.carrier;return <g key={player.id} data-player-id={player.id} data-x={player.x} data-y={player.y} transform={`translate(${x} ${y})`} className={carrier?'carrier':''} filter="url(#shadow)">{carrier&&<circle r="19" fill="none" stroke="#f0c75e" strokeWidth="3"/>}<circle r="13" fill={player.team==='black'?'#171717':'url(#green-stripes)'} stroke={player.team==='black'?'#C5A45A':'#F5F5F5'} strokeWidth="2"/><rect x="-8" y="10" width="16" height="5" rx="2" fill="#F5F5F5"/><text y="4" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">{player.number}</text></g>})}</g>
   <g className="synthetic-ball" data-x={scene.ball.x} data-y={scene.ball.y} data-motion={scene.motion} transform={`translate(${tx(scene.ball.x)} ${ty(scene.ball.y)})`} filter="url(#shadow)"><circle r="7" fill="#fff" stroke="#161616" strokeWidth="2"/><path d="M-3-2L0-5 3-2 2 2-2 2Z" fill="#222"/></g>
  </svg>
  <div className="synthetic-phase"><span>LIVE TACTICAL FEED</span><strong>{scene.label}</strong></div>
 </div>
}
