const gates=new Map();
export async function requestSlot(app,interval=250){
  const previous=gates.get(app)||{tail:Promise.resolve(),last:0};gates.set(app,previous);
  const turn=previous.tail.then(async()=>{const delay=Math.max(0,previous.last+interval-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));previous.last=Date.now();});previous.tail=turn.catch(()=>{});await turn;
}
