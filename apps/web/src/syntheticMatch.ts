import type { VisionObservation } from './types'

export const SYNTHETIC_DURATION=240
export const SYNTHETIC_RESULT_HOLD_MS=6000
export const SYNTHETIC_AGENT_TIMEOUT_MS=18000
export type Point={x:number;y:number}
type BallKeyframe=Point&{offset:number}
export type SyntheticPlayer={id:string;team:'black'|'green';number:number;role:string;base:Point}
export type SyntheticEvent={id:string;time:number;label:string;carrier:string;ballPath:BallKeyframe[];observation:VisionObservation}

const black:[number,number,string][]=[[-48,0,'GK'],[-34,-22,'LB'],[-37,-8,'CB'],[-37,8,'CB'],[-34,22,'RB'],[-20,-12,'DM'],[-20,12,'DM'],[-10,0,'AM'],[-5,-23,'LW'],[-2,0,'ST'],[-5,23,'RW']]
const green:[number,number,string][]=[[48,0,'GK'],[34,-22,'LB'],[37,-8,'CB'],[37,8,'CB'],[34,22,'RB'],[21,-14,'DM'],[21,10,'CM'],[10,0,'AM'],[5,-23,'LW'],[2,0,'ST'],[5,23,'RW']]
export const PLAYERS:SyntheticPlayer[]=[...black.map((p,i)=>({id:`black-${i+1}`,team:'black' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}})),...green.map((p,i)=>({id:`green-${i+1}`,team:'green' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}}))]

const event=(id:string,time:number,label:string,carrier:string,ballPath:BallKeyframe[],event_type:VisionObservation['event_type'],team:string,description:string,evidence:string):SyntheticEvent=>({id,time,label,carrier,ballPath,observation:{video_timestamp_seconds:time,event_type,team,description,evidence,evidence_basis:'directly_visible',confidence:'high',is_significant:true}})

// Tactical ordering is grounded in a prior licensed-video vision run. Positions,
// identities and paths are fictional normalized keyframes, not real tracking data.
export const SYNTHETIC_EVENTS:SyntheticEvent[]=[
 event('black-right-progression',12,'Black advance on the right','black-11',[{offset:0,x:-10,y:22},{offset:1.4,x:3,y:22},{offset:3.1,x:15,y:19}],'attacking_sequence','black','Black FC advance upfield on the right flank.','The right-sided carrier crosses halfway with supporting runners ahead while Green United drop into shape.'),
 event('green-touchline-restart',31,'Green touchline restart','green-5',[{offset:0,x:27,y:-31},{offset:1.1,x:18,y:-26},{offset:2.5,x:7,y:-23}],'defensive_transition','green','Green United restart near their own touchline.','The full-back puts the ball back into play while Black FC hold their defensive positions.'),
 event('green-left-progression',49,'Green progress down the left','green-9',[{offset:0,x:12,y:-25},{offset:1.5,x:-7,y:-26},{offset:3.4,x:-26,y:-20}],'attacking_sequence','green','Green United advance down the left flank toward the penalty area.','The winger progresses quickly along the touchline as black defenders converge and green teammates support.'),
 event('green-box-pressure',67,'Green pressure around the box','green-10',[{offset:0,x:-25,y:-18},{offset:1.2,x:-37,y:-10},{offset:2.7,x:-43,y:2}],'attacking_pressure','green','Green United sustain an attack inside and around the penalty area.','Green attackers occupy the box while Black FC defenders protect the central route to goal.'),
 event('black-counterattack',84,'Black counterattack','black-10',[{offset:0,x:-34,y:5},{offset:1.4,x:-8,y:6},{offset:3.2,x:18,y:10}],'counterattack','black','Black FC launch a quick transition from their defensive third.','The carrier accelerates through midfield with black teammates sprinting forward and green defenders recovering.'),
 event('black-box-entry',103,'Black enter the penalty area','black-10',[{offset:0,x:20,y:10},{offset:1.1,x:34,y:7},{offset:2.4,x:42,y:3}],'potential_shot','black','A Black FC attacker carries into the penalty area as a defender challenges.','The attacker drives toward goal while a Green United defender slides across the shooting route.'),
 event('green-goalkeeper-distribution',122,'Green goalkeeper distributes','green-1',[{offset:0,x:47,y:0},{offset:1.2,x:33,y:-8},{offset:2.8,x:13,y:-12}],'defensive_transition','green','Green United collect the ball near their penalty area and prepare to distribute.','The goalkeeper releases possession while Black FC attackers retreat and green teammates spread out.'),
 event('green-goalline-attack',141,'Green attack near the goal line','green-9',[{offset:0,x:1,y:-25},{offset:1.5,x:-24,y:-26},{offset:3.2,x:-46,y:-24}],'attacking_sequence','green','A Green United attacker drives toward the penalty area near the goal line.','A black defender tracks the run as the ball is carried rapidly toward the corner of the six-yard box.'),
 event('green-short-corner',159,'Green short-corner routine','green-5',[{offset:0,x:-51,y:-32},{offset:1,x:-45,y:-20},{offset:2.3,x:-38,y:-7}],'attacking_pressure','green','Green United take a short corner from the left.','The taker combines with a nearby teammate while black defenders remain compact inside the box.'),
 event('green-sustained-pressure',176,'Green sustain box pressure','green-10',[{offset:0,x:-41,y:-11},{offset:1.1,x:-45,y:2},{offset:2.5,x:-36,y:10}],'sustained_momentum','green','Green United sustain pressure inside the penalty area.','Multiple green players combine around the ball while Black FC defend the central channel.'),
 event('green-through-ball',198,'Green chase a through ball','green-10',[{offset:0,x:6,y:0},{offset:1.5,x:-19,y:1},{offset:3.1,x:-38,y:2}],'dangerous_movement','green','A Green United attacker chases a through ball toward the penalty area.','The ball runs ahead of the striker with a black defender and goalkeeper moving to cover.'),
 event('green-right-channel',221,'Green attack the right channel','green-11',[{offset:0,x:20,y:25},{offset:1.3,x:-4,y:24},{offset:3,x:-29,y:18}],'attacking_sequence','green','Green United carry forward into the attacking half along the right.','Supporting green players run ahead while Black FC retreat toward their defensive line.'),
]

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
const smooth=(t:number)=>t*t*(3-2*t)

