import { mkdir, readFile, writeFile, rename, unlink, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = process.env.DEMO_DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.demo');
const queues = new Map();
export function sessionDirectory(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(id)) throw new Error('Invalid server session.');
  return path.join(root, 'sessions', id);
}
export async function readSession(id) {
  try { return JSON.parse(await readFile(path.join(sessionDirectory(id), 'state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function writeSession(id, data) {
  const dir = sessionDirectory(id); await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.state-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 }); await rename(temp, path.join(dir, 'state.json'));
}
export function exclusive(id, callback) {
  const previous = queues.get(id) || Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    const dir = sessionDirectory(id); await mkdir(dir, { recursive: true, mode: 0o700 });
    const lock = path.join(dir, 'engine.lock'); let handle; const token=randomUUID();
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let info={};try{info=JSON.parse(await readFile(lock, 'utf8'));}catch{}
      const modified=Math.max(Number(info.updatedAt) || 0,(await stat(lock)).mtimeMs);
      // An expired lease means its process could have died. Mutation journals still gate replay.
      if (Date.now() - modified < 120000) throw new Error('This session is busy. Retry in a moment.');
      await unlink(lock); handle = await open(lock, 'wx', 0o600);
    }
    await handle.writeFile(JSON.stringify({token,pid:process.pid, updatedAt:Date.now()}));
    const owns=async()=>{try{return JSON.parse(await readFile(lock,'utf8')).token===token;}catch{return false;}};
    // Touch the acquired inode, never overwrite a replacement owner's lock by pathname.
    const pulse = setInterval(() => {const now=new Date();handle.utimes(now,now).catch(() => {});}, 30000);
    pulse.unref();
    try { return await callback(); }
    finally { clearInterval(pulse); await handle.close(); if(await owns())await unlink(lock).catch(() => {}); }
  });
  queues.set(id, result);
  result.finally(() => {if (queues.get(id) === result) queues.delete(id);}).catch(() => {});
  return result;
}
