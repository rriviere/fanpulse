import type { VisionObservation } from './types'

// Condenses the strongest moments from a persisted vision run into a judge-friendly
// replay. Positions remain fictional; observations are deliberately spaced so the
// existing single-flight Foundry agent pipeline can complete between submissions.
export const SYNTHETIC_DURATION=135
export type Point={x:number;y:number}
export type SyntheticPlayer={id:string;team:'black'|'green';number:number;role:string;base:Point}
export type SyntheticEvent={time:number;label:string;carrier:string;ball:Point;observation:VisionObservation}

const black:[number,number,string][]=[[-48,0,'GK'],[-34,-22,'LB'],[-37,-8,'CB'],[-37,8,'CB'],[-34,22,'RB'],[-20,-12,'DM'],[-20,12,'DM'],[-10,0,'AM'],[-5,-23,'LW'],[-2,0,'ST'],[-5,23,'RW']]
const green:[number,number,string][]=[[48,0,'GK'],[34,-22,'LB'],[37,-8,'CB'],[37,8,'CB'],[34,22,'RB'],[21,-14,'DM'],[21,10,'CM'],[10,0,'AM'],[5,-23,'LW'],[2,0,'ST'],[5,23,'RW']]
export const PLAYERS:SyntheticPlayer[]=[...black.map((p,i)=>({id:`black-${i+1}`,team:'black' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}})),...green.map((p,i)=>({id:`green-${i+1}`,team:'green' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}}))]

const event=(time:number,label:string,carrier:string,ball:Point,event_type:VisionObservation['event_type'],team:string,description:string,evidence:string,is_significant=true):SyntheticEvent=>({time,label,carrier,ball,observation:{video_timestamp_seconds:time,event_type,team,description,evidence,evidence_basis:'directly_visible',confidence:'high',is_significant}})
export const SYNTHETIC_EVENTS:SyntheticEvent[]=[
 event(8,'Black advance right','black-11',{x:8,y:24},'attacking_sequence','black','Black FC advance upfield on the right flank.','A black player carries beyond halfway with teammates ahead and green defenders tracking.'),
 event(23,'Green progress left','green-9',{x:3,y:-27},'attacking_sequence','green','Green United advance down the left flank toward the penalty area.','The winger progresses along the touchline as black defenders converge and green teammates support.'),
 event(38,'Green pressure in the box','green-10',{x:-43,y:11},'attacking_pressure','green','Green United sustain an attack inside and around the penalty area.','Green attackers occupy the box while Black FC defenders protect the central route to goal.'),
 event(53,'Black break forward','black-10',{x:-29,y:5},'counterattack','black','Black FC launch a quick transition from their defensive third.','The carrier accelerates past green defenders with black teammates sprinting forward in support.'),
 event(68,'Black enter the area','black-10',{x:40,y:7},'potential_shot','black','A Black FC attacker carries into the penalty area as a defender challenges.','The attacker drives toward goal while a Green United defender slides across the route.'),
 event(83,'Green goalkeeper distributes','green-1',{x:47,y:0},'defensive_transition','green','Green United collect the ball near their penalty area and prepare to distribute.','The goalkeeper controls possession while Black FC attackers retreat and green teammates spread out.'),
 event(98,'Green dribble near goal line','green-9',{x:-47,y:-25},'attacking_sequence','green','A Green United attacker dribbles into the penalty area near the goal line.','A black defender challenges and the ball is forced toward the corner area.'),
 event(113,'Green corner delivery','green-5',{x:-51,y:-32},'attacking_pressure','green','Green United take a short corner from the left.','The taker combines with a nearby teammate while black defenders remain compact in the box.'),
 event(128,'Green chase through ball','green-10',{x:-35,y:3},'dangerous_movement','green','A Green United attacker chases a loose ball toward the penalty area.','The ball runs ahead of the striker with a black defender and goalkeeper moving to cover.'),
]

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
export function sceneAt(seconds:number){
 const index=Math.max(0,SYNTHETIC_EVENTS.findIndex(item=>item.time>seconds)-1)
 const current=SYNTHETIC_EVENTS[index]||SYNTHETIC_EVENTS[0]
 const next=SYNTHETIC_EVENTS[Math.min(index+1,SYNTHETIC_EVENTS.length-1)]
 const span=Math.max(1,next.time-current.time),t=Math.max(0,Math.min(1,(seconds-current.time)/span)),smooth=t*t*(3-2*t)
 const direction=current.observation.team==='black'?1:-1
 const ballDistance=Math.hypot(next.ball.x-current.ball.x,next.ball.y-current.ball.y)
 const travelSeconds=Math.min(span*.45,Math.max(.8,ballDistance/22)),travelStart=next.time-travelSeconds
 const ballT=Math.max(0,Math.min(1,(seconds-travelStart)/travelSeconds))
 const ballEase=ballT*ballT*(3-2*ballT)
 const dribble=ballT===0?Math.sin(seconds*5)*.35:0
 const ball={x:lerp(current.ball.x,next.ball.x,ballEase)+dribble*direction,y:lerp(current.ball.y,next.ball.y,ballEase)}
 const carrier=ballT<.72?current.carrier:next.carrier
 const players=PLAYERS.map((player,i)=>{
   const involved=player.id===current.carrier||player.id===next.carrier
   const teamDirection=player.team==='black'?1:-1
   const phaseShift=teamDirection*(involved?15:current.observation.team===player.team?7:-4)
   const pulse=Math.sin((seconds+i*1.7)/7)*(player.role==='GK'?.5:1.4)
   if(player.id===carrier)return {...player,x:ball.x-direction*1.1,y:ball.y}
   const receiving=player.id===next.carrier
   return {...player,x:receiving?next.ball.x:player.base.x+phaseShift*(.35+.65*smooth)+pulse,y:receiving?next.ball.y:player.base.y+Math.sin((seconds+i*2.3)/10)*2}
 })
 // Keep the ball with its carrier, then complete each pass/transition at match speed.
 // Long interpolation across a full 8–13 second observation gap made the old replay look slow.
 return {players,ball,carrier,label:t<.55?current.label:next.label,direction}
}
