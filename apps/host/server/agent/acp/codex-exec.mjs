import { spawn } from 'node:child_process';

/** The Codex backend: `codex exec --json` - Codex's own JSONL events, not ACP. Each line is
 * an event: item.completed items (reasoning / agent_message / command_execution / error),
 * and a final turn.completed carrying the token usage. One process per turn. Approvals stay
 * whatever the person's own Codex config says - no sandbox or approval flags are added. */

export async function runCodexTurn({ backend, message, cwd, onFrame, signal }) {
    const started = Date.now();
    const args = [...(backend.args ?? []), '-C', cwd, message];
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
        let sawResult = false;
        const finish = result => {
            if (signal) signal.removeEventListener('abort', cancel);
            clearTimeout(wedge);
            try { if (child.exitCode == null) child.kill('SIGTERM'); } catch { }
            if (result.error) onFrame({ type: 'error', message: result.error, code: 'acp-turn' });
            resolve({ durationMs: Date.now() - started, ...result });
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
                if (line.trim() && emit(line, onFrame)) sawResult = true;
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-1000); });
        child.on('exit', code => {
            if (code === 0 || sawResult) finish({});
            else finish({ error: `codex exited with code ${code}.${stderrTail ? ` stderr: ${stderrTail.slice(-300)}` : ''}` });
        });
    });
}

function emit(line, onFrame) {
    let d;
    try { d = JSON.parse(line); } catch { return false; }
    if (d.type === 'item.completed') {
        const item = d.item ?? {};
        if (item.type === 'reasoning' && item.reasoning) onFrame({ type: 'reasoning', text: String(item.reasoning) });
        else if (item.type === 'agent_message' && item.text) onFrame({ type: 'delta', text: String(item.text) });
        else if (item.type === 'command_execution') onFrame({ type: 'tool', tool: { id: String(item.id ?? ''), name: 'command', args: { command: String(item.command ?? '') }, preview: String(item.command ?? '').slice(0, 120), effect: 'Codex runs a shell command.', scope: 'agent' } });
        // item.type 'error' carries config noise; real failures show in turn.completed or the exit code
    } else if (d.type === 'turn.completed') {
        const u = d.usage ?? {};
        onFrame({ type: 'done', stopReason: 'success', tokensIn: Number(u.input_tokens ?? 0) + Number(u.cached_input_tokens ?? 0), tokensOut: Number(u.output_tokens ?? 0) });
        return true;
    }
    return false;
    // thread.started / turn.started: nothing the chat needs
}
