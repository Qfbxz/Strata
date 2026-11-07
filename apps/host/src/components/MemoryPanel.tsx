import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { Btn, Dialog, IconBtn } from './ui';
import { compactTokens } from '../lib/chat-metrics';

interface MemFile { path: string; bytes: number; mtime: number }

/** The auto-memory panel, read-only: the plugin's typed memory files and their MEMORY.md index,
 * listed newest first, one file's content beside the list. The plugin stays the only writer —
 * this surface exists so the person can see what the assistant remembers and reads each turn. */
export function MemoryPanel() {
    const [open, setOpen] = useState(false);
    const [files, setFiles] = useState<MemFile[] | null>(null);
    const [root, setRoot] = useState('');
    const [at, setAt] = useState<MemFile | null>(null);
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    function load() {
        setError(''); setFiles(null); setAt(null); setContent('');
        fetch('/api/memory').then(r => r.json()).then(d => { setFiles(d.files ?? []); setRoot(d.root ?? ''); }).catch(e => setError(e.message));
    }
    function show(f: MemFile) {
        setAt(f); setContent('');
        fetch(`/api/memory/file?path=${encodeURIComponent(f.path)}`).then(r => r.json()).then(d => setContent(d.content ?? d.error ?? '')).catch(e => setError(e.message));
    }
    useEffect(() => { if (open && files === null) load(); }, [open, files]);
    return <>
        <IconBtn name="memory" title={tr("Auto memory")} aria-label={tr("Auto memory")} onClick={() => setOpen(v => !v)}/>
        <Dialog open={open} title={tr("Auto memory")} onClose={() => setOpen(false)} actions={<><Btn onClick={load}>{tr("Refresh")}</Btn><Btn onClick={() => setOpen(false)}>{tr("Close")}</Btn></>}>
            <><p className="xs muted mempanel__root">{root}</p>
            {tr(error ? <p className="small inline-error" role="alert">{error}</p> : null)}
            <div className="mempanel">
                <div className="mempanel__list" role="listbox" aria-label={tr("Memory files")}>
                    {tr(files === null ? <p className="small muted">{tr("Reading…")}</p> : files.length ? files.map(f => <button key={f.path} role="option" aria-selected={at?.path === f.path} className="mempanel__row" data-active={at?.path === f.path || undefined} onClick={() => show(f)}>
                        <strong>{f.path.split('/').pop()}</strong>
                        <span className="xs muted">{compactTokens(Math.max(1, Math.ceil(f.bytes / 1024)))} · {new Date(f.mtime).toLocaleString()}</span>
                    </button>) : <p className="small muted">{tr("No memory files yet. The assistant builds them as it works.")}</p>)}
                </div>
                <pre className="mempanel__view">{at ? (content || '…') : tr("Pick a memory file to read it.")}</pre>
            </div></>
        </Dialog>
    </>;
}
