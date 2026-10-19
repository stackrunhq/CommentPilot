import {createHash} from 'node:crypto';
export function commentKey(video, author, text) { return createHash('sha256').update(JSON.stringify([video, author, text])).digest('hex'); }
