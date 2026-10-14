import { test, expect, type Page } from '@playwright/test';

const KEY='DUMMY_ONLY_REVIEW_KEY_DO_NOT_USE_2026';
async function connect(page:Page,key=KEY){
  await page.getByRole('button',{name:'APIキーを設定',exact:true}).click();
  await page.getByLabel('Gemini APIキー',{exact:true}).fill(key);
  await page.getByRole('button',{name:'このタブに設定する'}).click();
  await expect(page.getByRole('button',{name:'キー接続中'})).toBeVisible();
}
async function image(page:Page,color='blue',width=64,height=64){
  return page.evaluate(({color,width,height})=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
    return c.toDataURL('image/png');
  },{color,width,height});
}
async function importFixture(page:Page,layers=1){
  const dataUrl=await image(page);
  const project={version:1,name:'Review fixture',width:64,height:64,layers:Array.from({length:layers},(_,i)=>({id:`base-${i}`,name:`Original ${i}`,visible:i===0,opacity:1,dataUrl}))};
  await page.locator('input[accept=".json,application/json"]').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.getByText('プロジェクトを読み込みました',{exact:true})).toBeVisible();
  await expect.poll(()=>page.getByLabel('編集中の画像',{exact:true}).evaluate((c:HTMLCanvasElement)=>c.width)).toBe(64);
  return project;
}
async function pixel(page:Page,x:number,y:number){
  return page.getByLabel('編集中の画像',{exact:true}).evaluate((c:HTMLCanvasElement,{x,y})=>Array.from(c.getContext('2d')!.getImageData(x,y,1,1).data),{x,y});
}
async function holdDecode(page:Page){
  await page.evaluate(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;
    const w=window as any;w.__decodeQueue=[];w.__holdDecode=true;
    Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value:string){
      const apply=()=>descriptor.set!.call(this,value);
      if(w.__holdDecode)w.__decodeQueue.push(apply);else apply();
    }});
  });
}
async function releaseDecode(page:Page){
  await page.evaluate(()=>{const w=window as any;w.__holdDecode=false;w.__decodeQueue.splice(0).forEach((fn:()=>void)=>fn());});
}

test('disconnect and reconnect during image preparation cannot charge the new key for the old operation',async({page,context})=>{
  await page.goto('/');await importFixture(page);await connect(page);
  const red=await image(page,'red');const sentKeys:string[]=[];
  await context.route('https://generativelanguage.googleapis.com/**',async route=>{
    sentKeys.push(route.request().headers()['x-goog-api-key']);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:red.split(',')[1]}}]}}]})});
  });
  await page.getByRole('tab',{name:'全体編集',exact:true}).click();await holdDecode(page);
  await page.getByRole('button',{name:'画像を生成',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__decodeQueue.length>0);
  await page.getByRole('button',{name:'キー接続中'}).click();
  await page.getByRole('button',{name:'キーを破棄して切断'}).click();
  await connect(page,'DUMMY_NEW_SESSION_REVIEW_KEY');await releaseDecode(page);
  // The old operation must settle before asserting no request; a new explicit operation is still allowed.
  await expect(page.getByRole('button',{name:'画像を生成',exact:true})).toBeEnabled();
  expect(sentKeys).toEqual([]);
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toHaveCount(0);
  await page.getByRole('button',{name:'画像を生成',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  expect(sentKeys).toEqual(['DUMMY_NEW_SESSION_REVIEW_KEY']);
});

test('invalid and hidden project images cannot replace the current document',async({page})=>{
  await page.goto('/');const original=await importFixture(page);
  for(const [dataUrl,message] of [['data:image/png;base64,YQ==','画像を読み込めません'],[await image(page,'red',16385,1),'16,384']]){
    const broken={...original,name:'BROKEN',layers:[...original.layers,{id:'broken-hidden',name:'Hidden',visible:false,opacity:1,dataUrl}]};
    await page.locator('input[accept=".json,application/json"]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByLabel('プロジェクト名',{exact:true})).toHaveValue(original.name);
    expect(await pixel(page,32,32)).toEqual([0,0,255,255]);
  }
});

test('corrupt IndexedDB projects do not replace the initial usable document',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'APIキーを設定',exact:true})).toBeVisible({timeout:7000});
  await page.evaluate(async()=>{
    await new Promise<void>((resolve,reject)=>{
      const open=indexedDB.open('nano-banana-projects',1);
      open.onsuccess=()=>{const db=open.result;const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({version:1,name:'BROKEN',width:1,height:1,layers:[{id:'bad',name:'hidden',visible:false,opacity:1,dataUrl:'data:image/png;base64,YQ=='}]},'current');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    });
  });
  await page.reload();await expect(page.getByRole('alert')).toContainText('復元できませんでした',{timeout:7000});await expect(page.getByLabel('プロジェクト名',{exact:true})).toHaveValue('Untitled studio');
  await expect.poll(()=>page.getByLabel('編集中の画像',{exact:true}).evaluate((c:HTMLCanvasElement)=>c.width)).toBe(1280);
});

