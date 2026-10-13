import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateProjectImages } from './editor';
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
