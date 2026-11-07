/** The right-side workspace panel's server half (learning from DeepSeek's and Codex's side
 * panels): a file tree, a bounded text reader and a whitelisted git view over ONE chat root -
 * the same root the chat's files live in (chatRootOf). The path-guard discipline applies:
 * every path is resolved inside the root, and anything that leaves it (../, absolute, drive
 * letters) is refused before the disk is touched. Binaries are named, never dumped; git is a
 * fixed menu, never a shell. */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const GIT_MENU = {
  status: ['status', '--short', '--branch'],
  log: ['log', '--graph', '--oneline', '--decorate', '-n', '60'],
  diff: ['diff', '--stat', '-p', '--no-color'],
  diffStaged: ['diff', '--cached', '--stat', '-p', '--no-color'],
  branches: ['branch', '-a', '-v', '--no-abbrev'],
};
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.xz', '.7z', '.rar', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.wav', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.exe', '.dll', '.dylib', '.so', '.bin', '.wasm', '.gguf', '.safetensors']);

function inside(root, rel) {
  const base = resolve(String(root));
  const target = resolve(base, String(rel ?? '.'));
  if (target !== base && !target.startsWith(base + sep)) throw new Error('The path must stay inside the workspace.');
  return target;
}

export function createWorkspaceFs({ root, maxBytes = 512 * 1024, gitTimeoutMs = 10_000 }) {
  const safe = rel => {
    const target = inside(root, rel);
    if (!existsSync(target)) throw new Error('No such file or folder in the workspace.');
    return target;
  };
  return {
    list(rel = '') {
      const dir = safe(rel);
      const rows = readdirSync(dir, { withFileTypes: true }).map(e => {
        let size = 0;
        try { size = e.isDirectory() ? 0 : statSync(join(dir, e.name)).size; } catch { /* raced away */ }
        return { name: e.name, dir: e.isDirectory(), size };
      }).sort((a, b) => (a.dir !== b.dir ? a.dir ? -1 : 1 : a.name.localeCompare(b.name)));
      return rows;
    },
    read(rel = '') {
      const file = safe(rel);
      const size = statSync(file).size;
      const ext = extname(file).toLowerCase();
      if (BINARY_EXTS.has(ext)) return { binary: true, size, truncated: false };
      const cap = Math.min(size, maxBytes);
      const content = readFileSync(file).subarray(0, cap).toString('utf8');
      return { binary: false, size, truncated: size > cap, content };
    },
    git(op, arg) {
      // checkout is the panel's one write op: switch to a plain branch name (strict refname guard).
      if (op === 'checkout') {
        const name = String(arg ?? '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.endsWith('.lock') || name.endsWith('/'))
          throw new Error(`That is not a branch name this panel can switch to: ${JSON.stringify(name)}`);
        try {
          execFileSync('git', ['checkout', name], { cwd: root, timeout: gitTimeoutMs, maxBuffer: 1024 * 1024 });
          return `Switched to ${name}`;
        } catch (e) {
          throw new Error(`git checkout ${name} failed: ${String(e.stderr ?? e.message).slice(0, 200)}`);
        }
      }
      const argv = GIT_MENU[op];
      if (!argv) throw new Error(`git op ${op} is not on the menu (status, log, diff, diffStaged, branches, checkout)`);
      try {
        return execFileSync('git', argv, { cwd: root, timeout: gitTimeoutMs, maxBuffer: 2 * 1024 * 1024 }).toString();
      } catch (e) {
        const out = String(e.stdout ?? '');
        if (out) return out;   // `git log` on an empty repo fails but answers; diff on no diff exits 1
        throw new Error(`git ${op} failed: ${String(e.stderr ?? e.message).slice(0, 200)}`);
      }
    },
    isGit() { return existsSync(join(root, '.git')); },
  };
}
