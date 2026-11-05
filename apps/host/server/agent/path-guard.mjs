/* P0-8 F2: path containment for the Manual gate's read-only fast lane.
 *
 * The gate lets "read-only" shell commands and the fs tools through without a question. On an
 * open sandbox that means the model can read ANY path on this computer — and one web approval
 * turns that into exfiltration. This module makes the fast lane fail-closed: an operand counts
 * as safe only when it provably resolves INSIDE the chat's working directory. Anything that
 * cannot be proven — a path outside, through a symlink, a Windows drive path on a Mac, or a
 * missing cwd — is reported as outside, and the gate turns that into an ask (never a deny).
 *
 * Pure functions, no Harness imports — shared by the gate and the tests.
 */
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const DRIVE = /^[A-Za-z]:[\\/]/;                                   // C:\ — a foreign path on a Mac
const PATHISH = /[\\/]|[~]|\.[A-Za-z0-9]{1,8}$/;                   // has a separator, a ~, or an extension

function expandTilde(op, home) {
  const t = String(op);
  if (t === '~') return home;
  if (t.startsWith('~/') || t.startsWith('~\\')) return join2(home, t.slice(2));
  return t;
}

function join2(a, b) {
  return /[\\/]$/.test(a) ? a + b : a + '/' + b;
}

function realBase(cwd) {
  return existsSync(cwd) ? realpathSync(cwd) : resolve(cwd);
}

/** The operands that provably resolve OUTSIDE `cwd` (or cannot be proven inside). Fail-closed:
    an operand that exists is resolved through symlinks before comparing; one that resolves
    through a symlink escape is outside. Windows drive paths on a Mac are outside by definition. */
export function outsidePaths(cwd, operands, home = homedir()) {
  if (!cwd) return operands.map(String);                           // no cwd: everything is outside
  const base = realBase(cwd);
  const out = [];
  for (const raw of operands) {
    const expanded = expandTilde(String(raw).replace(/^["']|["']$/g, ''), home);
    if (DRIVE.test(expanded)) {
      out.push(raw);
      continue;
    }
    const resolved = isAbsolute(expanded) ? expanded : resolve(base, expanded);
    let actual = resolved;
    if (existsSync(resolved)) {
      try {
        actual = realpathSync(resolved);
      } catch {
        out.push(raw);
        continue;
      }
    }
    const rel = relative(base, actual);
    if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) out.push(raw);
  }
  return out;
}

/** Does this bare word look like a path (a separator, a leading . or ~, or an extension)? */
export function pathLike(token) {
  return PATHISH.test(token) || DRIVE.test(token) || /^[.~]/.test(token);
}

function existsUnder(cwd, token, home) {
  try {
    return existsSync(resolve(realBase(cwd), expandTilde(token, home)));
  } catch {
    return false;
  }
}

/** The path-like operands of a shell command string: bare words that look like paths or exist
    under the cwd, values of `--flag=value` and `-f=value` forms, and anything with a drive letter.
    Quoted data (`'a|b'`, `'TODO'`) does not look like a path and is skipped — normal greps gain
    no friction. */
export function candidatesFromCommand(command, cwd, home = homedir()) {
  const stripped = String(command).replace(/"[^"]*"|'[^']*'/g, (m) => m.replace(/^["']|["']$/g, ''));
  const words = stripped.split(/[\s|;&<>]+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (/^-[^=]*$/.test(w) || w === '-' || w === '--') continue;   // a bare flag: no path in it
    const eq = w.indexOf('=');
    if (w.startsWith('-') && eq > 1) {                             // --file=/etc/passwd
      const value = w.slice(eq + 1);
      if (value && (pathLike(value) || DRIVE.test(value) || existsUnder(cwd, value, home))) out.push(value);
      continue;
    }
    if (pathLike(w) || DRIVE.test(w) || existsUnder(cwd, w, home)) out.push(w);
  }
  return out;
}

/** Outside operands of one read-only shell command. */
export function shellCommandOutside(cwd, command, home = homedir()) {
  return outsidePaths(cwd, candidatesFromCommand(command, cwd, home), home);
}

/** Outside operands of one of the fs tools (read / read_image / glob / grep / write / edit):
    the file_path / path / pattern argument is the thing to prove inside. */
export function fsToolOutside(cwd, args, home = homedir()) {
  const a = args && typeof args === 'object' ? args : {};
  const raw = a.file_path ?? a.path ?? a.pattern;
  if (!raw || typeof raw !== 'string') return [];
  return outsidePaths(cwd, [raw], home);
}
