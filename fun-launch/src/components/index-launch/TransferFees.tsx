import type { Config, IndexView } from '@/lib/index-launch/types';
import { explorer, number, shorten } from '@/lib/index-launch/types';

export function TransferFeeSetup({config,onChange}:{config:Config;onChange:(next:Config)=>void}) {
  const mode=config.transferFeeMode || 'off';
  return <section className="transfer-fee-panel">
    <div className="section-heading"><div><h3>Put token transfer fees to work</h3><p>A separate fee on token transfers. Choose what the scheduled worker does with the collected tokens.</p></div></div>
    <div className="segmented" role="group" aria-label="Transfer fee model">
      {([['off','No transfer fee'],['rewards','Reward holders'],['burn','Burn fee tokens']] as const).map(([value,label])=><button type="button" key={value} className={mode===value?'active':''} aria-pressed={mode===value} onClick={()=>onChange({...config,transferFeeMode:value,transferFeeBps:value==='off'?0:config.transferFeeBps||100})}>{label}</button>)}
    </div>
    {mode!=='off' && <>
      <div className="form-grid">
        <label className="field">Transfer fee (%)<input type="number" min="0.01" max="10" step="0.01" value={config.transferFeeBps/100} onChange={e=>onChange({...config,transferFeeBps:Math.round(Number(e.target.value)*100)})}/></label>
        <label className="field">Run every (seconds)<input type="number" min="30" max="86400" step="30" value={config.transferFeeInterval} onChange={e=>onChange({...config,transferFeeInterval:Number(e.target.value)})}/></label>
        <label className="field">Minimum collected tokens<input type="number" min="0.000001" max="1000000" step="0.001" value={config.transferFeeMinAmount} onChange={e=>onChange({...config,transferFeeMinAmount:Number(e.target.value)})}/></label>
      </div>
      <div className="transfer-fee-flow" aria-label="Transfer fee example"><span>100 {config.symbol} transferred</span><span>→ {number(config.transferFeeBps/100)} collected</span><span>→ {mode==='burn'?'Permanently burned':'Distributed to eligible holders'}</span></div>
      <p>{mode==='burn'?'The worker burns collected tokens directly. No market buy is involved.':'The worker snapshots eligible holder balances at each cycle and pays proportional rewards in this token. Reward transfers also incur the token transfer fee.'}</p>
      <div className="info-callout"><strong>Automation starts with your signed launch.</strong><p>The launch funds a dedicated devnet fee worker with 0.02 SOL for transaction costs. It can collect withheld fees and spend its own balance; it cannot spend your treasury. You can pause it or top it up later. The fee rate is fixed for this launch.</p></div>
      <p>Creator, worker and pool accounts are excluded from rewards. This is separate from the SOL trading-fee split above.</p>
    </>}
  </section>;
}

export function TransferFeePanel({index,owner,busy,run}:{index:IndexView;owner:boolean;busy:boolean;run:(action:string,fields?:Record<string,unknown>)=>unknown}) {
  const policy=index.config;
  if(!policy.transferFeeMode || policy.transferFeeMode==='off')return null;
  const status=index.transferFees;
  const units=(value?:string)=>number(Number(value||'0')/1e6,6);
  return <section className="transfer-fee-panel panel">
    <div className="section-heading"><div><h2>{policy.transferFeeMode==='burn'?'Scheduled fee-token burn':'Scheduled holder rewards'}</h2><p>{number(policy.transferFeeBps/100)}% transfer fee · Every {policy.transferFeeInterval} seconds · Minimum {number(policy.transferFeeMinAmount)} {policy.symbol}</p></div><span className="status-pill">{status?.enabled?'Running':status?'Paused':'Loading worker'}</span></div>
    <div className="metrics-grid"><div><span>Collected tokens</span><strong>{units(status?.collectedRaw)}</strong></div><div><span>{policy.transferFeeMode==='burn'?'Burned tokens':'Distributed tokens (gross)'}</span><strong>{units(policy.transferFeeMode==='burn'?status?.burnedRaw:status?.distributedRaw)}</strong></div><div><span>Worker gas</span><strong>{status?number(status.fundingBalance,6):'—'} SOL</strong></div></div>
    <p>{policy.transferFeeMode==='burn'?'Collected fee tokens are permanently destroyed. Trading-fee buybacks remain a separate operation below.':'Rewards use the cycle’s eligible onchain holder balances. Received amounts are net of the token transfer fee; rounding dust stays for a later cycle.'}</p>
    {status?.nextRunAt && <p>Next scheduled check: {new Date(status.nextRunAt).toLocaleString('en-GB')}</p>}
    {status?.lastError && <div role="status" className="info-callout">{status.lastError}</div>}
    {status?.authority && <p>Fee worker: <a href={explorer(status.authority)} target="_blank" rel="noreferrer">{shorten(status.authority)}</a></p>}
    {owner && <div className="button-row"><button className="button secondary" disabled={busy||!status} onClick={()=>run('automation',{indexId:index.id,enabled:!status?.enabled})}>{status?.enabled?'Pause automation':'Resume automation'}</button><button className="button secondary" disabled={busy||!status} onClick={()=>run('fund-automation',{indexId:index.id,amount:'0.02'})}>Add 0.02 devnet SOL for gas</button></div>}
    {!!status?.receipts?.length && <div className="receipt-list">{status.receipts.slice(0,8).map(receipt=><div key={receipt.signature}><span>{receipt.action}</span><a href={explorer(receipt.signature,'tx')} target="_blank" rel="noreferrer">{shorten(receipt.signature)}</a></div>)}</div>}
  </section>;
}