test('a rejected adoption at 40 layers keeps the generated candidate',async({page,context})=>{
  await page.goto('/');await importFixture(page,40);const red=await image(page,'red');
  await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:red.split(',')[1]}}]}}]})}));
  await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();
  await page.getByRole('button',{name:'画像を生成',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  await page.getByRole('button',{name:'キャンバスに採用'}).click();
  await expect(page.getByRole('alert')).toContainText('40');
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  expect(await pixel(page,32,32)).toEqual([0,0,255,255]);
});

test('moving and expanding an old layer keeps its displayed size after a larger AI result',async({page,context})=>{
  await page.goto('/');await importFixture(page);const red=await image(page,'red',128,128);
  await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:red.split(',')[1]}}]}}]})}));
  await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await page.getByRole('button',{name:'キャンバスに採用'}).click();
  await page.getByRole('tab',{name:'レイヤー',exact:true}).click();
  const rows=page.locator('.layer-row');await rows.nth(1).locator('button').first().click();await rows.nth(0).locator('button').first().click();await rows.nth(0).click();
  await expect.poll(()=>pixel(page,100,100)).toEqual([0,0,255,255]);
  await page.getByRole('button',{name:'移動',exact:true}).click();
  const box=(await page.getByLabel('編集キャンバス',{exact:true}).boundingBox())!;
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
  await page.waitForFunction(()=>document.querySelector('.pointer-canvas')!==null);
  // Allow the actual image preparation to finish before dragging; the race is tested separately.
  await page.waitForTimeout(100);
  await page.mouse.move(box.x+27,box.y+20);await page.mouse.up();
  await expect.poll(()=>pixel(page,100,100)).toEqual([0,0,255,255]);
  page.once('dialog',dialog=>dialog.accept('160 × 160'));
  await page.getByRole('button',{name:'キャンバスを拡張',exact:true}).click();
  await expect(page.getByText('キャンバスを拡張しました',{exact:true})).toBeVisible();
  await expect.poll(()=>pixel(page,120,120)).toEqual([0,0,255,255]);
});

