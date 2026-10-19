export function pollDelay(interval,startedAt,now=Date.now()){return Math.max(0,interval*1000-(now-startedAt));}
