import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {Storage} from '../storage.js';
import {samplePlan,parseSubtitles,MediaManager,probeMedia,describeFrame,transcribeAudio} from '../media.js';
import {groundedContext} from '../knowledge.js';
const run=promisify(execFile);
test('long videos use bounded sampling across the whole duration',()=>{const p=samplePlan(3600,5,60);assert.equal(p.count,60);assert.equal(p.interval,60);assert.throws(()=>samplePlan(7201));assert.throws(()=>samplePlan(10,0,60));});
test('SRT/VTT preserve timestamps, markup removed, plain text is not fabricated into subtitles',()=>{assert.deepEqual(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:03.500\n<b>你好</b>\n世界\n'),[{time:1,end:3.5,text:'你好\n世界'}]);assert.equal(parseSubtitles('普通文案没有时间轴').length,0);assert.equal(parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\n字幕\n')[0].time,1);});
test('unreviewed media is excluded, accepted media is work-scoped and changes grounding hash',()=>{const c={video:'https://douyin.com/video/123',context:'已确认资料'},content={id:'123',body:'',caption:{accepted:true,text:'完整文案'},media:{accepted:false,text:'未核对识别'}};const first=groundedContext(c,content);assert.ok(first.text.includes('完整文案'));assert.ok(!first.text.includes('未核对识别'));content.media.accepted=true;const second=groundedContext(c,content);assert.ok(second.text.includes('未核对识别'));assert.notEqual(second.references.contextHash,first.references.contextHash);assert.ok(!groundedContext({...c,video:'https://douyin.com/video/456'},content).text.includes('完整文案'));});
test('real FFmpeg decodes video/audio/subtitles; GIF page sampling and uploads are work-scoped',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-media-unit-'));const storage=new Storage(dir);storage.saveWork({url:'https://douyin.com/video/123'});storage.saveWork({url:'https://douyin.com/video/456'});
  const manager=new MediaManager(storage,{recognize:async images=>({pages:images.map(()=>({text:'TEST 123',engine:'fixture-ocr',confidence:95}))})});
  try{
    const srt=path.join(dir,'sub.srt');await writeFile(srt,'1\n00:00:00,000 --> 00:00:01,500\n内嵌字幕\n');const video=path.join(dir,'clip.mkv');
    await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc=size=320x180:rate=2','-f','lavfi','-i','sine=frequency=1000:sample_rate=16000','-i',srt,'-map','0:v','-map','1:a','-map','2:s','-t','2','-c:v','mpeg4','-c:a','pcm_s16le','-c:s','srt',video],{windowsHide:true});
    const meta=await probeMedia(video);assert.ok(meta.video&&meta.audio);assert.equal(meta.subtitles.length,1);
    const asset=await manager.upload('123','../clip.mkv',Readable.from([await readFile(video)]));assert.equal(asset.name,'clip.mkv');assert.equal(manager.assets('456').length,0);
    assert.equal((await manager.upload('123','clip.mkv',Readable.from([await readFile(video)]))).id,asset.id);assert.equal(manager.assets('123').length,1);
    const gif=await sharp(Buffer.from([255,0,0,0,0,255]),{raw:{width:1,height:2,channels:3,pageHeight:1}}).gif({delay:[100,200],loop:0}).toBuffer();
    await manager.upload('123','animation.gif',Readable.from([gif]));await manager.upload('123','caption.txt',Readable.from([Buffer.from('完整发布文案')]));
    let done;const job=manager.start('123',{interval:1,maxFrames:8},async j=>{done=j;});
    for(let i=0;i<200&&manager.active;i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(manager.job(job.id).status,'done',manager.job(job.id).error);assert.ok(done.text.includes('内嵌字幕'));assert.ok(done.text.includes('完整发布文案'));assert.ok(done.segments.filter(s=>s.kind==='ocr').length>=2);assert.ok(done.warnings.some(w=>w.includes('未选择语音')));assert.equal(done.accepted,false);
    await assert.rejects(()=>manager.upload('123','evil.exe',Readable.from(['x'])),/扩展名/);await assert.rejects(()=>manager.upload('999','a.txt',Readable.from(['x'])),/具体作品/);
    await manager.remove('123',asset.id);assert.equal(manager.assets('123').length,2);
    assert.throws(()=>manager.start('123',{visionConnectionId:'cloud'},async()=>{}),/确认/);
  }finally{storage.db.close();await rm(dir,{recursive:true,force:true});}
});
test('vision and speech send media only through explicitly selected connections',async()=>{
  const previous=globalThis.fetch,requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json(String(url).endsWith('/audio/transcriptions')?{text:'语音内容'}:{message:{content:'画面文字'}});};
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-media-model-'));
  try{const png=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();const c={baseUrl:'http://127.0.0.1:11434',protocol:'ollama',auth:'none',model:'vision-fixture',timeout:5,maxTokens:2048};assert.equal(await describeFrame(c,png,new AbortController().signal),'画面文字');assert.ok(JSON.parse(requests[0].options.body).messages[0].images[0]);
    const wav=path.join(dir,'audio.wav');await writeFile(wav,Buffer.from('fixture'));await assert.rejects(()=>transcribeAudio(c,wav,new AbortController().signal),/不支持/);
    assert.equal(await transcribeAudio({...c,baseUrl:'http://127.0.0.1:9000/v1',protocol:'chat'},wav,new AbortController().signal),'语音内容');assert.equal(requests[1].options.body.get('model'),'vision-fixture');assert.ok(requests[1].options.body.get('file') instanceof Blob);
  }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('cancellation cannot publish partially recognized text and interrupted jobs recover explicitly',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-media-cancel-')),storage=new Storage(dir);storage.saveWork({url:'https://douyin.com/video/123'});let finish;
  const manager=new MediaManager(storage,{recognize:async()=>new Promise(resolve=>{finish=()=>resolve({pages:[{text:'不得采用的部分结果'}]});})});
  try{const image=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer();await manager.upload('123','a.png',Readable.from([image]));let adopted=false;const job=manager.start('123',{},async()=>{adopted=true;});for(let i=0;i<100&&!finish;i++)await new Promise(r=>setTimeout(r,10));assert.ok(finish);manager.cancel();finish();await manager.active.completion;assert.equal(manager.job(job.id).status,'cancelled');assert.equal(adopted,false);
    manager.saveJob({id:'interrupted-fixture',workId:'123',status:'running'});const recovered=new MediaManager(storage);assert.equal(recovered.job('interrupted-fixture').status,'interrupted');
  }finally{storage.db.close();await rm(dir,{recursive:true,force:true,maxRetries:3});}
});