function ballAt(item:SyntheticEvent,seconds:number):Point{
 const elapsed=Math.max(0,seconds-item.time),path=item.ballPath
 const nextIndex=path.findIndex(point=>point.offset>=elapsed)
 if(nextIndex<=0)return {x:path[0].x,y:path[0].y}
 if(nextIndex===-1){const last=path.at(-1)!;return {x:last.x,y:last.y}}
 const from=path[nextIndex-1],to=path[nextIndex],progress=smooth((elapsed-from.offset)/(to.offset-from.offset))
 return {x:lerp(from.x,to.x,progress),y:lerp(from.y,to.y,progress)}
}

export function eventAt(seconds:number){
 return [...SYNTHETIC_EVENTS].reverse().find(item=>item.time<=seconds)??null
}

export function sceneAt(seconds:number){
 const index=Math.max(0,SYNTHETIC_EVENTS.findIndex(item=>item.time>seconds)-1)
 const current=SYNTHETIC_EVENTS[index]
 const next=SYNTHETIC_EVENTS[Math.min(index+1,SYNTHETIC_EVENTS.length-1)]
 const span=Math.max(1,next.time-current.time),phaseProgress=Math.max(0,Math.min(1,(seconds-current.time)/span)),movement=smooth(phaseProgress)
 const direction=current.observation.team==='black'?1:-1,ball=ballAt(current,seconds)
 const players=PLAYERS.map((player,i)=>{
   const teamDirection=player.team==='black'?1:-1
   const involved=player.id===current.carrier||player.id===next.carrier
   const phaseShift=teamDirection*(involved?12:current.observation.team===player.team?6:-3)
   const pulse=Math.sin((seconds+i*1.7)/7)*(player.role==='GK'?.5:1.4)
   const formation={x:player.base.x+phaseShift*(.35+.65*movement)+pulse,y:player.base.y+Math.sin((seconds+i*2.3)/10)*2}
   if(player.id!==current.carrier)return {...player,...formation}
   const join=smooth(Math.min(1,Math.max(0,(seconds-current.time)/1.2)))
   return {...player,x:lerp(formation.x,ball.x-direction*1.15,join),y:lerp(formation.y,ball.y,join)}
 })
 return {players,ball,carrier:current.carrier,label:current.label,eventId:current.id,direction}
}
