import {readFile,writeFile,copyFile,access,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),release=path.join(root,'release');
const manifest=JSON.parse(await readFile(path.join(release,'stage/release-manifest.json'),'utf8'));
const backend=path.join(release,'win-unpacked/resources/backend');const hashes={};
for(const file of [...manifest.sources,'src/ui/index.html','src/ui/scripts/management.js','src/ui/scripts/projects.js','src/ui/scripts/official.js','src/ui/scripts/media-ui.js','src/ui/scripts/diagnostics.js','src/ui/scripts/reliability.js','src/ui/scripts/multiwork.js','src/ui/scripts/operations.js','src/ui/scripts/personal.js','src/ui/app.css','package.json','package-lock.json']){
  const source=await readFile(path.join(root,file)),packed=await readFile(path.join(backend,file));assert.ok(source.equals(packed),'Packaged source mismatch: '+file);hashes[file]=createHash('sha256').update(source).digest('hex');
}
for(const name of ['data','.env','state.json','commentpilot.sqlite','browser']){let present=false;try{await access(path.join(backend,name));present=true;}catch{}assert.equal(present,false,'Private path packaged: '+name);}
const executables=(await readdir(path.join(release,'win-unpacked'))).filter(n=>n.endsWith('.exe'));assert.deepEqual(executables,['CommentPilot.exe']);
const installer=`CommentPilot-Setup-${manifest.version}-x64.exe`;const bytes=await readFile(path.join(release,installer));const hash=createHash('sha256').update(bytes).digest('hex');
await copyFile(path.join(root,'docs/安装版使用说明.md'),path.join(release,'安装版使用说明.md'));
await writeFile(path.join(release,'SHA256SUMS.txt'),`${hash}  ${installer}\n`);
await writeFile(path.join(release,'BUILD-INFO.json'),JSON.stringify({product:'CommentPilot',version:manifest.version,builtAt:new Date().toISOString(),installer,size:bytes.length,sha256:hash,sourceHashes:hashes,privateDataExcluded:true,runtime:'Electron 44.8.0 / Node 24.22.0',database:'SQLite (node:sqlite)',credentialEncryption:'Windows DPAPI CurrentUser'},null,2));
console.log(JSON.stringify({installer,bytes:bytes.length,sha256:hash,sourcesVerified:Object.keys(hashes).length,privateDataExcluded:true}));
