// One bounded turn per work; a slow/busy work cannot consume another work's turn.
export class WorkScheduler {
  constructor({now=()=>Date.now(),gap=1000}={}){this.now=now;this.gap=gap;this.jobs=new Map();this.cursor=0;this.busy=false;this.nextAt=0;}
  add(id,run,interval=10000){if(this.jobs.has(id))throw Error('该作品已经在监听');this.jobs.set(id,{id,run,interval,nextAt:this.now(),active:true});}
  stop(id){const job=this.jobs.get(id);if(job)job.active=false;this.jobs.delete(id);}
  stopAll(){for(const id of this.jobs.keys())this.stop(id);}
  active(id){return this.jobs.get(id)?.active===true;}
  async tick(){
    if(this.busy||this.now()<this.nextAt)return;
    const jobs=[...this.jobs.values()];if(!jobs.length)return;
    for(let n=0;n<jobs.length;n++){
      const index=(this.cursor+n)%jobs.length,job=jobs[index];if(!job.active||job.nextAt>this.now())continue;
      this.cursor=(index+1)%jobs.length;this.busy=true;
      try{await job.run(job);}finally{job.nextAt=this.now()+job.interval;this.nextAt=this.now()+this.gap;this.busy=false;}
      break;
    }
  }
}
