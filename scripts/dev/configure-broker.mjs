import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const folder=path.resolve('broker-data');await mkdir(folder,{recursive:true});
const file=path.join(folder,'broker.env');await writeFile(file,[
  'BROKER_PORT=4321','BROKER_DATA_DIR=broker-data/vault',
  'BROKER_ENCRYPTION_KEY='+randomBytes(32).toString('hex'),
  "BROKER_DEVICES='"+JSON.stringify({desktop1:randomBytes(32).toString('hex')})+"'",
  'DOUYIN_CLIENT_KEY=','DOUYIN_CLIENT_SECRET=',
  'DOUYIN_REDIRECT_URI=https://auth.example.com/oauth/douyin/callback',
  'DOUYIN_SCOPES=user_info,video.list,item.comment',''
].join('\n'),{flag:'wx',mode:0o600});console.log('Created ignored broker configuration. Fill approved application settings locally; do not distribute it with the desktop app.');
