import {mkdir,readdir,lstat,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function files(root,prefix=''){if((await lstat(root)).isSymbolicLink())throw Error('备份目录不能是符号链接');const result=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){const relative=path.join(prefix,entry.name),info=await lstat(path.join(root,relative));if(info.isSymbolicLink())throw Error('备份不支持符号链接');if(info.isDirectory())result.push(...await files(root,relative));else if(info.isFile())result.push(relative);}return result;}
function safe(root,name){if(typeof name!=='string'||path.isAbsolute(name)||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('备份文件路径无效');const target=path.resolve(root,name);if(!target.startsWith(path.resolve(root)+path.sep))throw Error('备份路径越界');return target;}
export async function fullBackup(storage){
  const folder=path.join(storage.dir,'backups','Full-'+Date.now()+'-'+randomUUID().slice(0,8));await mkdir(folder,{recursive:true});const dbfile=await storage.backup();await copyFile(dbfile,path.join(folder,'commentpilot.sqlite'));
  try{for(const name of await files(path.join(storage.dir,'media'))){const target=path.join(folder,'media',name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(storage.dir,'media',name),target);}}catch(error){if(error.code!=='ENOENT')throw error;}
  const entries=[];for(const name of await files(folder)){const source=path.join(folder,name);entries.push({name:name.split(path.sep).join('/'),size:(await lstat(source)).size,sha256:await hash(source)});}
  await writeFile(path.join(folder,'manifest.json'),JSON.stringify({format:'commentpilot-full-backup-v1',createdAt:new Date().toISOString(),credentials:'Windows DPAPI CurrentUser; same user and machine required',entries},null,2));return {folder,files:entries.length};
}
export async function verifyBackup(folder){
  if((await lstat(folder)).isSymbolicLink())throw Error('备份目录不能是符号链接');const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));if(manifest.format!=='commentpilot-full-backup-v1'||!Array.isArray(manifest.entries)||manifest.entries.length>50000)throw Error('备份清单无效');
  const seen=new Set();for(const e of manifest.entries){const file=safe(folder,e.name);if(e.name!=='commentpilot.sqlite'&&!e.name.startsWith('media/'))throw Error('备份包含不支持的文件');if(seen.has(e.name))throw Error('备份文件重复');seen.add(e.name);const parts=e.name.split('/');let cursor=folder;for(const part of parts.slice(0,-1)){cursor=path.join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('备份路径包含符号链接');}const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==e.size||await hash(file)!==e.sha256)throw Error('备份文件完整性校验失败');}
  if(!seen.has('commentpilot.sqlite'))throw Error('备份缺少数据库');const db=new DatabaseSync(path.join(folder,'commentpilot.sqlite'),{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('数据库完整性校验失败');}finally{db.close();}return manifest;
}
export async function restoreBackup(folder,destination){
  const manifest=await verifyBackup(folder);await mkdir(destination); // Never overwrite an existing data directory.
  for(const e of manifest.entries){const target=safe(destination,e.name);await mkdir(path.dirname(target),{recursive:true});await copyFile(safe(folder,e.name),target);}
  return {folder:destination,files:manifest.entries.length};
}
