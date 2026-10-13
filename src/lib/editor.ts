import type { Layer, MediaInput, Project } from '../types';

const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MIME = new Set(['image/png','image/jpeg','image/webp','application/pdf','video/mp4','video/webm','video/quicktime']);
const MAX_PIXELS = 32_000_000;
export const MAX_PROJECT_PIXELS = 128_000_000;
export function uid():string { return crypto.randomUUID(); }
export function loadImage(dataUrl:string):Promise<HTMLImageElement> {
  if (!IMAGE.test(dataUrl)) return Promise.reject(new Error('PNG・JPEG・WebP画像を選んでください'));
  return new Promise((resolve,reject)=>{const image=new Image(); image.onload=()=>image.width<=16384&&image.height<=16384&&image.width*image.height<=MAX_PIXELS?resolve(image):reject(new Error('画像は各辺16,384px・3,200万画素以内にしてください')); image.onerror=()=>reject(new Error('画像を読み込めませんでした')); image.src=dataUrl;});
}
export function createBlank(width:number,height:number):string {const c=document.createElement('canvas');c.width=width;c.height=height;return c.toDataURL('image/png');}
export async function renderProject(project:Project):Promise<HTMLCanvasElement> {
  const canvas=document.createElement('canvas');canvas.width=project.width;canvas.height=project.height;
  const ctx=canvas.getContext('2d')!;
  for(const layer of project.layers) if(layer.visible){ctx.globalAlpha=layer.opacity;ctx.drawImage(await loadImage(layer.dataUrl),layer.x??0,layer.y??0,canvas.width,canvas.height);}
  ctx.globalAlpha=1;return canvas;
}
export function canvasToMedia(canvas:HTMLCanvasElement,label?:string):MediaInput {return {mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1],label};}
/** Copy zero-mask pixels directly: preserving RGBA values does not depend on the model. */
export function compositePixels(base:Uint8ClampedArray,candidate:Uint8ClampedArray,mask:Uint8ClampedArray):Uint8ClampedArray {
  if(base.length!==candidate.length || base.length!==mask.length) throw new Error('画像サイズが一致しません');
  const out=new Uint8ClampedArray(base);
  for(let i=0;i<out.length;i+=4){const a=mask[i+3]/255;if(a===0)continue;if(a===1){out.set(candidate.subarray(i,i+4),i);continue;}
    const ba=base[i+3]/255,ca=candidate[i+3]/255,alpha=ba*(1-a)+ca*a;
    for(let c=0;c<3;c++)out[i+c]=alpha===0?0:(base[i+c]*ba*(1-a)+candidate[i+c]*ca*a)/alpha;
    out[i+3]=alpha*255;
  }return out;
}
export async function applyMask(baseDataUrl:string,candidateDataUrl:string,maskCanvas:HTMLCanvasElement):Promise<string> {
  const [base,candidate]=await Promise.all([loadImage(baseDataUrl),loadImage(candidateDataUrl)]);
  if(Math.abs(base.width/base.height-candidate.width/candidate.height)/(base.width/base.height)>.015)throw new Error('候補の縦横比が元画像と異なります。比率を合わせて再生成してください');
  const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.drawImage(base,0,0);const original=ctx.getImageData(0,0,canvas.width,canvas.height);
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(candidate,0,0,canvas.width,canvas.height);const proposed=ctx.getImageData(0,0,canvas.width,canvas.height);
  const m=document.createElement('canvas');m.width=canvas.width;m.height=canvas.height;m.getContext('2d')!.drawImage(maskCanvas,0,0,m.width,m.height);
  const mask=m.getContext('2d')!.getImageData(0,0,m.width,m.height);
  original.data.set(compositePixels(original.data,proposed.data,mask.data));ctx.putImageData(original,0,0);return canvas.toDataURL('image/png');
}
export function downloadBlob(blob:Blob,filename:string):void {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function fileToMedia(file:File):Promise<MediaInput> {
  if(!MIME.has(file.type))throw new Error('PNG・JPEG・WebP・PDF・MP4・WebM・MOVに対応しています');
  if(file.size>14*1024*1024)throw new Error('各ファイルは14MB以内にしてください。合計リクエストも20MB以内です');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {mimeType:file.type,data:btoa(binary),label:file.name.slice(0,150)};
}
export function importProject(text:string):Project {
  if(text.length>180_000_000)throw new Error('プロジェクトが大きすぎます');
  const p=JSON.parse(text);
  if(!p || p.version!==1 || typeof p.name!=='string' || p.name.length>150 || !Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>16384||p.height>16384||p.width*p.height>MAX_PIXELS||!Array.isArray(p.layers)||p.layers.length>40||p.width*p.height*p.layers.length>MAX_PROJECT_PIXELS)throw new Error('プロジェクトの形式またはサイズが不正です');
  const ids=new Set<string>();
  const layers=p.layers.map((l:Record<string,unknown>)=>{if(typeof l.id!=='string'||l.id.length>100||ids.has(l.id)||typeof l.name!=='string'||l.name.length>150||typeof l.dataUrl!=='string'||!IMAGE.test(l.dataUrl)||typeof l.visible!=='boolean'||typeof l.opacity!=='number'||!Number.isFinite(l.opacity)||l.opacity<0||l.opacity>1||!validOffset(l.x)||!validOffset(l.y))throw new Error('レイヤーの形式が不正です');ids.add(l.id);
    const layer:Layer={id:l.id,name:l.name,dataUrl:l.dataUrl,visible:l.visible,opacity:l.opacity};if(l.x)layer.x=l.x as number;if(l.y)layer.y=l.y as number;return layer;});
  return {version:1,name:p.name,width:p.width,height:p.height,layers};
}
const validOffset=(value:unknown)=>value===undefined||Number.isInteger(value)&&Math.abs(value as number)<=16384;
export function exportProject(project:Project):Blob {return new Blob([JSON.stringify(importProject(JSON.stringify(project)))],{type:'application/json'});}
/** Validate every embedded image before replacing the current document. */
export async function validateProjectImages(project:Project):Promise<void> {
  let pixels=0;
  for(const layer of project.layers){
    const image=await loadImage(layer.dataUrl);
    pixels+=image.naturalWidth*image.naturalHeight;
    if(pixels>MAX_PROJECT_PIXELS)throw new Error('レイヤー画像の合計は1億2800万画素以内にしてください');
  }
}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('nano-banana-projects',1);req.onupgradeneeded=()=>req.result.createObjectStore('projects');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('ローカル保存を開けませんでした'));});}
export async function saveProject(project:Project):Promise<void>{const safe=importProject(JSON.stringify(project));const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(safe,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('ローカル保存に失敗しました'));tx.onabort=()=>reject(new Error('ローカル保存を完了できませんでした'));});}finally{db.close();}}
export async function restoreProject():Promise<Project|null>{const db=await database();try{return await new Promise((resolve,reject)=>{const req=db.transaction('projects').objectStore('projects').get('current');req.onsuccess=()=>{try{resolve(req.result?importProject(JSON.stringify(req.result)):null);}catch{reject(new Error('保存したプロジェクトを読み込めませんでした'));}};req.onerror=()=>reject(new Error('ローカル保存を読み込めませんでした'));});}finally{db.close();}}
