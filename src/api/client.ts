import type { BatchJob,GenerateRequest,GenerateResult } from '../types';
let worker:Worker|null=null;let nextId=0;let idle:ReturnType<typeof setTimeout>|undefined;
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
const IDLE_MS=15*60*1000;
function clearKey():void{worker?.terminate();worker=null;clearTimeout(idle);for(const p of pending.values())p.reject(new Error('APIキーの接続を解除しました'));pending.clear();window.dispatchEvent(new Event('gemini-key-cleared'));}
function touch():void{if(!worker)return;clearTimeout(idle);idle=setTimeout(clearKey,IDLE_MS);}
function rpc<T>(action:string,payload?:unknown):Promise<T>{if(!worker)return Promise.reject(new Error('APIキーを接続してください'));touch();return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});worker!.postMessage({id,action,payload});});}
async function setKey(key:string):Promise<void>{if(import.meta.env.DEV)throw new Error('キーの接続は本番用ビルドで行ってください。npm run build と npm start を実行してください');clearKey();worker=new Worker(new URL('./security.worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{const {id,result,error}=event.data;const p=pending.get(id);if(!p)return;pending.delete(id);if(error)p.reject(new Error(error));else p.resolve(result);};worker.onerror=()=>clearKey();try{await rpc('setKey',key);}catch(e){clearKey();throw e;}}
window.addEventListener('pagehide',clearKey);
for(const name of ['pointerdown','keydown','wheel'])window.addEventListener(name,touch,{passive:true});
export const geminiClient={setKey,clearKey,generate:(r:GenerateRequest)=>rpc<GenerateResult>('generate',r),createBatch:(r:GenerateRequest[])=>rpc<BatchJob>('createBatch',r),getBatch:(name:string)=>rpc<BatchJob>('getBatch',name),cancelBatch:(name:string)=>rpc<boolean>('cancelBatch',name),cancel:()=>{void rpc('cancel').catch(()=>{});}};
