/**
 * Agents on disk, Claude-Code style: an agent is one `<slug>.md` file or one `<slug>/AGENT.md`
 * folder file, frontmatter on top (name, description, optional tools and model) and the
 * instructions underneath. The app keeps them in its own folder (`<data>/agents/`) and reads a
 * workspace's own folder too (`<workspace>/agents/`), the same two places skills live. A chosen
 * agent speaks with its instructions; the list of agents is also put in front of the model so it
 * knows who it can call on.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const slugify = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** name, description, tools, model and instructions out of one agent file (frontmatter optional). */
export function parseAgentFile(text) {
  const raw = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { name: null, description: null, tools: null, model: null, instructions: raw.trim() };
  const field = key => {
    // `[ \t]*`, never \s*: a value lives on the key's own line, and \s* would swallow the newline and steal the next line's list item
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'mi').exec(m[1])?.[1]?.trim();
    if (line === undefined) return null;
    try { if (/^["']/.test(line)) return typeof JSON.parse(line.replace(/^'(.*)'$/, '"$1"')) === 'string' ? JSON.parse(line.replace(/^'(.*)'$/, '"$1"')) : line; } catch { /* plain scalar */ }
    return line;
  };
  // tools: `read, edit, shell` on one line, or a YAML list (`- read` per line) under `tools:`
  let tools = null;
  const inline = field('tools');
  if (inline !== null && inline !== '') tools = inline.split(',').map(t => t.trim()).filter(Boolean);
  else {
    // `[ \t]*` (never \s*) after the colon: the list sits on the NEXT lines and \s* would swallow the newline
    const block = /^[ \t]*tools:[ \t]*\n((?:[ \t]+-[ \t]*.+\n?)+)/mi.exec(m[1]);
    if (block) tools = [...block[1].matchAll(/^[ \t]+-[ \t]*(.+)$/gm)].map(x => x[1].trim()).filter(Boolean);
  }
  return { name: field('name'), description: field('description'), tools: tools?.length ? tools : null, model: field('model'), instructions: raw.slice(m[0].length).trim() };
}

const SKIP = new Set(['node_modules', '.git', '.svn', 'dist', 'build', '__pycache__', '.venv']);

/**
 * Every agent found under the given folders, first folder wins on an id clash.
 * One agent is a `<slug>.md` file or a `<slug>/AGENT.md` file; folders that hold neither are
 * not agents (their subfolders are still scanned, so collections nest like skills do).
 * @param {string[]} dirs
 * @returns {Array<{id: string, name: string, description: string, tools: string[]|null, model: string|null, instructions: string, path: string}>}
 */
export function scanAgentDirs(dirs, { io = { existsSync, readdirSync, readFileSync } } = {}) {
  const byId = new Map();
  const order = [];
  for (const dir of dirs || []) {
    if (!dir) continue;
    let entries;
    try { entries = io.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      let path = null;
      if (entry.isFile() && /\.md$/i.test(entry.name)) path = join(dir, entry.name);
      else if (entry.isDirectory()) {
        for (const candidate of ['AGENT.md', 'agent.md']) {
          const p = join(dir, entry.name, candidate);
          if (io.existsSync(p)) { path = p; break; }
        }
        if (!path) {
          // a plain collection folder: scan one level deeper for `<name>/AGENT.md`
          let inner;
          try { inner = io.readdirSync(join(dir, entry.name), { withFileTypes: true }); } catch { continue; }
          for (const nested of inner) {
            if (!nested.isDirectory() || nested.name.startsWith('.')) continue;
            const p = join(dir, entry.name, nested.name, 'AGENT.md');
            if (io.existsSync(p)) { path = p; break; }
          }
          if (!path) continue;
        }
      } else continue;
      let text = null;
      try { text = io.readFileSync(path, 'utf8'); } catch { continue; }
      const parsed = parseAgentFile(text);
      const slug = slugify(parsed.name || entry.name.replace(/\.md$/i, ''));
      if (!slug || !parsed.instructions) continue;
      if (byId.has(slug)) continue;
      const agent = {
        id: slug,
        name: parsed.name || entry.name.replace(/\.md$/i, ''),
        description: parsed.description || `${parsed.instructions.split('\n')[0].slice(0, 120)}`,
        tools: parsed.tools,
        model: parsed.model,
        instructions: parsed.instructions,
        path,
      };
      byId.set(slug, agent);
      order.push(agent);
    }
  }
  return order;
}

/** The system-prompt block that tells the model who it can call on, or '' when nobody is defined. */
export function agentCatalogSection(agents) {
  const rows = (agents || []).filter(a => a.id && a.description);
  if (!rows.length) return '';
  const list = rows.map(a => `- ${a.id}: ${a.description}`).join('\n');
  return `Agents on this machine (personas with their own instructions). When the person asks for one by name — or a task clearly matches one — adopt it: follow its instructions for that work and say you are working as it.\n${list}`;
}

/** The system-prompt block for the one agent a chat is talking to, or '' for none. */
export function agentPersonaSection(agent) {
  if (!agent?.instructions) return '';
  const tools = agent.tools?.length ? ` Tools it may use: ${agent.tools.join(', ')}.` : '';
  return `You are working as the agent "${agent.name}". Follow these instructions for this conversation.${tools}\n${agent.instructions}`;
}