test('a delayed canvas expansion cannot overwrite edits made while decoding',async({page})=>{
  await page.goto('/');await importFixture(page);await holdDecode(page);
  page.once('dialog',dialog=>dialog.accept('128 × 128'));
  await page.getByRole('button',{name:'キャンバスを拡張',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__decodeQueue.length>0);
  await page.getByLabel('プロジェクト名',{exact:true}).fill('My newer edit');
  await releaseDecode(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('プロジェクト名',{exact:true})).toHaveValue('My newer edit');
  expect(await page.getByLabel('編集中の画像',{exact:true}).evaluate((c:HTMLCanvasElement)=>c.width)).toBe(64);
});

for(const shortcut of [false,true])test(`a ${shortcut?'keyboard':'button'} save does not mark later edits saved`,async({page})=>{
  await page.goto('/');await importFixture(page);
  await page.evaluate(()=>{
    const original=IDBDatabase.prototype.transaction;const w=window as any;w.__saveQueue=[];
    IDBDatabase.prototype.transaction=function(...args:any[]){
      const tx=Reflect.apply(original,this,args);
      if(args[1]==='readwrite')Object.defineProperty(tx,'oncomplete',{set(fn:(event:Event)=>void){tx.addEventListener('complete',event=>w.__saveQueue.push(()=>fn.call(tx,event)));}});
      return tx;
    } as any;
  });
  if(shortcut){await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Meta+s');}
  else await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__saveQueue.length>0);
  await page.getByLabel('プロジェクト名',{exact:true}).fill('Unsaved later edit');
  await page.evaluate(()=>(window as any).__saveQueue.splice(0).forEach((fn:()=>void)=>fn()));
  await expect(page.locator('.top-project')).toContainText('未保存');
  await page.reload();await expect(page.getByLabel('プロジェクト名',{exact:true})).toHaveValue('Review fixture',{timeout:7000});
});

test('late Batch A updates cannot replace Batch B or cancel the wrong job',async({page,context})=>{
  await page.goto('/');let pending:any;const calls:string[]=[];
  await context.route('https://generativelanguage.googleapis.com/**',async route=>{
    const url=route.request().url();calls.push(url);
    if(url.endsWith('/batches/jobA')){pending=route;return;}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(url.endsWith(':cancel')?{}:{name:'batches/jobB',metadata:{state:'BATCH_STATE_PENDING'}})});
  });
  await connect(page);await page.getByRole('button',{name:'Batch生成',exact:true}).click();
  const id=page.getByLabel('Batch ID',{exact:true});await id.fill('batches/jobA');await page.locator('.batch-section').getByRole('button',{name:'読込',exact:true}).click();await page.getByRole('button',{name:'更新',exact:true}).click();
  await expect.poll(()=>Boolean(pending)).toBe(true);
  await id.fill('batches/jobB');await page.locator('.batch-section').getByRole('button',{name:'読込',exact:true}).click();
  await pending.fulfill({contentType:'application/json',body:JSON.stringify({name:'batches/jobA',metadata:{state:'BATCH_STATE_SUCCEEDED'}})});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nbstudio.batch')!).name)).toBe('batches/jobB');
  await page.getByRole('button',{name:'中止',exact:true}).click();
  await expect.poll(()=>calls.some(url=>url.endsWith('/batches/jobB:cancel'))).toBe(true);
  expect(calls.some(url=>url.endsWith('/batches/jobA:cancel'))).toBe(false);
  await expect(id).toHaveValue('batches/jobB');
});

test('a pending Batch creation retains its returned job ID before switching jobs',async({page,context})=>{
  await page.goto('/');let pending:any;
  await context.route('https://generativelanguage.googleapis.com/**',route=>{pending=route;});
  await connect(page);await page.getByRole('button',{name:'Batch生成',exact:true}).click();
  await page.getByLabel('Batch生成の指示',{exact:true}).fill('A blue forest');
  await page.getByRole('button',{name:'Batchを開始',exact:true}).click();
  await expect.poll(()=>Boolean(pending)).toBe(true);
  const load=page.locator('.batch-section').getByRole('button',{name:'読込',exact:true});
  await page.getByLabel('Batch ID',{exact:true}).fill('batches/jobB');await expect(load).toBeDisabled();
  await pending.fulfill({contentType:'application/json',body:JSON.stringify({name:'batches/createdA',metadata:{state:'BATCH_STATE_PENDING'}})});
  await expect(page.getByLabel('Batch ID',{exact:true})).toHaveValue('batches/createdA');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nbstudio.batch')!).name)).toBe('batches/createdA');
  await expect(load).toBeEnabled();
});

