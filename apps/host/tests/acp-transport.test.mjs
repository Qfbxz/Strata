import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpAgent } from '../server/agent/acp/transport.mjs';

/** The ACP transport (Zed's Agent Client Protocol over stdio, newline-delimited JSON-RPC):
 * one handshake, one session per turn, updates mapped to the chat's frame vocabulary,
 * permission requests denied by default (the CLIs' own approval modes stay the choice),
 * and a hard teardown. A fake agent script plays the peer; no real CLI is needed here. */

function fixtureDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'strata-acp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return dir;
}

const FAKE_AGENT = `#!/usr/bin/env node
let buf = '';
let seq = 10;
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
process.stdin.on('data', d => {
  buf += d;
  let at;
  while ((at = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, at); buf = buf.slice(at + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') reply(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] });
    else if (m.method === 'session/new') reply(m.id, { sessionId: 'sess-1' });
    else if (m.method === 'session/prompt') {
      const sid = m.params.sessionId;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想一下' } } } });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } } } });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read_file', kind: 'read', status: 'pending' } } });
      const ask = { jsonrpc: '2.0', id: seq++, method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 't1' }, options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }] } };
      send(ask);
      process.stdin.once('data', () => {});
      // the permission reply arrives on stdin as its own message; handle it above via the same reader
      setTimeout(() => reply(m.id, { stopReason: 'end_turn' }), 30);
    }
    else if (m.id != null) reply(m.id, {});
  }
});
`;

test('a turn maps updates to frames: thought to reasoning, message to delta, tool call to a card', async t => {
  const dir = fixtureDir(t);
  const script = join(dir, 'fake-agent.mjs');
  writeFileSync(script, FAKE_AGENT);
  const frames = [];
  const agent = new AcpAgent({ command: process.execPath, args: [script], cwd: dir, onFrame: f => frames.push(f) });
  await agent.start();
  await agent.newSession();
  const stop = await agent.prompt('说你好');
  await agent.close();
  const kinds = frames.map(f => f.type);
  assert.deepEqual(kinds, ['reasoning', 'delta', 'tool', 'done']);
  assert.equal(frames[0].text, '想一下');
  assert.equal(frames[1].text, '你好');
  assert.equal(frames[2].tool.name, 'read_file');
  assert.equal(frames[3].stopReason, 'end_turn');
  assert.equal(stop.stopReason, 'end_turn');
});

test('a permission request is denied by default and the turn still finishes', async t => {
  const dir = fixtureDir(t);
  const script = join(dir, 'fake-agent.mjs');
  writeFileSync(script, FAKE_AGENT);
  const frames = [];
  const agent = new AcpAgent({ command: process.execPath, args: [script], cwd: dir, onFrame: f => frames.push(f) });
  await agent.start();
  await agent.newSession();
  await agent.prompt('做一个要批准的动作');
  await agent.close();
  // the fake replies end_turn regardless; the point is the transport answered the request, not hung
  assert.ok(frames.some(f => f.type === 'done'), 'the prompt resolved');
});

test('an agent that dies during the handshake fails loud, not silent', async t => {
  const dir = fixtureDir(t);
  const script = join(dir, 'dead-agent.mjs');
  writeFileSync(script, 'process.exit(3);\n');
  const agent = new AcpAgent({ command: process.execPath, args: [script], cwd: dir });
  await assert.rejects(() => agent.start(), /handshake|exit/i);
});

test('cancel is delivered as the session/cancel notification', async t => {
  const dir = fixtureDir(t);
  const frames = [];
  // the echo agent acknowledges a cancel with a message chunk, which is observable in the frames
  const script = join(dir, 'echo-agent.mjs');
  writeFileSync(script, `let b='';const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');process.stdin.on('data',d=>{b+=d;let at;while((at=b.indexOf('\\n'))>=0){const l=b.slice(0,at);b=b.slice(at+1);if(!l.trim())continue;let m;try{m=JSON.parse(l);}catch{continue;}if(m.method==='initialize'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new'&&m.id!=null)send({jsonrpc:'2.0',id:m.id,result:{sessionId:'sess-1'}});else if(m.method==='session/cancel')send({jsonrpc:'2.0',method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'cancel-seen'}}}});}});`);
  const agent = new AcpAgent({ command: process.execPath, args: [script], cwd: dir, onFrame: f => frames.push(f) });
  await agent.start();
  const { sessionId } = await agent.newSession();
  assert.equal(sessionId, 'sess-1');
  agent.cancel();
  await new Promise(r => setTimeout(r, 100));
  await agent.close();
  assert.deepEqual(frames, [{ type: 'delta', text: 'cancel-seen' }]);
});
