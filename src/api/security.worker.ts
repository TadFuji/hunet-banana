/// <reference lib="webworker" />
import { MODEL } from '../types';
import type { GenerateRequest } from '../types';
import { ORIGIN,buildRequest,decodeResult,decodeBatch,batchName,statusMessage } from './protocol';
let key='';
const controllers=new Set<AbortController>();
function redact(value:unknown):unknown {if(typeof value==='string')return key?value.split(key).join('[redacted]'):value;if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)]));return value;}
async function call(path:string,body?:Record<string,unknown>):Promise<any>{
  if(!key)throw new Error('APIキーを接続してください');
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
  try{const response=await fetch(ORIGIN+path,{method:body?'POST':'GET',headers:{'x-goog-api-key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'origin',cache:'no-store'});
    if(!response.ok)throw new Error(statusMessage(response.status));
    const reader=response.body?.getReader();if(!reader)throw new Error('Googleの応答を読み込めませんでした');
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>80_000_000){await reader.cancel();throw new Error('応答が大きすぎます');}chunks.push(chunk.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const text=new TextDecoder().decode(bytes);
    try{return JSON.parse(text);}catch{throw new Error('Googleの応答を読み込めませんでした');}
  }finally{clearTimeout(timer);controllers.delete(controller);}
}
self.onmessage=async(event:MessageEvent)=>{const {id,action,payload}=event.data;
  try{let result:unknown;
    if(action==='setKey'){if(typeof payload!=='string'||payload.trim().length<12||payload.length>512||/[\r\n\s]/.test(payload.trim()))throw new Error('APIキーの形式を確認してください');key=payload.trim();result=true;}
    else if(action==='cancel'){for(const c of controllers)c.abort();result=true;}
    else if(action==='generate'){const body=buildRequest(payload);result=decodeResult(await call(`/v1/models/${MODEL}:generateContent`,body),body);}
    else if(action==='createBatch'){if(!Array.isArray(payload)||payload.length<1||payload.length>20)throw new Error('Batchは1〜20件にしてください');if(payload.some((r:GenerateRequest)=>r.settings.webSearch||r.settings.imageSearch))throw new Error('Batchでは検索をオフにしてください。検索付き生成は通常の生成をご利用ください');const requests=payload.map((r:GenerateRequest,i:number)=>({request:buildRequest(r),metadata:{key:String(i+1)}}));const body={batch:{displayName:'Nano Banana Studio',inputConfig:{requests:{requests}}}};if(JSON.stringify(body).length>19_000_000)throw new Error('Batchは合計20MB以内にしてください');result=decodeBatch(await call(`/v1beta/models/${MODEL}:batchGenerateContent`,body));}
    else if(action==='getBatch')result=decodeBatch(await call(`/v1beta/${batchName(payload)}`));
    else if(action==='cancelBatch'){await call(`/v1beta/${batchName(payload)}:cancel`,{});result=true;}
    else throw new Error('未対応の操作です');
    self.postMessage({id,result:redact(result)});
  }catch(error){const message=error instanceof Error?error.message:'';const known=/^(APIキー|指示|参照|生成設定|会話履歴|画像が|画像・履歴|Batch|Google|利用枠|指定モデル|応答が|未対応)/.test(message);self.postMessage({id,error:known?redact(message):'通信が中断されました。必要なら再試行してください'});}
};
