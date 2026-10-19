import {mkdir,copyFile,cp,writeFile,readFile,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {chromium} from 'playwright';
const run=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),stage=path.join(root,'release','stage');
const backend=path.join(stage,'backend');await mkdir(backend,{recursive:true});
const sources=['src/douyin/browser/readiness.js','src/comments/personal.js','src/douyin/request-gate.js','src/douyin/accounts.js','src/douyin/remote.js','src/douyin/broker-settings.js','src/comments/operations.js','src/knowledge/retrieval.js','src/knowledge/import.js','src/knowledge/import-worker.js','src/storage/full-backup.js','src/comments/scheduler.js','src/comments/queue.js','src/comments/worker.js','src/comments/scanner.js','src/comments/reconciliation.js','src/security/redaction.js','src/observability/logger.js','src/observability/diagnostics.js','src/app/server.js','src/app/config.js','src/app/paths.js','src/comments/identity.js','src/comments/state.js','src/comments/polling.js','src/works/identity.js','src/works/content.js','src/knowledge/context.js','src/models/providers.js','src/models/reply.js','src/storage/database.js','src/security/credentials.js','src/security/credentials.ps1','src/douyin/official.js','src/douyin/browser/comments.js','src/douyin/browser/navigation.js','src/douyin/browser/network.js','src/media/service.js','src/media/context.js','src/media/ocr.js','src/media/windows-ocr.ps1'];
for(const file of sources){await mkdir(path.dirname(path.join(backend,file)),{recursive:true});await copyFile(path.join(root,file),path.join(backend,file));}
await cp(path.join(root,'src/ui'),path.join(backend,'src/ui'),{recursive:true});
await copyFile(path.join(root,'package.json'),path.join(backend,'package.json'));await copyFile(path.join(root,'package-lock.json'),path.join(backend,'package-lock.json'));
const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
await run(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:backend,timeout:300000,maxBuffer:200000});
// ffmpeg-static downloads its executable during installation. Stage the already-installed
// binary explicitly because release dependency installation intentionally disables scripts.
const ffmpegBinary=(await import('ffmpeg-static')).default;
await copyFile(ffmpegBinary,path.join(backend,'node_modules','ffmpeg-static',path.basename(ffmpegBinary)));
// Full Chromium and support binaries; never copy developer browser profiles.
const browserRoot=path.dirname(path.dirname(chromium.executablePath()));const parent=path.dirname(browserRoot);
for(const name of [path.basename(browserRoot),...(await readdir(parent)).filter(name=>/^(ffmpeg|winldd)-\d+$/.test(name))]){const source=path.join(parent,name);try{await access(source);await cp(source,path.join(stage,'browsers',name),{recursive:true});}catch(error){if(name===path.basename(browserRoot))throw error;}}
await mkdir(path.join(root,'build'),{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="112" fill="#2563eb"/><path d="M112 132h288v214H233l-91 65v-65h-30z" fill="white"/><circle cx="190" cy="238" r="19" fill="#2563eb"/><circle cx="256" cy="238" r="19" fill="#2563eb"/><circle cx="322" cy="238" r="19" fill="#2563eb"/></svg>';
await sharp(Buffer.from(svg)).png().toFile(path.join(root,'build','icon.png'));const png=await sharp(Buffer.from(svg)).resize(256,256).png().toBuffer();
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);await writeFile(path.join(root,'build','icon.ico'),Buffer.concat([header,png]));
await writeFile(path.join(stage,'release-manifest.json'),JSON.stringify({version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,sources,browser:path.basename(browserRoot),excludes:['data','API keys','cookies','comment records']},null,2));
console.log('Release staging completed: '+stage);