test('malformed Batch state is reported without crashing the editor',async({page,context})=>{
  await page.goto('/');await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({name:'batches/jobA',metadata:{state:{}}})}));
  await connect(page);await page.getByRole('button',{name:'Batch生成',exact:true}).click();await page.getByLabel('Batch ID',{exact:true}).fill('batches/jobA');await page.locator('.batch-section').getByRole('button',{name:'読込',exact:true}).click();await page.getByRole('button',{name:'更新',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('プロジェクト名',{exact:true})).toBeVisible();
});

test('native image budget rejects an extra candidate while retaining the document and candidate',async({page,context})=>{
  await page.goto('/');const original=await importFixture(page,4);const red=await image(page,'red');
  await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:red.split(',')[1]}}]}}]})}));
  await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();
  // Report large decoded dimensions without allocating large browser images.
  await page.evaluate(dataUrl=>{
    for(const [field,value] of [['width',8000],['height',4000],['naturalWidth',8000],['naturalHeight',4000]] as const){
      const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,field)!;
      Object.defineProperty(HTMLImageElement.prototype,field,{...descriptor,get(){return this.src===dataUrl?value:descriptor.get!.call(this);}});
    }
  },original.layers[0].dataUrl);
  await page.getByRole('button',{name:'キャンバスに採用'}).click();
  await expect(page.getByRole('alert')).toContainText('1億2800万');
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  expect(await pixel(page,32,32)).toEqual([0,0,255,255]);
  await expect(page.locator('.status-info')).toContainText('4 レイヤー');
});

test('selection and name edits retain adopted thought signatures; history restores clear them',async({page,context})=>{
  await page.goto('/');await importFixture(page);const red=await image(page,'red');const requests:any[]=[];
  await context.route('https://generativelanguage.googleapis.com/**',route=>{
    requests.push(route.request().postDataJSON());
    return route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:red.split(',')[1]},thoughtSignature:'REVIEW_SIGNATURE'}]}}]})});
  });
  await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await page.getByRole('button',{name:'キャンバスに採用'}).click();
  await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeHidden();
  await page.getByLabel('プロジェクト名',{exact:true}).fill('Renamed after adoption');
  await page.getByRole('button',{name:'矩形選択',exact:true}).click();
  const box=(await page.getByLabel('編集キャンバス',{exact:true}).boundingBox())!;
  await page.mouse.move(box.x+5,box.y+5);await page.mouse.down();await page.mouse.move(box.x+25,box.y+25);await page.mouse.up();
  await page.getByRole('button',{name:'画像を生成',exact:true}).click();await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  expect(JSON.stringify(requests[1].contents)).toContain('REVIEW_SIGNATURE');
  await page.getByRole('button',{name:'破棄',exact:true}).click();
  await page.locator('.history-list .history-item').first().click();
  await page.getByRole('tab',{name:'全体編集',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();
  expect(JSON.stringify(requests[2].contents)).not.toContain('REVIEW_SIGNATURE');
});

