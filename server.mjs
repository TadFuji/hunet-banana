import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './security-headers.mjs';
const root=resolve(fileURLToPath(new URL('./dist/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.pdf':'application/pdf'};
const server=http.createServer(async(req,res)=>{
  const headers=securityHeaders(/^\/assets\/security\.worker-[\w-]+\.js(?:\?|$)/.test(req.url??''));
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,headers);res.end();return;}
  try{const url=new URL(req.url??'/', 'http://localhost');const path=decodeURIComponent(url.pathname);const target=resolve(root,'.'+(path==='/'?'/index.html':path));if(!target.startsWith(root+sep)&&target!==resolve(root,'index.html'))throw new Error();const data=await readFile(target);res.writeHead(200,{...headers,'Content-Type':mime[extname(target)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404,headers);res.end('Not found');}
});
server.listen(Number(process.env.PORT??4173),process.env.HOST??'127.0.0.1',()=>console.log(`Nano Banana Studio: http://${process.env.HOST??'127.0.0.1'}:${process.env.PORT??4173}`));
