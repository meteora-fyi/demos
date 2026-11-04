import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fieldClass, Workshop } from '@/components/Workshop';
import { useWorkshop } from '@/lib/workshop/useWorkshop';

const names = ['Mock SOL', 'Mock BTC', 'Mock USD'];

export default function IndexFund() {
  const { run, result, pending, error } = useWorkshop();
  const [weights, setWeights] = useState(['50', '30', '20']);
  const [holder, setHolder] = useState('alice');
  const [shares, setShares] = useState('100');
  const initialized = Boolean(result?.initialized);
  const actions = { holder, shares };

  useEffect(() => { void run('status'); }, []); // Fetch the current in-memory workshop session once.

  return (
    <Workshop
      title="Conviction Index"
      description="Build a basket around a thesis. Issue and redeem reserve-backed shares at mock NAV, then share transfer-fee revenue with holders."
      result={result} pending={pending} error={error}
    >
      {!initialized ? (
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          void run('launch', Object.fromEntries(weights.map((weight, index) => ['weight' + index, weight])));
        }}>
          <h2 className="text-lg font-semibold">Launch a basket</h2>
          <p className="text-sm">Give each mock asset a positive whole weight. Weights must total 100%. Each asset starts at a fixed mock price of $1.</p>
          {names.map((name, index) => (
            <label key={name} className="block space-y-1 text-sm">
              <span>{name} weight (%)</span>
              <input className={fieldClass} required inputMode="numeric" pattern="[0-9]{1,2}" autoComplete="off"
                value={weights[index]} onChange={(event) => setWeights(weights.map((weight, position) =>
                  position === index ? event.target.value : weight))} />
            </label>
          ))}
          <Button type="submit" size="lg" disabled={Boolean(pending)}>Launch basket</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          void run('subscribe', actions);
        }}>
          <h2 className="text-lg font-semibold">Manage shares</h2>
          <p className="text-sm">Subscription costs 0.001 SOL per share plus the underlying basket. Share transfers withhold 2%, capped at 100 shares per transfer.</p>
          <label className="block space-y-1 text-sm">
            <span>Workshop holder</span>
            <select className={fieldClass} value={holder} onChange={(event) => setHolder(event.target.value)}>
              <option value="alice">Alice</option><option value="bob">Bob</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Whole shares</span>
            <input className={fieldClass} required inputMode="numeric" pattern="[0-9]{1,4}" autoComplete="off"
              value={shares} onChange={(event) => setShares(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={Boolean(pending)}>Subscribe</Button>
            <Button type="button" size="lg" variant="outline" disabled={Boolean(pending)}
              onClick={() => void run('redeem', actions)}>Redeem</Button>
            <Button type="button" size="lg" variant="outline" disabled={Boolean(pending)}
              onClick={() => void run('transfer', actions)}>Transfer to {holder === 'alice' ? 'Bob' : 'Alice'}</Button>
          </div>
          <p className="text-sm">A server cron checks for rebates every 30 seconds. Rebate transfers also incur the share transfer fee.</p>
          <Button type="button" size="lg" variant="outline" disabled={Boolean(pending)}
            onClick={() => void run('rebate')}>Run rebate now</Button>
        </form>
      )}
      <Button type="button" size="lg" variant="ghost" disabled={Boolean(pending)}
        onClick={() => void run('status')}>Refresh confirmed state</Button>
    </Workshop>
  );
}
