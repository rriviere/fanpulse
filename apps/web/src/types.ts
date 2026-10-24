export type ViewerMode = 'casual' | 'analyst'
export type SourceMode = 'video' | 'synthetic'
export type MatchEvent = {id:string;matchSecond:number;videoSecond:number;type:string;title:string;detail:string;candidate?:boolean}
export type Poll = {id:string;eventId:string;eventLabel?:string;eventTimestamp?:number;question:string;options:{id:string;label:string}[];significance:number;reason:string;agentTrace:string[];expiresAt:number}
export type Counts = Record<string,number>
export type VisionObservation = {video_timestamp_seconds:number;event_type:string;team:string;description:string;evidence:string;evidence_basis:string;confidence:'low'|'medium'|'high';is_significant:boolean}
export type VisionInsight = {publish_insight:boolean;significance:number;headline:string;explanation:string;uncertainty_note:string|null;poll:{question:string;options:{id:string;label:string}[];duplicate_key:string}|null}
export type MatchAssessment = {significant:boolean;significance:number;summary:string;rationale:string;uncertainty_note:string|null}
export type VisionResultMessage = {type:'vision_result';session_id:string;generation:number;window:{start_seconds:number;end_seconds:number};observation:VisionObservation;assessment:MatchAssessment|null;insight:VisionInsight;policy:{outcome:'published'|'suppressed';reason:string};latency:{vision_ms:number;agent_ms:number;match_analyst_ms:number;fan_engagement_ms:number;total_ms:number};provider:{vision_model:string;agent:string;agents:string[];retried_stages:string[]};synthetic_event?:{id:string;label:string;timestamp_seconds:number}|null}

