import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSession,authorizeMutation,throttle} from '../lib/http.mjs';

test('a forged session and cross-site mutations cannot reach the engine',()=>{
  let cookie;
  const session=requestSession({method:'GET',headers:{}},{setHeader:(_,v)=>{cookie=v.split(';')[0];}});
  const req={method:'POST',headers:{cookie,host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-csrf-token':session.csrf},body:{action:'create'}};
  assert.equal(requestSession(req,{}).id,session.id);
  assert.doesNotThrow(()=>authorizeMutation(req,session));
  assert.throws(()=>requestSession({...req,headers:{cookie:cookie.replace(/.$/,'!')}},{}),/expired/);
  assert.throws(()=>authorizeMutation({...req,headers:{...req.headers,origin:'https://elsewhere.example'}},session),/same-origin/);
  assert.throws(()=>authorizeMutation({...req,headers:{...req.headers,'x-csrf-token':'é'.repeat(session.csrf.length)}},session),/Refresh/);
});
test('rotating session IDs does not evade the per-IP write limit',()=>{
  const req={method:'POST',headers:{},socket:{remoteAddress:'test-only-ip'}};
  for(let n=0;n<120;n++)throttle(req,`rotated-${n}`,1000);
  assert.throws(()=>throttle(req,'another-session',1000),e=>e.status===429);
  assert.doesNotThrow(()=>throttle(req,'next-window',62000));
});
