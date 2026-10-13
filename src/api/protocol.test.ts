import { describe,it,expect } from 'vitest';
import { buildRequest,decodeResult,decodeBatch,batchName,safeUrl,statusMessage } from './protocol';
import { DEFAULT_SETTINGS } from '../types';
import { compositePixels,importProject,exportProject } from '../lib/editor';
describe('image protocol',()=>{
  it('drops oldest complete pairs to enforce 14 images across history and current input',()=>{
    const image={inlineData:{mimeType:'image/png',data:'YQ=='}};
    const history=Array.from({length:6},(_,i)=>({role:(i%2?'model':'user') as 'user'|'model',parts:[image,image,image,{thoughtSignature:String(i)}]}));
    const b=buildRequest({prompt:'continue',media:[{mimeType:'image/png',data:'YQ=='}],settings:DEFAULT_SETTINGS,history});
    const turns=b.contents as {role:string;parts:Record<string,unknown>[]}[];
    expect(turns).toHaveLength(5);expect(turns[0].parts[3].thoughtSignature).toBe('2');expect(turns.slice(0,-1).flatMap(t=>t.parts).filter(p=>p.inlineData)).toHaveLength(12);
  });
  it('uses documented image/thinking/search parameters with no fake mask field',()=>{const b=buildRequest({prompt:'edit',media:[{mimeType:'image/png',data:'YQ=='}],settings:{...DEFAULT_SETTINGS,imageSearch:true}});expect(b).toMatchObject({generationConfig:{imageConfig:{imageSize:'1K',aspectRatio:'1:1'},thinkingConfig:{thinkingLevel:'MEDIUM'}},tools:[{google_search:{searchTypes:{imageSearch:{}}}}]});expect(JSON.stringify(b)).not.toContain('apiKey');expect(b).not.toHaveProperty('mask');});
  it('keeps thought signatures in subsequent turns while hiding thought images',()=>{const raw={candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{inlineData:{mimeType:'image/png',data:'YQ=='},thoughtSignature:'sig'}, {text:'result'}]},groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)',title:'bad'}},{web:{uri:'https://example.com',title:'ok'}}]}}]};const r=decodeResult(raw,buildRequest({prompt:'edit',media:[],settings:DEFAULT_SETTINGS}));expect(r.images).toHaveLength(1);expect(r.text).toBe('result');expect(r.conversation[1].parts[1].thoughtSignature).toBe('sig');expect(r.citations).toEqual([{url:'https://example.com/',title:'ok'}]);});
  it('rejects large, invalid, and over-count media',()=>{expect(()=>buildRequest({prompt:'',media:[],settings:DEFAULT_SETTINGS})).toThrow();expect(()=>buildRequest({prompt:'edit',media:Array(15).fill({mimeType:'image/png',data:'YQ=='}),settings:DEFAULT_SETTINGS})).toThrow();expect(()=>buildRequest({prompt:'edit',media:[{mimeType:'image/svg+xml',data:'YQ=='}],settings:DEFAULT_SETTINGS})).toThrow();});
  it('validates Batch names and accepts inline outputs with individual failures',()=>{expect(()=>batchName('batches/../../keys')).toThrow();expect(()=>batchName('https://evil.example')).toThrow();expect(decodeBatch({name:'batches/job1',done:true,response:{inlinedResponses:{inlinedResponses:[{error:{}},{response:{candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'YQ=='}}]}}]}}]}}})).toMatchObject({state:'BATCH_STATE_SUCCEEDED',errors:1,images:[{mimeType:'image/png'}]});});
  it('limits links and error details',()=>{expect(safeUrl('https://user:secret@example.com')).toBeNull();expect(safeUrl('data:text/html,bad')).toBeNull();expect(statusMessage(403)).not.toContain('raw');});
  it('rejects malformed Batch state and output arrays before they reach rendering',()=>{
    for(const state of [{},42])expect(()=>decodeBatch({name:'batches/test',metadata:{state}})).toThrow('Batch応答');
    expect(()=>decodeBatch({name:'batches/test',response:{inlinedResponses:{inlinedResponses:{}}}})).toThrow('Batch応答');
    expect(decodeBatch({name:'batches/test',metadata:{state:'BATCH_STATE_RUNNING',createTime:{}},response:{inlinedResponses:{inlinedResponses:[null]}}})).toMatchObject({errors:1,created:undefined});
  });
  it('ignores malformed optional grounding fields and invalid usage numbers',()=>{
    const request=buildRequest({prompt:'edit',media:[],settings:DEFAULT_SETTINGS});
    const result=decodeResult({candidates:[{content:{parts:[{text:'ok'}]},groundingMetadata:{groundingChunks:{},webSearchQueries:{},searchEntryPoint:{renderedContent:{}}}}],usageMetadata:{good:2,bad:Infinity,negative:-1}},request);
    expect(result).toMatchObject({text:'ok',citations:[],suggestions:[],usage:{good:2},searchHtml:undefined});
    expect(()=>decodeResult({candidates:[{content:{parts:[null]}}]},request)).toThrow('画像応答');
  });
});
describe('pixel preservation and project safety',()=>{
  it('preserves every zero-mask RGBA byte and exactly adopts opaque selections',()=>{const base=new Uint8ClampedArray([10,20,30,0,40,50,60,255,1,2,3,255]);const candidate=new Uint8ClampedArray([255,255,255,255,100,110,120,255,250,240,230,0]);const mask=new Uint8ClampedArray([255,0,0,0,0,0,0,255,0,0,0,128]);const out=compositePixels(base,candidate,mask);expect([...out.slice(0,4)]).toEqual([...base.slice(0,4)]);expect([...out.slice(4,8)]).toEqual([...candidate.slice(4,8)]);expect(out[11]).toBe(127);expect(out[8]).toBe(1);});
  it('exports only project schema, never extra credentials or remote resources',async()=>{const p={version:1,name:'test',width:1,height:1,layers:[{id:'1',name:'layer',dataUrl:'data:image/png;base64,YQ==',visible:true,opacity:1}],apiKey:'dummy-secret'};expect(await exportProject(p as any).text()).not.toContain('dummy-secret');expect(()=>importProject(JSON.stringify({...p,layers:[{...p.layers[0],dataUrl:'https://evil.example/image.png'}]}))).toThrow();expect(()=>importProject(JSON.stringify({...p,width:16384,height:16384}))).toThrow();});
});
