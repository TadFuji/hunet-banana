/// <reference lib="webworker" />
import { MODEL } from '../types';
import type { GenerateRequest } from '../types';
import { ORIGIN,buildRequest,decodeResult,decodeBatch,batchName,statusMessage } from './protocol';
let key='';
let generationVersion:'v1'|'v1beta'='v1';
class ApiError extends Error { constructor(readonly status:number){super(statusMessage(status));} }
const controllers=new Set<AbortController>();
function redact(value:unknown):unknown {if(typeof value==='string')return key?value.split(key).join('[redacted]'):value;if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)]));return value;}
async function call(path:string,body?:Record<string,unknown>):Promise<any>{
  if(!key)throw new Error('APIキーを接続してください');
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),180000);
  try{const response=await fetch(ORIGIN+path,{method:body?'POST':'GET',headers:{'x-goog-api-key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'origin',cache:'no-store'});
    if(!response.ok)throw new ApiError(response.status);
    const reader=response.body?.getReader();if(!reader)throw new Error('Googleの応答を読み込めませんでした');
    const chunks:Uint8Array[]=[];let length=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>80_000_000){await reader.cancel();throw new Error('応答が大きすぎます');}chunks.push(chunk.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const text=new TextDecoder().decode(bytes);
    try{return JSON.parse(text);}catch{throw new Error('Googleの応答を読み込めませんでした');}
  }finally{clearTimeout(timer);controllers.delete(controller);}
}
async function checkModel(version:'v1'|'v1beta',forGeneration=false):Promise<string>{
  try {
    const model=await call(`/${version}/models/${MODEL}`);
    return model?.name===`models/${MODEL}`&&Array.isArray(model.supportedGenerationMethods)&&model.supportedGenerationMethods.includes('generateContent')?'available':'unsupported';
  } catch(error) {
    if(!(error instanceof ApiError)||forGeneration&&error.status!==404)throw error;
    return error.status===404?'notFound':error.status===401||error.status===403?'denied':error.status===429?'limited':'failed';
  }
}
async function diagnoseModel():Promise<string>{
  const labels:Record<string,string>={available:'モデル情報と生成メソッド対応を確認',unsupported:'画像生成への対応を確認できません',notFound:'対象モデルを取得できません（404）',denied:'キーの権限・制限を確認してください',limited:'利用枠・レート制限',failed:'Googleとの通信エラー'};
  const stable=await checkModel('v1');const beta=await checkModel('v1beta');
  return `モデルの利用確認：v1 ${labels[stable]} ／ v1beta ${labels[beta]}。画像生成は実行していません。実際の生成・課金・利用枠は未確認です。`;
}
async function generate(input:GenerateRequest):Promise<unknown>{
  const body=buildRequest(input);
  try { return decodeResult(await call(`/${generationVersion}/models/${MODEL}:generateContent`,body),body); }
  catch(error){
    if(!(error instanceof ApiError)||error.status!==404)throw error;
    if(generationVersion==='v1'&&await checkModel('v1beta',true)==='available'){
      try {const result=decodeResult(await call(`/v1beta/models/${MODEL}:generateContent`,body),body);generationVersion='v1beta';return result;}
      catch(betaError){if(!(betaError instanceof ApiError)||betaError.status!==404)throw betaError;}
    }
    throw new Error('指定モデル Nano Banana 2.1 を利用できません。キー設定の「モデル接続を確認（生成なし）」で確認してください');
  }
}
self.onmessage=async(event:MessageEvent)=>{const {id,action,payload}=event.data;
  try{let result:unknown;
    if(action==='setKey'){if(typeof payload!=='string'||payload.trim().length<12||payload.length>512||/[\r\n\s]/.test(payload.trim()))throw new Error('APIキーの形式を確認してください');key=payload.trim();generationVersion='v1';result=true;}
    else if(action==='cancel'){for(const c of controllers)c.abort();result=true;}
    else if(action==='diagnoseModel')result=await diagnoseModel();
    else if(action==='generate')result=await generate(payload);
    else if(action==='createBatch'){if(!Array.isArray(payload)||payload.length<1||payload.length>20)throw new Error('Batchは1〜20件にしてください');if(payload.some((r:GenerateRequest)=>r.settings.webSearch||r.settings.imageSearch))throw new Error('Batchでは検索をオフにしてください。検索付き生成は通常の生成をご利用ください');const requests=payload.map((r:GenerateRequest,i:number)=>({request:buildRequest(r),metadata:{key:String(i+1)}}));const body={batch:{displayName:'Nano Banana Studio',inputConfig:{requests:{requests}}}};if(JSON.stringify(body).length>19_000_000)throw new Error('Batchは合計20MB以内にしてください');result=decodeBatch(await call(`/v1beta/models/${MODEL}:batchGenerateContent`,body));}
    else if(action==='getBatch')result=decodeBatch(await call(`/v1beta/${batchName(payload)}`));
    else if(action==='cancelBatch'){await call(`/v1beta/${batchName(payload)}:cancel`,{});result=true;}
    else throw new Error('未対応の操作です');
    self.postMessage({id,result:redact(result)});
  }catch(error){const message=error instanceof Error?error.message:'';const known=/^(APIキー|指示|参照|生成設定|会話履歴|画像が|画像・履歴|Batch|Google|利用枠|指定モデル|応答が|未対応)/.test(message);self.postMessage({id,error:known?redact(message):'通信が中断されました。必要なら再試行してください'});}
};
