import { spawn } from 'node:child_process';

/** The ACP transport (Zed's Agent Client Protocol): an agent CLI serves newline-delimited
 * JSON-RPC over stdio; the host is the client. One handshake (initialize), one session per
 * turn (session/new + session/prompt), the agent streams session/update notifications which
 * are mapped to the chat's frame vocabulary (delta / reasoning / tool). A permission request
 * from the agent is DENIED by default - an agent that should work unattended is started in
 * its own approved mode (the backend's args), never by silently allowing here. */

const HANDSHAKE_MS = 15000;
const NEWSESSION_MS = 10000;
const TEARDOWN_MS = 2000;

export class AcpAgent {
  #child = null;
  #buf = '';
  #stderrTail = '';
  #nextId = 1;
  #pending = new Map();
  #sessionId = null;
  #closed = false;
  #onFrame;
  #signal;
  #command;

  constructor({ command, args = [], cwd, env, onFrame = () => { }, signal }) {
    this.#command = { command, args, cwd, env };
    this.#onFrame = onFrame;
    this.#signal = signal;
  }

  start() {
    const { command, args, cwd, env } = this.#command;
    return new Promise((resolve, reject) => {
      let settled = false;
      const giveUp = setTimeout(() => finish(new Error(`The ACP handshake with ${command} timed out after ${HANDSHAKE_MS / 1000}s.`)), HANDSHAKE_MS);
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        error ? reject(error) : resolve();
      };
      let child;
      try {
        child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) { finish(e); return; }
      this.#child = child;
      child.on('error', e => finish(new Error(`${command} could not start: ${e.message}`)));
      child.on('exit', (code, name) => {
        const why = name ? `killed by ${name}` : `exited with code ${code}`;
        for (const p of this.#pending.values()) p.reject(new Error(`The ACP agent ${why}.`));
        this.#pending.clear();
        finish(new Error(`The ACP agent ${why} during the handshake.${this.#stderrTail ? ` stderr: ${this.#stderrTail.slice(-400)}` : ''}`));
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', d => {
        this.#buf += d;
        let at;
        while ((at = this.#buf.indexOf('\n')) >= 0) {
          const line = this.#buf.slice(0, at);
          this.#buf = this.#buf.slice(at + 1);
          if (line.trim()) this.#route(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', d => { this.#stderrTail = (this.#stderrTail + d).slice(-2000); });
      this.#request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } })
        .then(() => finish(), e => finish(e));
    });
  }

  async newSession() {
    const result = await this.#withTimeout(this.#request('session/new', { cwd: this.#command.cwd, mcpServers: [] }), NEWSESSION_MS, 'session/new timed out.');
    this.#sessionId = String(result?.sessionId ?? '');
    if (!this.#sessionId) throw new Error('The ACP agent returned no session id.');
    return { sessionId: this.#sessionId };
  }

  async prompt(text) {
    const result = await this.#request('session/prompt', { sessionId: this.#sessionId, prompt: [{ type: 'text', text }] });
    const stopReason = String(result?.stopReason ?? 'end_turn');
    this.#onFrame({ type: 'done', stopReason });
    return { stopReason };
  }

  cancel() {
    if (this.#sessionId && this.#child && !this.#closed) this.#send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.#sessionId } });
  }

  close() {
    this.#closed = true;
    const child = this.#child;
    if (!child || child.exitCode != null) return;
    child.kill('SIGTERM');
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, TEARDOWN_MS);
    child.once('exit', () => clearTimeout(kill));
  }

  #send(message) { try { this.#child?.stdin.write(`${JSON.stringify(message)}\n`); } catch { } }

  #request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.#child || this.#closed) { reject(new Error(`The ACP agent ${method} was requested while it is not running.`)); return; }
      if (this.#signal?.aborted) { reject(new DOMException('Cancelled by the user', 'AbortError')); return; }
      const id = this.#nextId++;
      const entry = { resolve, reject };
      if (this.#signal) this.#signal.addEventListener('abort', () => { if (this.#pending.has(id)) { this.#pending.delete(id); entry.reject(new DOMException('Cancelled by the user', 'AbortError')); this.cancel(); } }, { once: true });
      this.#pending.set(id, entry);
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  #withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  #route(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    // a reply to one of our requests
    if (msg.id != null && !msg.method && this.#pending.has(msg.id)) {
      const entry = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(String(msg.error.message ?? 'The ACP agent refused the request.')));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update') {
      this.#mapUpdate(msg.params?.update);
      return;
    }
    if (msg.method != null && msg.id != null) {
      // an agent-to-client request: permissions are denied by default, file/terminal requests refused
      if (msg.method === 'session/request_permission') {
        this.#send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'rejected' } } });
      } else {
        this.#send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} is not offered by Strata.` } });
      }
    }
  }

  #mapUpdate(update) {
    if (!update?.sessionUpdate) return;
    const text = content => (content?.type === 'text' ? String(content.text ?? '') : content?.type === 'audio' || content?.type === 'image' ? '' : '');
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        { const t = text(update.content); if (t) this.#onFrame({ type: 'delta', text: t }); }
        break;
      case 'agent_thought_chunk':
        { const t = text(update.content); if (t) this.#onFrame({ type: 'reasoning', text: t }); }
        break;
      case 'tool_call':
        this.#onFrame({ type: 'tool', tool: { id: String(update.toolCallId ?? ''), name: String(update.title ?? 'tool'), args: update.rawInput ?? {}, preview: '', effect: 'The agent uses its own tool (ACP).', scope: 'agent' } });
        break;
      case 'plan':
        { const steps = (update.entries ?? []).map(e => `${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '…' : '·'} ${e.content ?? ''}`).filter(Boolean).join('\n');
          if (steps) this.#onFrame({ type: 'notice', code: 'acp-plan', message: steps }); }
        break;
      default:
        break; // available_commands_update, current_mode_update: nothing the chat needs
    }
  }
}
