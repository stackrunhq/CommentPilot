import {createHash} from 'node:crypto';
export function draftVersion(r){return createHash('sha256').update(JSON.stringify([r.workId,r.commentId,r.text,r.reply,r.generation?.references?.contextHash||''])).digest('hex');}
export function approveDraft(r){if(!r.reply?.trim())throw Error('请先生成草稿');r.reviewRequired=true;r.approvedVersion=draftVersion(r);r.reviewApproved=true;}
export function assertApproved(r,required=false){if((required||r.reviewRequired)&&r.approvedVersion!==draftVersion(r))throw Object.assign(Error('当前草稿尚未审核或已修改，请重新审核'),{code:'DRAFT_NOT_APPROVED'});}
