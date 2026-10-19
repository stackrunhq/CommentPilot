import {readFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Storage} from '../storage.js';
const original=JSON.parse(await readFile('data/state.json','utf8'));
// Exercise a copy in the private data tree, never inside distributable output.
const dir=await mkdtemp(path.resolve('data/qa-migration-'));
const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(original));
let storage=new Storage(dir);assert.equal(storage.state().records.length,original.records?.length||0);storage.close();storage=new Storage(dir);assert.equal(storage.state().records.length,original.records?.length||0);storage.close();
console.log('Actual legacy data migration passed; records: '+(original.records?.length||0)+'. Original untouched.');
