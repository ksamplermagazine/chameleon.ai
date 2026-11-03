import {readFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Comfy} from '@comfyorg/sdk';
import {ComfyLow} from '@comfyorg/sdk/low';
export class CloudError extends Error {
 constructor(message,status=502,code='cloud_error',ambiguous=false){super(message);Object.assign(this,{status,code,ambiguous});}
}
// Official SDK for all Cloud operations; low-level SDK for links and bounded streams.
export class ComfyClient {
 constructor({apiKey,fetchImpl=fetch}){
  this.base=new URL(process.env.COMFY_BASE_URL||'https://cloud.comfy.org');
  if(this.base.origin!=='https://cloud.comfy.org'||this.base.pathname!=='/')throw new CloudError('This app targets Comfy Cloud. Remove a different COMFY_BASE_URL.');
  const transport=async(input,options={})=>{
   const url=new URL(input instanceof Request?input.url:String(input),this.base);
   const headers=new Headers(options.headers||{});
   if(url.origin!==this.base.origin&&(url.protocol!=='https:'||url.hostname!=='storage.googleapis.com'||headers.has('Authorization')))throw new CloudError('Unexpected Cloud API or storage link.');
   return fetchImpl(input,options);
  };
  this.sdk=new Comfy({apiKey,fetch:transport,timeoutMs:45000,clientInfo:'chameleon/0.1'});
  this.low=new ComfyLow(this.base.origin,apiKey,{fetch:transport,timeoutMs:45000,clientInfo:'chameleon/0.1'});
 }
 link(path){const u=new URL(path,this.base.origin);if(u.origin!==this.base.origin)throw new CloudError('Unexpected Cloud API link.');return u.href;}
 async safe(fn,submit=false){try{return await fn();}catch(e){
  if(e instanceof CloudError)throw e;
  const status=e.httpStatus||e.status;const code=e.code||'transport';
  const ambiguous=submit&&(!status||status>=500||code==='idempotency_key_reuse');
  const text=ambiguous?'Submission outcome is unknown. Do not submit again. Check Cloud for this request.':({401:'Cloud API key was rejected.',402:'Cloud credits are insufficient.',403:'This Cloud resource is not accessible.',429:'Cloud is busy. The SDK queue retry budget was exhausted.'}[status]||'Cloud request failed. Your existing job is retained.');
  throw new CloudError(text,status||502,code,ambiguous);
 }}
 async upload(filePath,contentType,fileName){return this.safe(async()=>{
  const asset=this.sdk.assets.fromBytes(await readFile(filePath),{filename:fileName,contentType});
  return asset.asReference(AbortSignal.timeout(45000));
 });}
 async submit(graph,key){return this.safe(async()=>{
  const wf=this.sdk.workflows.fromJson(structuredClone(graph));
  const job=await this.sdk.submit(wf,{idempotencyKey:key,signal:AbortSignal.timeout(45000)});
  return {id:job.id,status:job.status,urls:job.urls};
 },true);}
 getJob(path){const link=this.link(path);return this.safe(()=>this.low.getJob(link));}
 cancel(path){const link=this.link(path);return this.safe(()=>this.low.cancelJob(link));}
 async download(assetId,destination){return this.safe(async()=>{
  const response=await this.low.getAssetContent(assetId,{signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.body)throw new CloudError('Output download failed. Refresh to retry the download, not the generation.');
  let size=0;const limit=new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>128*1024*1024)return cb(new Error('Output exceeds 128 MB.'));cb(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(destination));return size;
 });}
}
