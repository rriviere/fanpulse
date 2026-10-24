import type { VisionObservation } from './types'

export const SYNTHETIC_DURATION=240
export type Point={x:number;y:number}
export type SyntheticPlayer={id:string;team:'black'|'green';number:number;role:string;base:Point}
export type SyntheticEvent={time:number;label:string;carrier:string;ball:Point;observation:VisionObservation}

const black:[number,number,string][]=[[-48,0,'GK'],[-34,-22,'LB'],[-37,-8,'CB'],[-37,8,'CB'],[-34,22,'RB'],[-20,-12,'DM'],[-20,12,'DM'],[-10,0,'AM'],[-5,-23,'LW'],[-2,0,'ST'],[-5,23,'RW']]
const green:[number,number,string][]=[[48,0,'GK'],[34,-22,'LB'],[37,-8,'CB'],[37,8,'CB'],[34,22,'RB'],[21,-14,'DM'],[21,10,'CM'],[10,0,'AM'],[5,-23,'LW'],[2,0,'ST'],[5,23,'RW']]
export const PLAYERS:SyntheticPlayer[]=[...black.map((p,i)=>({id:`black-${i+1}`,team:'black' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}})),...green.map((p,i)=>({id:`green-${i+1}`,team:'green' as const,number:i+1,role:p[2],base:{x:p[0],y:p[1]}}))]

const event=(time:number,label:string,carrier:string,ball:Point,event_type:VisionObservation['event_type'],team:string,description:string,evidence:string):SyntheticEvent=>({time,label,carrier,ball,observation:{video_timestamp_seconds:time,event_type,team,description,evidence,evidence_basis:'directly_visible',confidence:'high',is_significant:true}})
export const SYNTHETIC_EVENTS:SyntheticEvent[]=[
 event(12,'Black build from the back','black-3',{x:-34,y:-8},'attacking_sequence','black','Black FC begin a patient build-up from central defence.','The centre-backs split, both holding midfielders show for the ball, and Green United hold a compact mid-block.'),
 event(31,'Green press forces turnover','green-8',{x:4,y:-2},'defensive_transition','green','Green United press centrally and force a turnover.','Three striped shirts close the ball together and recover possession ahead of Black FC midfield.'),
 event(49,'Green overload the left','green-9',{x:-8,y:-22},'attacking_pressure','green','Green United create a left-side overload.','The left winger carries forward while the full-back overlaps and the attacking midfielder occupies the inside channel.'),
 event(67,'Black intercept through ball','black-4',{x:-25,y:9},'defensive_transition','black','Black FC read the through ball and regain possession.','A black centre-back steps in front of the striker as the pass enters the central channel.'),
 event(84,'Black counterattack','black-11',{x:8,y:20},'counterattack','black','Black FC launch a fast counterattack down the right.','The right winger advances into open space while three teammates sprint beyond the recovering midfield.'),
 event(103,'Shot blocked','black-10',{x:36,y:3},'potential_shot','black','Black FC create a shooting opportunity at the edge of the area.','The striker receives between defenders and shoots before a Green United centre-back blocks the path to goal.'),
 event(122,'Green recover second ball','green-6',{x:18,y:-6},'sustained_momentum','green','Green United recover the second ball and sustain pressure.','The holding midfielder collects outside the area with the defensive line pushed near halfway.'),
 event(141,'Line-breaking pass','green-8',{x:-3,y:4},'dangerous_movement','green','Green United break Black FC’s midfield line.','A vertical pass finds the attacking midfielder between the lines as the striker pins both centre-backs.'),
 event(159,'Through ball','green-10',{x:-31,y:2},'dangerous_movement','green','Green United release their striker behind the defensive line.','The striker accelerates through the inside channel onto a pass beyond the retreating back four.'),
 event(176,'Goalkeeper save','black-1',{x:-47,y:0},'potential_shot','green','Green United’s close-range attempt is saved.','The ball travels toward the left goal and the Black FC goalkeeper moves across to make the stop.'),
 event(198,'Black switch play','black-5',{x:-4,y:-21},'team_shape_change','black','Black FC escape pressure with a switch to the left.','The ball moves across midfield to the advancing full-back while Green United shift laterally.'),
 event(221,'Late Black chance','black-10',{x:39,y:-5},'attacking_pressure','black','Black FC create a late opening inside the penalty area.','A low cutback reaches the striker as Green United collapse toward their six-yard box.'),
]

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t
export function sceneAt(seconds:number){
 const index=Math.max(0,SYNTHETIC_EVENTS.findIndex(item=>item.time>seconds)-1)
 const current=SYNTHETIC_EVENTS[index]||SYNTHETIC_EVENTS[0]
 const next=SYNTHETIC_EVENTS[Math.min(index+1,SYNTHETIC_EVENTS.length-1)]
 const span=Math.max(1,next.time-current.time),t=Math.max(0,Math.min(1,(seconds-current.time)/span)),smooth=t*t*(3-2*t)
 const direction=current.observation.team==='black'?1:-1
 const players=PLAYERS.map((player,i)=>{
   const involved=player.id===current.carrier||player.id===next.carrier
   const teamDirection=player.team==='black'?1:-1
   const phaseShift=teamDirection*(involved?15:current.observation.team===player.team?7:-4)
   const pulse=Math.sin((seconds+i*1.7)/7)*(player.role==='GK'?.5:1.4)
   return {...player,x:player.base.x+phaseShift*(.35+.65*smooth)+pulse,y:player.base.y+Math.sin((seconds+i*2.3)/10)*2+(involved?lerp(current.ball.y,next.ball.y,smooth)*.12:0)}
 })
 return {players,ball:{x:lerp(current.ball.x,next.ball.x,smooth),y:lerp(current.ball.y,next.ball.y,smooth)},carrier:t<.55?current.carrier:next.carrier,label:t<.55?current.label:next.label,direction}
}
