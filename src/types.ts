export const MODEL = 'gemini-nano-banana-2.1';
export const RATIOS = ['1:1','1:4','1:8','2:3','3:2','3:4','4:1','4:3','4:5','5:4','8:1','9:16','16:9','21:9'] as const;
export const BLEND_MODES = ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type ImageSize = '1K'|'2K'|'4K';
export type Thinking = 'minimal'|'medium'|'high';
export interface MediaInput { mimeType: string; data: string; label?: string; fileUri?: string; fileName?: string; fileState?: string; }
export interface UploadedFile { name: string; uri: string; mimeType: string; state: string; displayName?: string; }
export interface GenerationSettings { size:ImageSize; ratio:string; thinking:Thinking; webSearch:boolean; imageSearch:boolean; }
export interface GenerateRequest { prompt:string; media:MediaInput[]; settings:GenerationSettings; history?: ConversationTurn[]; }
export interface ConversationTurn { role:'user'|'model'; parts:Record<string,unknown>[]; }
export interface GeneratedImage { dataUrl:string; mimeType:string; }
export interface Citation { title:string; url:string; }
export interface GenerateResult { images:GeneratedImage[]; text:string; citations:Citation[]; suggestions:Citation[]; searchHtml?:string; usage:Record<string,number>; model:string; conversation:ConversationTurn[]; }
export interface BatchJob { name:string; state:string; created?:string; images:GeneratedImage[]; errors:number; citations?:Citation[]; suggestions?:Citation[]; }
/** x/y offset the layer bitmap in document pixels; the bitmap keeps pixels moved outside the canvas. */
export interface Layer { id:string; name:string; dataUrl:string; visible:boolean; opacity:number; x?:number; y?:number; blendMode?:BlendMode; }
export interface Project { version:1; name:string; width:number; height:number; layers:Layer[]; }
export const DEFAULT_SETTINGS:GenerationSettings={size:'1K',ratio:'1:1',thinking:'medium',webSearch:false,imageSearch:false};
