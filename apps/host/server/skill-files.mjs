/**
 * Skills on disk, for the app and for the agent.
 *
 * The app keeps the skills a person writes in its own folder (`<data>/skills/<id>/SKILL.md`). The agent (the Harness) finds skills by scanning
 * folders of `<name>/SKILL.md` files whose frontmatter has a kebab-case `name` and a `description`. So the app also writes the whole current
 * list (bundled, written, added, edited, switched on or off) into one folder the Harness is told to scan (`materializeSkills`), every time
 * anything changes. The Harness watches that folder, so a skill saved in the app is there for the next message without a restart.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The kebab-case name the Harness requires, from what a person typed ("Directory opener" -> "directory-opener"). */
export function skillSlug(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const yamlText = value => JSON.stringify(String(value ?? '').replace(/\s+/g, ' ').trim());

/** `SKILL.md` text: the frontmatter the Harness reads, then the instructions. */
export function skillFileText({ name, title = null, description, body, hidden = false }) {
  return `---\nname: ${skillSlug(name)}\n${title ? `title: ${yamlText(title)}\n` : ''}description: ${yamlText(description || name)}\n${hidden ? 'disable-model-invocation: true\n' : ''}---\n\n${String(body ?? '').trim()}\n`;
}

/** Name, description and instructions out of a SKILL.md (frontmatter optional). */
export function parseSkillFile(text) {
  const raw = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { name: null, title: null, description: null, body: raw.trim() };
  const field = key => {
    // block scalar first (`key: |` or `key: >` with indented lines below), then the single-line form
    const block = new RegExp(`^${key}:\\s*[|>]\\s*\\n((?:[ \\t]+[^\\n]*\\n?)+)`, 'mi').exec(m[1]);
    if (block) {
      const lines = block[1].split('\n').map(l => l.replace(/^[ \t]+/, '')).filter(Boolean);
      return lines.join(' ').trim();
    }
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'mi').exec(m[1])?.[1]?.trim();
    if (line === undefined) return null;
    try { if (/^["']/.test(line)) return typeof JSON.parse(line.replace(/^'(.*)'$/, '"$1"')) === 'string' ? JSON.parse(line.replace(/^'(.*)'$/, '"$1"')) : line; } catch { /* plain scalar */ }
    return line;
  };
  return { name: field('name'), title: field('title'), description: field('description'), body: raw.slice(m[0].length).trim() };
}

/** Where a skill written in the app lives, and writing it there. */
export function writeCreatedSkill(root, { name, description, body }) {
  const id = skillSlug(name);
  if (!id) throw new Error('Give the skill a name with letters or numbers in it.');
  const dir = join(root, id);
  if (existsSync(dir)) throw new Error(`You already have a skill called "${id}". Choose another name, or edit the one you have.`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillFileText({ name: id, title: String(name).trim(), description, body }));
  return id;
}

/** Folders of a skill pack that never hold reference docs worth carrying (huge build junk). */
const CARRY_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target', '__pycache__', '.venv', 'venv', '.next', '.cache', '.gradle', '.idea', '.vscode']);
/** A skill carries at most this many companion files and this many bytes of them. */
const CARRY_MAX_FILES = 200;
const CARRY_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Carry a skill folder's companion files (reference guides the body links to, data tables,
 * scripts) into the materialized folder. The SKILL.md itself is rewritten here, so the source
 * one is skipped; junk folders are never carried; dereferenced real bytes land (symlink farms
 * travel as files); a visited set of real paths keeps a symlink cycle finite. A file already
 * present with the same size is left untouched, so the agent's folder watcher does not see a
 * change on every materialize. Files beyond the budgets stay behind (the skill still works;
 * its body is what the agent reads first).
 */
function carrySkillFiles(from, dest) {
  let files = 0, bytes = 0;
  const seen = new Set();
  const walk = (src, rel) => {
    let entries;
    try { entries = readdirSync(src, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files >= CARRY_MAX_FILES || bytes >= CARRY_MAX_BYTES) return;
      if (rel === '' && entry.name === 'SKILL.md') continue;
      if (entry.name.startsWith('.') || (entry.isDirectory() && CARRY_SKIP_DIRS.has(entry.name))) continue;
      const sourcePath = join(src, entry.name);
      let real = sourcePath;
      try { real = realpathSync(sourcePath); } catch { continue; }
      if (seen.has(real)) continue;
      seen.add(real);
      const target = join(dest, rel, entry.name);
      let info;
      try { info = statSync(sourcePath); } catch { continue; }
      if (info.isDirectory()) { mkdirSync(target, { recursive: true }); walk(sourcePath, join(rel, entry.name)); continue; }
      if (!info.isFile()) continue;
      if (bytes + info.size > CARRY_MAX_BYTES) continue;
      try { if (statSync(target).size === info.size) continue; } catch { /* not carried yet */ }
      mkdirSync(join(dest, rel), { recursive: true });
      try { cpSync(sourcePath, target, { dereference: true }); } catch { continue; }
      files++; bytes += info.size;
    }
  };
  walk(from, '');
  return { files, bytes };
}

/**
 * Make `root` hold exactly the skills the agent may use: one folder each, a SKILL.md with frontmatter. A skill switched off is written
 * with `disable-model-invocation` (the agent does not offer it); folders of skills that are gone are removed. Only this folder is touched.
 * A skill that comes from a folder (`dir`: a native skill pack, a workspace skill) carries that folder's companion files with it, so a
 * body that links `references/*.md` finds them beside the rewritten SKILL.md.
 * @param {string} root
 * @param {Array<{id: string, name: string, description?: string, body?: string, enabled?: boolean, dir?: string}>} skills
 */
export function materializeSkills(root, skills) {
  mkdirSync(root, { recursive: true });
  const keep = new Set();
  for (const s of skills) {
    const slug = skillSlug(s.id.replace(/^(?:ws|my)-/, '') || s.name);
    if (!slug || !s.body?.trim()) continue;
    let unique = slug, n = 2;
    while (keep.has(unique)) unique = `${slug}-${n++}`;
    keep.add(unique);
    const dir = join(root, unique);
    mkdirSync(dir, { recursive: true });
    const text = skillFileText({ name: unique, description: `${s.name}. ${s.description ?? ''}`.trim(), body: s.body, hidden: s.enabled === false });
    const file = join(dir, 'SKILL.md');
    // Only a changed skill is rewritten: the agent watches this folder and treats every write as a change to its list.
    let same = false; try { same = readFileSync(file, 'utf8') === text; } catch { /* not there yet */ }
    if (!same) writeFileSync(file, text);
    if (s.dir && existsSync(s.dir) && statSync(s.dir).isDirectory()) carrySkillFiles(s.dir, dir);
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && !keep.has(entry.name)) rmSync(join(root, entry.name), { recursive: true, force: true });
  return [...keep];
}
