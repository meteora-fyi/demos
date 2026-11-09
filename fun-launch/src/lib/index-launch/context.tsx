import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { Pending, State } from './types';

type AppContext = {
  state: State | null;
  error: string;
  notice: string;
  busy: string;
  loading: boolean;
  wallet: string;
  refresh: () => Promise<void>;
  run: (
    action: string,
    fields?: Record<string, unknown>,
  ) => Promise<State | undefined>;
  connect: () => void;
  clearError: () => void;
  pending: Pending | null;
  resume: () => Promise<void>;
};
const Context = createContext<AppContext>(null!);
export function IndexProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const { publicKey, signTransaction } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const stateRef = useRef<State | null>(null);
  const busyRef = useRef(false);
  const requests = useRef<Record<string, string>>({});
  const apply = useCallback((next: State) => {
    if (next.indexes) {
      stateRef.current = next;
      setState(next);
    }
    setPending(next.pending || null);
    if (next.notice) setNotice(next.notice);
  }, []);
  const request = useCallback(
    async (body?: Record<string, unknown>): Promise<State> => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/index-launch${!body && publicKey ? `?wallet=${encodeURIComponent(publicKey.toBase58())}` : ''}`,
        {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: body
            ? {
                'Content-Type': 'application/json',
                ...(stateRef.current?.csrfToken
                  ? { 'X-CSRF-Token': stateRef.current.csrfToken }
                  : {}),
              }
            : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || 'The request could not be completed.');
      const result = data.state
        ? { ...data.state, ...data, state: undefined }
        : data;
      apply(result);
      return result;
    },
    [apply, publicKey],
  );
  const refresh = useCallback(async () => {
    try {
      await request();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load indexes.');
    } finally {
      setLoading(false);
    }
  }, [request]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 20000);
    return () => clearInterval(id);
  }, [refresh]);
  const complete = useCallback(
    async (initial: State): Promise<State> => {
      let response = initial;
      let steps = 0;
      while (response.pending) {
        if (++steps > 20)
          throw new Error(
            'This operation needs additional steps. Resume it from the activity panel.',
          );
        const prepared = response.pending;
        if (prepared.wallet && prepared.wallet !== publicKey?.toBase58())
          throw new Error(
            'Connect the wallet that started this operation to resume it.',
          );
        setPending(prepared);
        if (!prepared.transaction) {
          response = await request({
            action: 'resume',
            operationId: prepared.operationId,
          });
          continue;
        }
        setBusy(prepared.description || 'Review transaction in your wallet');
        if (!signTransaction)
          throw new Error(
            'Connect a wallet that supports transaction signing.',
          );
        const tx = Transaction.from(
          Buffer.from(prepared.transaction, 'base64'),
        );
        const signed = await signTransaction(tx);
        setBusy('Confirming on Solana devnet');
        response = await request({
          action: 'submit',
          operationId: prepared.operationId,
          signedTransaction: Buffer.from(signed.serialize()).toString('base64'),
        });
      }
      setPending(null);
      return response;
    },
    [request, signTransaction, publicKey],
  );
  const run = useCallback(
    async (action: string, fields: Record<string, unknown> = {}) => {
      if (busyRef.current) return;
      if (!['preview', 'add-asset'].includes(action) && !publicKey) {
        setShowModal(true);
        setError('Connect your wallet to continue.');
        return;
      }
      busyRef.current = true;
      setBusy(
        action === 'quote'
          ? 'Getting current quote'
          : action === 'add-asset'
            ? 'Adding basket asset'
            : 'Preparing transaction',
      );
      setError('');
      setNotice('');
      const key = `${action}:${JSON.stringify(fields)}:${publicKey?.toBase58() || ''}`;
      const requestId =
        requests.current[key] || (requests.current[key] = crypto.randomUUID());
      try {
        const response = await request({
          action,
          ...fields,
          wallet: publicKey?.toBase58(),
          requestId,
        });
        const result = ['quote', 'preview', 'scenario', 'add-asset'].includes(
          action,
        )
          ? response
          : await complete(response);
        delete requests.current[key];
        return result;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'The operation was not completed.',
        );
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    },
    [publicKey, setShowModal, request, complete],
  );
  const resume = useCallback(async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      await complete(
        await request({ action: 'resume', operationId: pending.operationId }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume.');
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  }, [pending, complete, request]);
  return (
    <Context.Provider
      value={{
        state,
        error,
        notice,
        busy,
        loading,
        wallet: publicKey?.toBase58() || '',
        refresh,
        run,
        connect: () => setShowModal(true),
        clearError: () => {
          setError('');
          setNotice('');
        },
        pending,
        resume,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useIndex = () => useContext(Context);
