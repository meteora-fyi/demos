import { runTransferFeeTick } from '../lib/chain.mjs';
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
while(!stopping){
  try{await runTransferFeeTick();}catch{console.error('Transfer-fee worker could not finish its scheduled check.');}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,30_000));
}
