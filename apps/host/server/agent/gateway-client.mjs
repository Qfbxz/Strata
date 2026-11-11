/**
 * A client for the Harness Gateway (the `dsh web` HTTP + server-push surface, 0.2.3+).
 *
 * Three carriers, all trusted by the loopback fence (there is no launch token since 0.2.3):
 *   - HTTP unary RPC:   POST /api/<dot.method> with the four-quadrant envelope; the payload is the
 *                       business payload directly (the carrier no longer wraps a `request` object).
 * - HTTP respond:     POST /api/respond answers one answerable server-request (an approval or a
 *                       question ask) by echoing its rpcId with the business answer.
 * - WebSocket streams: /api/events.mux (all-session frames: durable session events, chunk deltas,
 *                       approvals, questions, queue state) and /api/events.host (host-level frames:
 *                       session lifecycle, running flips, agent errors). Server-push only — the
 *                       protocol rejects any client message on the socket.
 *
 * Reference contract: the Harness's own browser client (dsh-client-connection src/client +
 * dsh-host-apiproxy src/fetch/client.ts). Frames ride `data: <ServerRequest JSON>` with blank-line
 * framing; the wire envelope is `{type:'server-request', rpcId, payload}`.
 */

import { appendFileSync } from 'node:fs';

export class GatewayError extends Error {
  constructor(message, { code = 'gateway/error', details } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.details = details;
  }
}

/** Milliseconds a unary call may take before the transport gives up (bounded RPCs need a ceiling). */
const UNARY_TIMEOUT_MS = 120_000;
/** Reconnect backoff for the two downlinks: first retry, growth factor, and the cap. */
const BACKOFF_FIRST_MS = 500;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 10_000;

export class GatewayClient {
  #base; #rpcId = 0; #closed = false; #onFrame; #onState; #pumps = new Map();

  /**
   * @param {{baseUrl: string, onFrame?: (stream: 'mux'|'host', frame: object) => void,
   *          onState?: (state: 'open'|'closed') => void}} options
   *   `onFrame` receives every decoded server-push frame (already narrowed out of its envelope).
   */
  constructor({ baseUrl, onFrame = () => {}, onState = () => {} }) {
    this.#base = baseUrl.replace(/\/+$/, '');
    this.#onFrame = onFrame;
    this.#onState = onState;
  }

  /** Prove unary reachability with the host handshake. There is no token to exchange since 0.2.3. */
  async connect() {
    return this.rpc('host.describe', {});
  }

  /**
   * One unary call. Resolves with the value, rejects with a GatewayError carrying the gateway's code.
   * @param {string} method the dotted wire method (`session.create`, `goal.pause`, ...)
   * @param {object} payload the business payload directly
   */
  async rpc(method, payload = {}, { signal } = {}) {
    if (this.#closed) throw new GatewayError('closed', { code: 'gateway/closed' });
    const rpcId = `h${++this.#rpcId}`;
    const timeout = AbortSignal.timeout(UNARY_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const res = await fetch(`${this.#base}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: requestSignal,
    }).catch(e => { throw new GatewayError(`${method}: the agent could not be reached (${e.message})`, { code: 'gateway/transport' }); });
    if (!res.ok) throw new GatewayError(`${method}: HTTP ${res.status}`, { code: 'gateway/bad-response' });
    let body;
    try { body = await res.json(); } catch { throw new GatewayError(`${method}: the agent returned a non-JSON answer (HTTP ${res.status})`, { code: 'gateway/bad-response' }); }
    const result = body?.result;
    if (!result?.ok) {
      const e = result?.error ?? {};
      throw new GatewayError(`${method}: ${e.message ?? `HTTP ${res.status}`}`, { code: e.code ?? 'gateway/error', details: e.details });
    }
    return result.value;
  }

  /**
   * Answer one answerable server-request (an approval or a question ask). `ok:false` declines it:
   * the ask fails closed instead of carrying an answer the person never gave.
   * @param {{rpcId: string}} request the server-request envelope the ask rode in
   * @param {object|{error:{code:string,message:string}}} value the business answer, or an error to decline
   */
  async answer(request, value) {
    const declined = value && typeof value === 'object' && 'error' in value;
    const message = declined
      ? { type: 'client-response', rpcId: request.rpcId, result: { ok: false, error: value.error } }
      : { type: 'client-response', rpcId: request.rpcId, result: { ok: true, value } };
    const res = await fetch(`${this.#base}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }).catch(e => { throw new GatewayError(`respond: the agent could not be reached (${e.message})`, { code: 'gateway/transport' }); });
    if (!res.ok) throw new GatewayError(`respond: HTTP ${res.status}`, { code: 'gateway/bad-response' });
    const receipt = await res.json().catch(() => ({}));
    if (process.env.STRATA_FRAME_LOG) { try { appendFileSync(process.env.STRATA_FRAME_LOG, Date.now() + ' respond ' + JSON.stringify(receipt) + ' ' + message.rpcId.slice(0, 12) + '\n'); } catch {} }
    return receipt;
  }

  /**
   * Open both server-push sockets and keep them fed. Each socket reconnects on loss with capped
   * exponential backoff; `onFrame` sees every decoded frame. Frames between a loss and the reopened
   * socket's subscription baseline are recovered by the caller through `session.history`.
   * @returns a close that ends both sockets and stops reconnecting.
   */
  events() {
    for (const [stream, path] of [['mux', '/api/events.mux'], ['host', '/api/events.host']]) {
      this.#pump(stream, path, 0);
    }
    return () => { this.#closed = true; this.#pumps.clear(); };
  }

  async #pump(stream, path, attempt) {
    if (this.#closed) return;
    const socket = new WebSocket(`${this.#base.replace(/^http/, 'ws')}${path}`);
    this.#pumps.set(stream, socket);
    let opened = false;
    let backoffTimer = null;
    socket.onopen = () => {
      opened = true;
      this.#onState('open');
    };
    socket.onmessage = event => {
      let full;
      let frame;
      try { full = JSON.parse(String(event.data)); frame = full?.payload; } catch { return; }   // one corrupt frame must not kill the stream
      if (frame && typeof frame === 'object') this.#onFrame(stream, frame, full.rpcId);
    };
    socket.onclose = () => {
      if (this.#pumps.get(stream) === socket) this.#pumps.delete(stream);
      if (this.#closed) return;
      if (opened) this.#onState('closed');
      const nextAttempt = opened ? 0 : attempt + 1;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * BACKOFF_FACTOR ** Math.min(nextAttempt, 6)) / 2 + Math.random() * 250;
      backoffTimer = setTimeout(() => { if (!this.#closed) this.#pump(stream, path, nextAttempt); }, delay);
      backoffTimer.unref?.();
    };
    socket.onerror = () => { /* the close handler reconnects */ };
  }

  close() {
    this.#closed = true;
    for (const socket of this.#pumps.values()) { try { socket.close(); } catch { /* already closing */ } }
    this.#pumps.clear();
    this.#onState('closed');
  }
}
