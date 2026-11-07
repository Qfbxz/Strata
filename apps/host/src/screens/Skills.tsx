import { tr } from '../lib/i18n';
/** Quiet skill rows; all editing lives in one focused dialog. */
import { useState } from 'react';
import { Btn, Dialog, Empty, Icon, IconBtn, Select, ErrorNotice } from '../components/ui';
import { Screen } from '../components/layout';
import { api } from '../lib/client';
import { pageIsOnThisComputer, postWithFolderFallback } from '../lib/folder-pick';
import { editSkill, loadSkills, toggleSkill, useStore } from '../lib/store';
import type { Skill } from '../lib/types';
interface SkillCandidate { path: string; name: string; title: string | null; description: string | null; bodyChars: number }
interface SkillScan { root: string; candidates: SkillCandidate[]; truncated: boolean }
interface SkillImport { imported: { from: string; added: string }[]; failed: { from: string; error: string }[] }
export function SkillsScreen() {
    const skills = useStore(s => s.skills);
    const workspaces = useStore(s => s.workspaces);
    const workspace = useStore(s => s.activeWorkspace);
    const [query, setQuery] = useState('');
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<'details' | 'instructions'>('details');
    const [editing, setEditing] = useState<Skill | null>(null);
    const [triggers, setTriggers] = useState('');
    const [scan, setScan] = useState<SkillScan | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [notice, setNotice] = useState('');
    const visible = skills.filter(s => `${s.source === 'bundled' ? tr(s.name) : s.name} ${s.source === 'bundled' ? tr(s.description) : s.description} ${s.triggers.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    async function action(id: string, fn: () => Promise<void>) {
        setPending(id);
        setError('');
        try {
            await fn();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setPending(null);
        }
    }
    async function add() {
        // The folder window opens on the computer that runs Strata. From a page on another computer there is nothing to see, so say so instead of waiting.
        if (!pageIsOnThisComputer(window.location.hostname))
            throw new Error(tr("Adding a skill opens a folder window on the computer that runs Strata. Open Strata on that computer to add one."));
        const result = await postWithFolderFallback<{
            cancelled?: boolean;
            added?: string;
        }>('/api/skills/add') as {
            cancelled?: boolean;
            added?: string;
        };
        if (!result.cancelled)
            await loadSkills();
    }
    /** The batch way in: pick one outer folder, the host lists every skill under it, you tick the ones to copy in. */
    async function scanFolder() {
        // The folder window opens on the computer that runs Strata, like adding a single skill.
        if (!pageIsOnThisComputer(window.location.hostname))
            throw new Error(tr("Importing skills opens a folder window on the computer that runs Strata. Open Strata on that computer to do it."));
        const result = await postWithFolderFallback<SkillScan & { cancelled?: boolean }>('/api/skills/scan') as SkillScan & { cancelled?: boolean };
        if (!result.cancelled) {
            setScan(result);
            setSelected(new Set(result.candidates.map(c => c.path)));
            setNotice('');
        }
    }
    async function runImport() {
        if (!scan || !selected.size)
            return;
        const result = await api.post<SkillImport>('/api/skills/import', { paths: [...selected] });
        setScan(null);
        setSelected(new Set());
        const failures = result.failed.length;
        setNotice(failures
            ? tr("Imported {0} of {1} skills. The rest failed: {2}", [String(result.imported.length), String(result.imported.length + failures), result.failed[0].error])
            : tr("Imported {0} skills.", [String(result.imported.length)]));
        await loadSkills();
    }
    /** A skill written here: a name, what it is for, and the instructions. Saved as a folder the assistant reads; it is there for the next message. */
    function openNew() { setTab('details'); setEditing({ id: '', name: '', description: '', body: '', triggers: [], enabled: true, source: 'created', onlyIn: null, sizeKb: 0, useCount: 0, lastUsedAt: null } as unknown as Skill); setTriggers(''); setError(''); }
    function openEditor(skill: Skill) { setTab('details'); setEditing({ ...skill }); setTriggers(skill.triggers.join(', ')); setError(''); }
    function closeEditor() {
        if (!pending) {
            setEditing(null);
            setError('');
        }
    }
    async function save() {
        if (!editing)
            return;
        if (!editing.id) {
            await api.post('/api/skills', { name: editing.name.trim(), description: editing.description.trim(), body: editing.body ?? '', enabled: editing.enabled, triggers: triggers.split(',').map(t => t.trim()).filter(Boolean) });
            await loadSkills();
            setEditing(null);
            return;
        }
        await editSkill(editing.id, { name: editing.name.trim(), description: editing.description.trim(), body: editing.body, triggers: triggers.split(',').map(t => t.trim()).filter(Boolean), enabled: editing.enabled, onlyIn: editing.onlyIn ?? null });
        setEditing(null);
    }
    return <Screen title={tr("Skills")} titleDetail={tr("Manage your skills library")} actions={<><Btn icon="plus" variant="primary" disabled={!!pending} onClick={openNew}>{tr("New skill")}</Btn><Btn icon="folder-plus" disabled={!!pending} onClick={() => void action('add', add)}>{tr("Add skill")}</Btn><Btn icon="layers" disabled={!!pending} onClick={() => void action('scan', scanFolder)}>{tr("Import skills")}</Btn><input className="st-input skills-header-search" type="search" aria-label={tr("Search skills")} placeholder={tr("Search skills…")} value={query} onChange={e => setQuery(e.target.value)}/><IconBtn name="refresh" title={tr("Refresh skills")} disabled={!!pending} onClick={() => void action('refresh', loadSkills)}/></>}>
    <div className="skills-page">{tr(error && !editing ? <ErrorNotice message={error} action={tr("Retry")} onRetry={() => void action('refresh', loadSkills)}/> : null)}
      {tr(notice ? <p className="small skill-import-notice" role="status">{notice}</p> : null)}
      {tr((['bundled', 'added'] as const).map(group => { const rows = visible.filter(s => group === 'bundled' ? s.source === 'bundled' : s.source !== 'bundled'); return rows.length ? <section className="skill-group" aria-label={tr(group === 'bundled' ? 'Built-in skills' : 'Added skills')} key={group}>{tr(group === 'added' ? <h3 className="h4">{tr("Added skills")}</h3> : null)}<div>{tr(rows.map(s => <article className="skill-row" key={s.id}><span className="skill-symbol"><Icon name="skills" size={26}/></span><div className="skill-copy"><h3 className="h4">{s.source === 'bundled' ? tr(s.name) : s.name}</h3><p className="small muted">{s.source === 'bundled' ? tr(s.description) : s.description}</p>{tr(s.onlyIn ? <span className="xs muted">{tr(s.onlyIn === workspace ? 'This workspace' : `Only in ${workspaces.find(w => w.id === s.onlyIn)?.name ?? 'another workspace'}`)}</span> : null)}</div><div className="skill-row-actions"><IconBtn name="pencil" title={tr("Edit {0}", [s.name])} disabled={!!pending} onClick={() => openEditor(s)}/><button className="st-toggle" role="switch" aria-checked={s.enabled} aria-label={tr("Enable {0}", [s.name])} disabled={!!pending} onClick={() => void action(s.id, () => toggleSkill(s.id, !s.enabled))}/></div></article>))}</div></section> : null; }))}
      {tr(!visible.length ? <Empty icon="skills" title={tr(skills.length ? 'No matching skills' : 'No skills yet')} body={skills.length ? 'Try another search.' : 'Add a folder containing SKILL.md.'} action={tr(<Btn variant={skills.length ? undefined : 'primary'} onClick={() => skills.length ? setQuery('') : void action('add', add)}>{tr(skills.length ? 'Clear search' : 'Add skill')}</Btn>)}/> : null)}
      
    </div>
    <Dialog open={!!editing} title={tr(editing && !editing.id ? 'New skill' : 'Edit skill')} onClose={closeEditor} actions={<><Btn disabled={!!pending} onClick={closeEditor}>{tr("Cancel")}</Btn><Btn variant="primary" disabled={!!pending || !editing?.name.trim() || !editing?.body?.trim()} onClick={() => void action(editing!.id, save)}>{tr(pending ? 'Saving…' : editing && !editing.id ? 'Save skill' : 'Save changes')}</Btn></>}>
      {tr(editing ? <><div className="editor-tabs" role="tablist" aria-label={tr("Skill editor sections")}>{tr((['details', 'instructions'] as const).map(t => <button key={t} id={`skill-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls={`skill-panel-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={e => {
                    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                        e.preventDefault();
                        const next = tab === 'details' ? 'instructions' : 'details';
                        setTab(next);
                        document.getElementById(`skill-tab-${next}`)?.focus();
                    }
                }}>{tr(t === 'details' ? 'Details' : 'Instructions')}</button>))}</div><div className="form-stack settings-tab-panel" role="tabpanel" id={`skill-panel-${tab}`} aria-labelledby={`skill-tab-${tab}`}>
      {tr(tab === 'details' ? <><div className="skill-detail-grid skill-detail-grid--name"><label className="input-field"><span>{tr("Name")}</span><input className="st-input" maxLength={120} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label><div className="input-field skill-enable-field"><span>{tr("Enabled")}</span><button className="st-toggle" role="switch" aria-label={tr("Skill enabled")} aria-checked={editing.enabled} onClick={() => setEditing({ ...editing, enabled: !editing.enabled })}/></div></div><label className="input-field"><span>{tr("Description")}</span><input className="st-input" maxLength={500} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}/></label>
        <div className="skill-detail-grid"><div className="input-field"><span id="skill-scope-label">{tr("Available in")}</span><Select ariaLabel={tr("Skill workspace scope")} value={editing.onlyIn ?? 'all'} options={[{ value: 'all', label: 'All workspaces' }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} onChange={value => setEditing({ ...editing, onlyIn: value === 'all' ? null : value })}/></div>
        <label className="input-field"><span>{tr("Trigger phrases")}</span><input className="st-input" value={triggers} onChange={e => setTriggers(e.target.value)} placeholder={tr("review this, check my code")}/><small className="muted">{tr("Separate phrases with commas.")}</small></label></div>
        </> : <label className="input-field"><span className="sr-only">{tr("Instructions")}</span><textarea className="st-input skill-instructions" rows={10} maxLength={64000} value={editing.body ?? ''} onChange={e => setEditing({ ...editing, body: e.target.value })}/></label>)}
        {tr(editing.id ? <p className="xs muted">{tr("Changes are saved in Strata. The original skill file stays intact.")}</p> : null)}{tr(error ? <ErrorNotice message={error} action={tr("Retry")} onRetry={() => void action('refresh', loadSkills)}/> : null)}</div></> : null)}
    </Dialog>
    <Dialog open={!!scan} title={tr("Import skills from folder")} onClose={() => { if (!pending) { setScan(null); setError(''); } }} actions={<><Btn disabled={!!pending} onClick={() => { setScan(null); setError(''); }}>{tr("Cancel")}</Btn><Btn variant="primary" disabled={!!pending || !selected.size} onClick={() => void action('import', runImport)}>{selected.size ? tr("Import {0} selected", [String(selected.size)]) : tr("Import selected")}</Btn></>}>
      {tr(scan ? <div className="stack">
        <p className="small muted">{scan.candidates.length
            ? tr(scan.truncated
                ? "Showing the first {0} skills found under {1}."
                : "{0} skills found under {1}.", [String(scan.candidates.length), scan.root])
            : tr("No skills found under that folder. A skill is a folder holding a SKILL.md file.")}</p>
        {tr(scan.candidates.length ? <><div className="row small skill-import-tools"><Btn disabled={!!pending} onClick={() => setSelected(new Set(scan.candidates.map(c => c.path)))}>{tr("Select all")}</Btn><Btn disabled={!!pending} onClick={() => setSelected(new Set())}>{tr("Clear selection")}</Btn></div>
          <div className="stack skill-import-list" role="group" aria-label={tr("Skills to import")}>{tr(scan.candidates.map(c => <label className="row skill-import-row" key={c.path}><input type="checkbox" checked={selected.has(c.path)} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(c.path); else next.delete(c.path); return next; })}/><span className="skill-import-copy"><strong>{c.title || c.name}</strong>{tr(c.description ? <span className="small muted">{c.description}</span> : null)}<span className="xs muted">{c.path}</span></span></label>))}</div>
          {tr(error ? <ErrorNotice message={error}/> : null)}</> : null)}
      </div> : null)}
    </Dialog>
  </Screen>;
}
