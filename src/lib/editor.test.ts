import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToMedia, importProject, validateProjectImages } from './editor';
import { encodePsdBinary, decodePsdBinary } from './psd';
import type { Project } from '../types';

afterEach(()=>vi.unstubAllGlobals());
const fixture=(count=1):Project=>({version:1,name:'test',width:64,height:64,layers:Array.from({length:count},(_,i)=>({id:String(i),name:'layer',dataUrl:'data:image/png;base64,YQ==',visible:false,opacity:1}))});
function decoder(width:number,height:number,valid=true){
  vi.stubGlobal('Image',class {
    width=width; height=height; naturalWidth=width; naturalHeight=height;
    onload?:()=>void; onerror?:()=>void;
    set src(_value:string){queueMicrotask(()=>valid?this.onload?.():this.onerror?.());}
  });
}
describe('atomic project image validation',()=>{
  it('checks hidden images and propagates a decoder failure',async()=>{
    decoder(64,64,false);
    await expect(validateProjectImages(fixture())).rejects.toThrow('画像を読み込めません');
  });
  it('checks actual dimensions rather than the declared document dimensions',async()=>{
    decoder(16385,1);
    await expect(validateProjectImages(fixture())).rejects.toThrow('16,384');
  });
  it('enforces the total decoded pixel budget without allocating large test images',async()=>{
    decoder(4000,4000);
    await expect(validateProjectImages(fixture(8))).resolves.toBeUndefined();
    await expect(validateProjectImages(fixture(9))).rejects.toThrow('1億2800万');
  });
});
describe('layer offsets and blend modes',()=>{
  const project=(extra:Record<string,unknown>)=>JSON.stringify({version:1,name:'p',width:64,height:64,layers:[{id:'a',name:'a',dataUrl:'data:image/png;base64,YQ==',visible:true,opacity:1,...extra}]});
  it('keeps integer offsets so moved pixels outside the canvas survive saving',()=>{
    expect(importProject(project({x:-40,y:12})).layers[0]).toMatchObject({x:-40,y:12});
    expect(importProject(project({})).layers[0]).not.toHaveProperty('x');
  });
  it('rejects non-integer or oversized offsets',()=>{
    expect(()=>importProject(project({x:1.5}))).toThrow('レイヤーの形式');
    expect(()=>importProject(project({y:20000}))).toThrow('レイヤーの形式');
    expect(()=>importProject(project({x:'5'}))).toThrow('レイヤーの形式');
  });
  it('preserves supported blend modes and rejects unknown blend modes',()=>{
    expect(importProject(project({blendMode:'multiply'})).layers[0].blendMode).toBe('multiply');
    expect(importProject(project({blendMode:'normal'})).layers[0].blendMode).toBeUndefined();
    expect(()=>importProject(project({blendMode:'dissolve'}))).toThrow('レイヤーの形式');
  });
});
describe('PSD binary encode and decode',()=>{
  it('round-trips multi-layer PSD with Unicode names, offsets, visibility, opacity, and blend modes',()=>{
    const l1=new Uint8ClampedArray([10,20,30,255, 40,50,60,128, 70,80,90,0, 100,110,120,255]);
    const l2=new Uint8ClampedArray([200,150,100,255, 50,60,70,255]);
    const composite=new Uint8ClampedArray(4*4);
    const bytes=encodePsdBinary({width:2,height:2,layers:[
      {name:'背景レイヤー',left:0,top:0,width:2,height:2,visible:true,opacity:1,blendMode:'normal',rgba:l1},
      {name:'乗算オーバーレイ ✨',left:-1,top:1,width:2,height:1,visible:false,opacity:128/255,blendMode:'multiply',rgba:l2},
    ],compositeRgba:composite});
    const decoded=decodePsdBinary(bytes);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.layers).toHaveLength(2);
    expect(decoded.layers[0]).toMatchObject({name:'背景レイヤー',left:0,top:0,width:2,height:2,visible:true,opacity:1,blendMode:'normal'});
    expect([...decoded.layers[0].rgba]).toEqual([...l1]);
    expect(decoded.layers[1].name).toBe('乗算オーバーレイ ✨');
    expect(decoded.layers[1].left).toBe(-1);
    expect(decoded.layers[1].top).toBe(1);
    expect(decoded.layers[1].visible).toBe(false);
    expect(decoded.layers[1].blendMode).toBe('multiply');
    expect(Math.round(decoded.layers[1].opacity*255)).toBe(128);
    expect([...decoded.layers[1].rgba]).toEqual([...l2]);
  });
  it('decodes RLE (PackBits) compressed flattened PSD and rejects oversized dimensions',()=>{
    // Build a minimal 2x1 RGB PSD with no layers and RLE-compressed Image Data section
    const buf=new ArrayBuffer(26+4+4+4 + 2 + 3*2 + 3*2);
    const view=new DataView(buf);
    const u8=new Uint8Array(buf);
    u8.set([0x38,0x42,0x50,0x53],0); // 8BPS
    view.setUint16(4,1); // v1
    view.setUint16(12,3); // 3 channels
    view.setUint32(14,1); // height = 1
    view.setUint32(18,2); // width = 2
    view.setUint16(22,8); // 8-bit
    view.setUint16(24,3); // RGB
    // color mode len (0), resources len (0), layer info len (0) at 26, 30, 34
    let o=38;
    view.setUint16(o,1); o+=2; // RLE compression
    // 3 rows (R, G, B), each row has byteCount = 2: [0xFF (-1 => repeat 2 times), value]
    for(let r=0;r<3;r++){view.setUint16(o,2);o+=2;}
    u8.set([0xFF,11, 0xFF,22, 0xFF,33],o);
    const decoded=decodePsdBinary(buf);
    expect(decoded.layers).toHaveLength(1);
    expect([...decoded.layers[0].rgba]).toEqual([11,22,33,255, 11,22,33,255]);

    // Inflate row byte count beyond buffer end -> must throw corruption error
    view.setUint16(40,100);
    expect(()=>decodePsdBinary(buf)).toThrow('破損');
    view.setUint16(40,2);

    view.setUint32(18,16385);
    expect(()=>decodePsdBinary(buf)).toThrow('16,384');
  });
});
describe('canvasToMedia payload size guard',()=>{
  it('downscales canvases above 2048px and falls back to lossy compression when PNG exceeds 3M base64 chars',()=>{
    const created:{width:number;height:number}[]=[];
    vi.stubGlobal('document',{
      createElement:()=>({
        width:0,
        height:0,
        getContext:()=>({drawImage:(_src:unknown,_x:number,_y:number,w:number,h:number)=>{created.push({width:w,height:h});}}),
        toDataURL:(mime?:string)=>mime==='image/webp'?`data:image/webp;base64,${'B'.repeat(500_000)}`:`data:image/png;base64,${'A'.repeat(3_500_000)}`,
      }),
    });
    const fakeCanvas={
      width:4096,
      height:3072,
      toDataURL:()=>`data:image/png;base64,${'A'.repeat(18_000_000)}`,
    } as unknown as HTMLCanvasElement;
    const result=canvasToMedia(fakeCanvas,'編集元画像');
    expect(created).toEqual([{width:2048,height:1536}]);
    expect(result.mimeType).toBe('image/webp');
    expect(result.data.length).toBe(500_000);
    expect(result.label).toBe('編集元画像');
  });
});
