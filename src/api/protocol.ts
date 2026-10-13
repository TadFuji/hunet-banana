import { MODEL, RATIOS } from '../types';
import type { GenerateRequest, GenerateResult, ConversationTurn, GeneratedImage, Citation, BatchJob } from '../types';
export const ORIGIN='https://generativelanguage.googleapis.com';
const MIME=new Set(['image/png','image/jpeg','image/webp','application/pdf','video/mp4','video/webm','video/quicktime']);
export function buildRequest(input:GenerateRequest):Record<string,unknown>{
  if(!input || typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw new Error('指示は1〜16,000文字で入力してください');
  const s=input.settings;
  if(!s||!['1K','2K','4K'].includes(s.size)||!(RATIOS as readonly string[]).includes(s.ratio)||!['minimal','medium','high'].includes(s.thinking)||typeof s.webSearch!=='boolean'||typeof s.imageSearch!=='boolean')throw new Error('生成設定を確認してください');
  if(!Array.isArray(input.media)||input.media.length>16||input.media.filter(m=>m.mimeType.startsWith('image/')).length>14)throw new Error('参照画像は14枚までです');
  const parts:Record<string,unknown>[]=[{text:input.prompt}];
  for(const m of input.media){if(!MIME.has(m.mimeType)||!m.data||!/^[A-Za-z0-9+/=]+$/.test(m.data))throw new Error('参照ファイルの形式が不正です');parts.push({inlineData:{mimeType:m.mimeType,data:m.data}});}
  const history=[...(input.history??[])];
  if(history.length>12||history.some(t=>!['user','model'].includes(t.role)||!Array.isArray(t.parts)))throw new Error('会話履歴を確認してください');
  const countImages=(turns:ConversationTurn[])=>turns.reduce((n,t)=>n+t.parts.filter(p=>{const d=(p.inlineData??p.inline_data) as {mimeType?:string;mime_type?:string}|undefined;return (d?.mimeType??d?.mime_type??'').startsWith('image/');}).length,0);
  while(history.length&&countImages([...history,{role:'user',parts}])>14)history.splice(0,2);
  const body:Record<string,unknown>={contents:[...history,{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],thinkingConfig:{thinkingLevel:s.thinking.toUpperCase()},imageConfig:{imageSize:s.size,aspectRatio:s.ratio}}};
  if(s.webSearch||s.imageSearch)body.tools=[{google_search:{searchTypes:{...(s.webSearch?{webSearch:{}}:{}),...(s.imageSearch?{imageSearch:{}}:{})}}}];
  while(history.length&&new TextEncoder().encode(JSON.stringify(body)).length>19_000_000){history.splice(0,2);body.contents=[...history,{role:'user',parts}];}
  if(new TextEncoder().encode(JSON.stringify(body)).length>19_000_000)throw new Error('画像・履歴を含む送信サイズが20MBを超えます。参照を減らすか画像を縮小してください');
  return body;
}
export function safeUrl(value:unknown):string|null {if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function decodeResult(raw:any,request:Record<string,unknown>):GenerateResult{
  const content=raw?.candidates?.[0]?.content;
  if(!content||!Array.isArray(content.parts))throw new Error('画像が返されませんでした。指示を変更して再試行してください');
  const images:GeneratedImage[]=[];const texts:string[]=[];
  for(const p of content.parts){if(p.thought)continue;const d=p.inlineData??p.inline_data;if(d&&['image/png','image/jpeg','image/webp'].includes(d.mimeType??d.mime_type)&&typeof d.data==='string'&&/^[A-Za-z0-9+/=]+$/.test(d.data))images.push({dataUrl:`data:${d.mimeType??d.mime_type};base64,${d.data}`,mimeType:d.mimeType??d.mime_type});if(typeof p.text==='string')texts.push(p.text);}
  const meta=raw.candidates[0].groundingMetadata??raw.candidates[0].grounding_metadata??{};
  const citations:Citation[]=[];
  for(const chunk of meta.groundingChunks??meta.grounding_chunks??[]){const item=chunk.web??chunk.image;const url=safeUrl(item?.uri??item?.url);if(url&&!citations.some(c=>c.url===url))citations.push({url,title:typeof item.title==='string'?item.title:url});}
  const suggestions:Citation[]=(meta.webSearchQueries??[]).filter((q:unknown)=>typeof q==='string').map((q:string)=>({title:q,url:`https://www.google.com/search?q=${encodeURIComponent(q)}`}));
  const usage=Object.fromEntries(Object.entries(raw.usageMetadata??{}).filter(([,v])=>typeof v==='number')) as Record<string,number>;
  const turns=[...(request.contents as ConversationTurn[]),{role:'model' as const,parts:content.parts}];
  // Keep complete user/model pairs so thought signatures survive iterative edits.
  const conversation=turns.slice(-6);
  return {images,text:texts.join('\n'),citations,suggestions,searchHtml:meta.searchEntryPoint?.renderedContent,usage,model:MODEL,conversation};
}
export function batchName(value:unknown):string {if(typeof value!=='string'||!/^batches\/[A-Za-z0-9_-]{1,200}$/.test(value))throw new Error('Batch IDの形式が不正です');return value;}
export function decodeBatch(raw:any):BatchJob {
  const name=batchName(raw?.name);const batch=raw.response??raw.metadata??raw;
  const entries=raw.response?.inlinedResponses?.inlinedResponses??raw.response?.output?.inlinedResponses?.inlinedResponses??batch.output?.inlinedResponses?.inlinedResponses??[];
  const images:GeneratedImage[]=[];let errors=0;
  for(const entry of entries){if(entry.error){errors++;continue;}try{images.push(...decodeResult(entry.response,{contents:[]}).images);}catch{errors++;}}
  return {name,state:batch.state??raw.metadata?.state??(raw.done?(raw.error?'BATCH_STATE_FAILED':'BATCH_STATE_SUCCEEDED'):'BATCH_STATE_PENDING'),created:batch.createTime??raw.metadata?.createTime,images,errors};
}
export function statusMessage(status:number):string {return status===400?'指示・ファイル・モデル設定を確認してください':status===401||status===403?'APIキーの権限・制限・課金設定を確認してください':status===429?'利用枠またはレート制限に達しました。Googleの割り当てを確認してください':status===404?'指定モデルまたはBatchが利用できません':'Googleとの通信に失敗しました。時間を置いて再試行してください';}
