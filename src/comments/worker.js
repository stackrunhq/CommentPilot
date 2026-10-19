import {retryable} from './queue.js';

export class CommentWorker{
  constructor(options){Object.assign(this,options);}
  scope(){return {account:this.official.accountFingerprint(),workId:this.target(),sessionId:this.session()?.sessionId};}
  ensure(record,stage='generate'){
    const {account,workId,sessionId}=this.scope();if(!account||!workId||!sessionId)throw Error('缺少监听会话，无法建立任务');
    return this.queue.ensure({account,workId,sessionId:record.sessionId||sessionId,commentKey:record.key,stage});
  }
  synchronize(){
    const {account,workId,sessionId}=this.scope();if(!account||!sessionId||this.session()?.account!==account)return;
    for(const r of this.records())if(!r.simulated&&r.workId===workId&&r.source==='douyin-official'){
      if(r.status==='new'&&r.sessionId===sessionId)this.ensure(r);
      if(r.status==='uncertain'&&r.submission?.account===account){const t=this.ensure(r,'verify');if(t.stage!=='verify')this.queue.advance(t,'verify');}
    }
  }
  async process(){
    this.synchronize();const {account,workId,sessionId}=this.scope();
    for(let n=0;n<(this.maxSteps||10)&&this.running();n++){
      const task=this.queue.claim(account,workId,sessionId);if(!task)break;const r=this.records().find(r=>r.key===task.commentKey);
      if(!r||r.simulated||r.workId!==workId||r.sessionId!==sessionId||['sent','ignored_history','ignored_own'].includes(r.status)){this.queue.save({...task,status:'cancelled'});continue;}
      try{
        if(task.stage==='generate'){
          if(r.status!=='draft')await this.draft(r);
          this.queue.advance(task,'send',this.config().autoSend?'ready':'review');
        }else{
          if(!this.config().autoSend){this.queue.save({...task,status:'review'});continue;}
          await this.send(r,()=>this.running());
          if(r.status==='uncertain')this.queue.advance(task,'verify');
          else if(r.status==='sent')this.queue.save({...task,status:'done'});
          else this.queue.save({...task,status:'review'});
        }
      }catch(error){
        if(!this.running()&&r.status==='draft'){this.queue.advance(task,'send');break;}
        const transient=task.stage==='generate'?retryable(error):r.status==='draft'&&!r.submission&&retryable(error);
        const failed=this.queue.fail(task,error,{retry:transient});this.logger.write('queue.task_failed',{workId,commentKey:r.key,status:failed.status,attempts:failed.attempts,nextAt:failed.nextAt,outcome:'failed'});
        if(!transient)this.stop();
      }
    }
  }
  async verify(){
    this.synchronize();const {account,workId}=this.scope();if(!account||!workId)return;
    const task=this.queue.claim(account,workId,null,{verifyOnly:true});if(!task)return;
    const r=this.records().find(r=>r.key===task.commentKey);
    if(!r||r.status==='sent'){this.queue.save({...task,status:'done'});return;}
    try{if(await this.reconcile(r))this.queue.save({...task,status:'done'});else this.queue.fail(task,Error('暂未找到唯一可确认回复，不会自动重发'),{retry:true});}
    catch(error){this.queue.fail(task,error,{retry:retryable(error)});}
  }
}
