/** The agent backends this Mac can drive over ACP (Agent Client Protocol): CLIs that speak
 * it natively. The registry is the single list the picker reads; `availableBackends` checks
 * the PATH so the UI only ever offers what is really here. */

import { execFile } from 'node:child_process';

export const BACKENDS = [
    { kind: 'kimi', label: 'Kimi CLI', command: 'kimi', args: ['acp'], note: 'kimi acp' },
    { kind: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'], note: 'opencode acp' },
];

export function backendOf(kind) { return BACKENDS.find(b => b.kind === kind); }

export function availableBackends({ path } = {}) {
    const envPath = path ?? process.env.PATH ?? '';
    return Promise.all(BACKENDS.map(b => new Promise(resolve => {
        execFile('/usr/bin/which', [b.command], { env: { PATH: envPath } }, (err, stdout) => {
            // `path` is the absolute executable: the app's own PATH can be minimal, so turns spawn what which found, not a bare name
            resolve({ ...b, available: !err && String(stdout).trim().length > 0, path: String(stdout).trim() || undefined });
        });
    })));
}
