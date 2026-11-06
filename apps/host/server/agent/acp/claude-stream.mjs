import { spawn } from 'node:child_process';

/** The Claude Code backend: `claude -p` in stream-json mode. Not ACP - Claude's own one-shot
 * print protocol: each line is a JSON event; assistant lines carry the full message content
 * (thinking / text / tool_use blocks), the final `result` line carries the verdict and the
 * token usage. One process per turn, like every backend here. Permissions stay whatever the
 * person's own Claude settings say - this adapter adds no bypass flags. */

export async function runClaudeTurn({ backend, message, cwd, onFrame, signal }) {
    const started = Date.now();
    const args = [...(backend.args ?? []), '-p', message, '--output-format', 'stream-json', '--verbose',
        '--max-turns', String(backend.maxTurns ?? 12)];
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
            else finish({ error: `claude exited with code ${code}.${stderrTail ? ` stderr: ${stderrTail.slice(-300)}` : ''}` });
        });
    });
}

function emit(line, onFrame) {
    let d;
    try { d = JSON.parse(line); } catch { return false; }
    if (d.type === 'assistant') {
        for (const block of d.message?.content ?? []) {
            if (block.type === 'thinking' && block.thinking) onFrame({ type: 'reasoning', text: String(block.thinking) });
            else if (block.type === 'text' && block.text) onFrame({ type: 'delta', text: String(block.text) });
            else if (block.type === 'tool_use') onFrame({ type: 'tool', tool: { id: String(block.id ?? ''), name: String(block.name ?? 'tool'), args: block.input ?? {}, preview: '', effect: 'Claude Code uses its own tool.', scope: 'agent' } });
        }
    } else if (d.type === 'result') {
        const usage = d.usage ?? {};
        onFrame({ type: 'done', stopReason: String(d.subtype ?? 'success'), tokensIn: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0), tokensOut: Number(usage.output_tokens ?? 0) });
        return true;
    }
    return false;
    // system lines (init, thinking_tokens, hook_*) and user lines (tool results): nothing the chat needs
}