for(const panel of ['bottom','right'])test(`${panel} history restore retains its selection through later edits`,async({page})=>{
  await page.goto('/');await importFixture(page);await page.getByRole('button',{name:'矩形選択',exact:true}).click();
  const box=(await page.getByLabel('編集キャンバス',{exact:true}).boundingBox())!;
  await page.mouse.move(box.x+5,box.y+5);await page.mouse.down();await page.mouse.move(box.x+25,box.y+25);await page.mouse.up();
  const mask=page.locator('.mask-canvas');
  await expect.poll(()=>mask.evaluate((c:HTMLCanvasElement)=>c.getContext('2d')!.getImageData(15,15,1,1).data[3])).toBe(255);
  const selected=await mask.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await page.locator('summary').filter({hasText:'選択範囲'}).click();await page.getByRole('button',{name:'選択を解除',exact:true}).click();
  if(panel==='right'){await page.getByRole('tab',{name:'履歴',exact:true}).click();await page.locator('.right-history button').nth(2).click();}
  else await page.locator('.history-list .history-item').nth(2).click();
  await expect.poll(()=>mask.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(selected);
  await page.getByLabel('プロジェクト名',{exact:true}).fill('After history restore');
  await expect.poll(()=>mask.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(selected);
});

test('moving a layer off the canvas and back keeps the pixels that were outside',async({page})=>{
  await page.goto('/');
  const dataUrl=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(0,0,16,64);return c.toDataURL('image/png');});
  const project={version:1,name:'Offscreen fixture',width:64,height:64,layers:[{id:'only',name:'Only',visible:true,opacity:1,dataUrl}]};
  await page.locator('input[accept=".json,application/json"]').setInputFiles({name:'offscreen.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.getByText('プロジェクトを読み込みました',{exact:true})).toBeVisible();
  await expect.poll(()=>pixel(page,4,32)).toEqual([255,0,0,255]);
  await page.getByRole('button',{name:'移動',exact:true}).click();
  const box=(await page.getByLabel('編集キャンバス',{exact:true}).boundingBox())!;
  const drag=async(from:number,to:number)=>{
    await page.mouse.move(box.x+box.width*from,box.y+box.height/2);await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(box.x+box.width*to,box.y+box.height/2,{steps:4});await page.mouse.up();
  };
  await drag(.5,.25);
  await expect(page.getByText('レイヤーを移動しました',{exact:true})).toBeVisible();
  await expect.poll(()=>pixel(page,4,32)).toEqual([0,0,0,0]);
  await drag(.25,.5);
  await expect.poll(()=>pixel(page,4,32)).toEqual([255,0,0,255]);
  // Exporting and reopening the project must keep the offset and the pixels outside the canvas.
  await drag(.5,.25);
  await expect.poll(()=>pixel(page,4,32)).toEqual([0,0,0,0]);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'プロジェクトを書き出す',exact:true}).click();
  const saved=await (await download).path();
  await page.locator('input[accept=".json,application/json"]').setInputFiles(saved);
  await expect.poll(()=>pixel(page,4,32)).toEqual([0,0,0,0]);
  await drag(.25,.5);
  await expect.poll(()=>pixel(page,4,32)).toEqual([255,0,0,255]);
});

test('a large adopted image fits the visible canvas area and zoom never changes its pixels',async({page,context})=>{
  await page.goto('/');await importFixture(page);const big=await image(page,'green',4096,2304);
  await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:big.split(',')[1]}}]}}]})}));
  await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await page.getByRole('button',{name:'キャンバスに採用'}).click();
  const canvas=page.getByLabel('編集中の画像',{exact:true});
  await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>[c.width,c.height])).toEqual([4096,2304]);
  const viewport=page.locator('.canvas-viewport');
  const fits=async()=>{const v=(await viewport.boundingBox())!;const c=(await canvas.boundingBox())!;return c.x>=v.x&&c.y>=v.y&&c.x+c.width<=v.x+v.width&&c.y+c.height<=v.y+v.height;};
  await expect.poll(fits).toBe(true);
  const fitted=(await canvas.boundingBox())!.width;
  await page.getByRole('button',{name:'拡大',exact:true}).click();
  await expect.poll(async()=>(await canvas.boundingBox())!.width).toBeGreaterThan(fitted);
  await page.getByRole('button',{name:'実寸で表示',exact:true}).click();
  await expect(page.getByLabel('表示倍率',{exact:true})).toHaveText('100%');
  await expect.poll(async()=>Math.round((await canvas.boundingBox())!.width)).toBe(4096);
  await page.getByRole('button',{name:'全体を表示',exact:true}).click();
  await expect.poll(fits).toBe(true);
  const v=(await viewport.boundingBox())!;await page.mouse.move(v.x+v.width/2,v.y+v.height/2);
  await page.keyboard.down('Control');await page.mouse.wheel(0,-300);await page.keyboard.up('Control');
  await expect.poll(async()=>(await canvas.boundingBox())!.width).toBeGreaterThan(fitted+1);
  expect(await canvas.evaluate((c:HTMLCanvasElement)=>[c.width,c.height])).toEqual([4096,2304]);
  expect(await pixel(page,4000,2200)).toEqual([0,128,0,255]);
});
