import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKENDS, availableBackends, backendOf } from '../server/agent/acp/backends.mjs';
import { runAcpTurn } from '../server/agent/acp/turns.mjs';

/** The agent backends (CLI agents driven over ACP) and the turn that runs one: the registry
 * only ever offers what is actually on this Mac (never a button that fails at click time),
 * and a turn is the full lifecycle - spawn, handshake, session, prompt, teardown. */

test('the registry speaks native-ACP CLIs with their real subcommands', () => {
  const kinds = BACKENDS.map(b => b.kind);
  assert.deepEqual(kinds, ['kimi', 'opencode']);
  const kimi = backendOf('kimi');
  assert.deepEqual(kimi.args, ['acp']);
  assert.equal(kimi.command, 'kimi');
  assert.equal(backendOf('nope'), undefined);
});

test('availableBackends marks what is on PATH and what is not', async t => {
  const bin = mkdtempSync(join(tmpdir(), 'strata-acpbin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const shim = join(bin, 'kimi');
  writeFileSync(shim, '#!/bin/sh\nexit 0\n');
  chmodSync(shim, 0o755);
  const found = await availableBackends({ path: `${bin}:/usr/bin:/bin` });
  assert.equal(found.find(b => b.kind === 'kimi').available, true);
  assert.equal(found.find(b => b.kind === 'opencode').available, false);
});

test('a turn runs the whole lifecycle and maps the frames', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-acpturn-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'fake.mjs');
  writeFileSync(script, `let b='';const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');process.stdin.on('data',d=>{b+=d;let at;while((at=b.indexOf('\\n'))>=0){const l=b.slice(0,at);b=b.slice(at+1);if(!l.trim())continue;let m;try{m=JSON.parse(l);}catch{continue;}if(m.method==='initialize'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{sessionId:'s'}});else if(m.method==='session/prompt'&&m.id!=null){send({jsonrpc:'2.0',method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'答案'}}}});setTimeout(()=>send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}}),20);}}});`);
  const frames = [];
  const result = await runAcpTurn({ backend: { kind: 'kimi', label: 'Kimi CLI', command: process.execPath, args: [script] }, message: 'hi', cwd: dir, onFrame: f => frames.push(f) });
  assert.deepEqual(frames.map(f => f.type), ['delta', 'done']);
  assert.equal(frames[0].text, '答案');
  assert.equal(result.stopReason, 'end_turn');
  assert.ok(result.durationMs >= 0);
  assert.equal('error' in result, false);
});

test('an agent that dies mid-handshake yields an error frame and an error result', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-acpdead-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const frames = [];
  const result = await runAcpTurn({ backend: { kind: 'kimi', label: 'Kimi CLI', command: '/bin/sh', args: ['-c', 'exit 7'] }, message: 'hi', cwd: dir, onFrame: f => frames.push(f) });
  assert.equal(frames.filter(f => f.type === 'error').length, 1, 'one error frame');
  assert.ok(/exited with code 7/.test(result.error));
});

test('a turn aborted by the user tears the agent down without hanging', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-acpabort-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  const script = join(dir, 'slow.mjs');
  // an agent that acknowledges handshake and new, then never answers the prompt
  writeFileSync(script, `let b='';const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');process.stdin.on('data',d=>{b+=d;let at;while((at=b.indexOf('\\n'))>=0){const l=b.slice(0,at);b=b.slice(at+1);if(!l.trim())continue;let m;try{m=JSON.parse(l);}catch{continue;}if(m.method==='initialize'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{sessionId:'s'}});}});setInterval(()=>{},1000);`);
  const frames = [];
  const run = runAcpTurn({ backend: { kind: 'kimi', label: 'Kimi CLI', command: process.execPath, args: [script] }, message: 'hi', cwd: dir, onFrame: f => frames.push(f), signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  const result = await run;
  assert.ok(/Cancelled|abort/i.test(result.error ?? ''), `says why it stopped: ${result.error}`);
});
