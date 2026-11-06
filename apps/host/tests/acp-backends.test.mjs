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
  assert.deepEqual(kinds, ['kimi', 'opencode', 'claude']);
  const kimi = backendOf('kimi');
  assert.deepEqual(kimi.args, ['acp']);
  assert.equal(kimi.command, 'kimi');
  assert.equal(backendOf('claude').adapter, 'claude-stream');
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

/** Claude Code's own stream-json protocol: full assistant messages per line, a result line with usage. */
test('a claude-stream turn maps thinking, text, tools and the usage-carrying result', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-claude-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'fake-claude.mjs');
  writeFileSync(script, `const send=o=>process.stdout.write(JSON.stringify(o)+'\\n');
send({type:'system',subtype:'init',session_id:'s1',model:'claude-x'});
send({type:'system',subtype:'thinking_tokens'});
send({type:'assistant',message:{content:[{type:'thinking',thinking:'想一想'},{type:'text',text:'PONG'}]}});
send({type:'assistant',message:{content:[{type:'tool_use',id:'t9',name:'read_file',input:{path:'a'}}]}});
send({type:'result',subtype:'success',result:'PONG',usage:{input_tokens:10,cache_read_input_tokens:5,output_tokens:7}});`);
  const frames = [];
  const result = await runAcpTurn({ backend: { kind: 'claude', adapter: 'claude-stream', label: 'Claude Code', command: process.execPath, args: [script] }, message: 'hi', cwd: dir, onFrame: f => frames.push(f) });
  assert.deepEqual(frames.map(f => f.type), ['reasoning', 'delta', 'tool', 'done']);
  assert.equal(frames[0].text, '想一想');
  assert.equal(frames[1].text, 'PONG');
  assert.equal(frames[2].tool.name, 'read_file');
  assert.deepEqual(frames[3], { type: 'done', stopReason: 'success', tokensIn: 15, tokensOut: 7 });
  assert.equal('error' in result, false);
});

test('a claude that exits with no result fails loud with its stderr', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-claude2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const frames = [];
  const result = await runAcpTurn({ backend: { kind: 'claude', adapter: 'claude-stream', label: 'Claude Code', command: '/bin/sh', args: ['-c', 'echo boom >&2; exit 4'] }, message: 'hi', cwd: dir, onFrame: f => frames.push(f) });
  assert.ok(/exited with code 4/.test(result.error ?? ''), `says the code: ${result.error}`);
  assert.ok(/boom/.test(result.error ?? ''), 'carries stderr');
  assert.equal(frames.filter(f => f.type === 'error').length, 1);
});
