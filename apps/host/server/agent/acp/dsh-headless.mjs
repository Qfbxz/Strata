import { spawn } from 'node:child_process';

/** The dsh backend: `dsh headless --json` - DeepSeek's harness in one-shot mode. NDJSON run
 * events on stdout (session / status phases / a final), diagnostics on stderr. The final
 * event carries the answer text, or the failure (a missing API key says so in plain words -
 * the person's own credentials, never injected here). One process per turn. */

export async function runDshTurn({ backend, message, cwd, onFrame, signal }) {
    const started = Date.now();
    const args = [...(backend.args ?? []), '--json', message];
    return new Promise(resolve => {
        let child;
        try {
            child = spawn(backend.command, args, { cwd, env: { ...process.env, ...(backend.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
            onFrame({ type: 'error', message: `${backend.command} could not start: ${e.message}`, code: 'acp-turn' });
            resolve({ error: String(e.message), durationMs: 0 });
            return;
        }
        let buf = '';
        let stderrTail = '';
        let sawFinal = false;
        let finalError = null;
        const finish = result => {
            if (signal) signal.removeEventListener('abort', cancel);
            clearTimeout(wedge);
            try { if (child.exitCode == null) child.kill('SIGTERM'); } catch { }
            if (result.error) onFrame({ type: 'error', message: result.error, code: 'acp-turn' });
            resolve({ durationMs: Date.now() - started, ...(finalError && !result.error ? { error: finalError } : {}), ...result });
        };
        const cancel = () => { try { child.kill('SIGTERM'); } catch { } };
        const wedge = setTimeout(cancel, 30 * 60 * 1000);
        if (signal) signal.addEventListener('abort', cancel, { once: true });
        child.on('error', e => finish({ error: `${backend.command} could not start: ${e.message}` }));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', d => {
            buf += d;
            let at;
            while ((at = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, at);
                buf = buf.slice(at + 1);
                if (!line.trim()) continue;
                const failure = emit(line, onFrame);
                if (failure) { sawFinal = true; if (failure.error) finalError = failure.error; }
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-1500); });
        child.on('exit', code => {
            if (sawFinal) finish({});
            else finish({ error: `dsh exited with code ${code} before answering.${stderrTail ? ` stderr: ${stderrTail.slice(-400)}` : ''}` });
        });
    });
}

function emit(line, onFrame) {
    let d;
    try { d = JSON.parse(line); } catch { return false; }
    if (d.type === 'final') {
        if (d.reason?.kind === 'error' || d.reason?.error) {
            const message = String(d.reason?.error?.message ?? d.reason?.kind ?? 'dsh failed');
            onFrame({ type: 'error', message, code: String(d.reason?.error?.code ?? 'acp-turn') });
            return { error: message };
        }
        if (d.text) onFrame({ type: 'delta', text: String(d.text) });
        onFrame({ type: 'done', stopReason: 'success' });
        return true;
    }
    // session / status events (turn_start, step_start...) and any event carrying text: keep the chat informed without inventing detail
    if (typeof d.text === 'string' && d.text && d.type !== 'status') onFrame({ type: 'delta', text: d.text });
    if (d.type === 'tool' && (d.name || d.title)) onFrame({ type: 'tool', tool: { id: String(d.id ?? d.callId ?? ''), name: String(d.name ?? d.title), args: d.arguments ?? {}, preview: '', effect: 'dsh runs its own tool.', scope: 'agent' } });
    return false;
}
