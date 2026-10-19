// One bounded turn per work; a slow/busy work cannot consume another work's turn.
export class WorkScheduler {
  constructor({now=()=>Date.now(),gap=1000,concurrency=1}={}){this.now=now;this.gap=gap;this.concurrency=concurrency;this.jobs=new Map();this.cursor=0;this.inflight=new Set();this.nextAt=0;}
  get busy(){return this.inflight.size>0;}
  add(id,run,interval=10000){if(this.jobs.has(id))throw Error('该作品已经在监听');this.jobs.set(id,{id,run,interval,nextAt:this.now(),active:true});}
  stop(id){const job=this.jobs.get(id);if(job)job.active=false;this.jobs.delete(id);}
  stopAll(){for(const id of this.jobs.keys())this.stop(id);}
  active(id){return this.jobs.get(id)?.active===true;}
  async tick(){
    if(this.inflight.size>=this.concurrency||this.now()<this.nextAt)return;
    const jobs=[...this.jobs.values()];if(!jobs.length)return;
    for(let n=0;n<jobs.length;n++){
      const index=(this.cursor+n)%jobs.length,job=jobs[index];if(!job.active||this.inflight.has(job)||job.nextAt>this.now())continue;
      this.cursor=(index+1)%jobs.length;this.inflight.add(job);this.nextAt=this.now()+this.gap;
      try{await job.run(job);}finally{job.nextAt=this.now()+job.interval;this.nextAt=Math.max(this.nextAt,this.now()+this.gap);this.inflight.delete(job);}
      break;
    }
  }
}
