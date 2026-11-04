import { useRef, useState } from 'react';
import type { WorkshopState } from './types';

export function useWorkshop() {
  const busy = useRef(false);
  const [pending, setPending] = useState<string>();
  const [result, setResult] = useState<WorkshopState>();
  const [error, setError] = useState<string>();

  async function run(action: string, fields: Record<string, string> = {}) {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    setError(undefined);
    try {
      const response = await fetch('/api/workshop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...fields }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Workshop action failed.');
      setResult(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Workshop action failed.');
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  }

  return { run, result, pending, error };
}
