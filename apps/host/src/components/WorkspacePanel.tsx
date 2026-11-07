import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { Icon } from './ui';

/** The right-side workspace panel (learning from DeepSeek's and Codex's): this chat's folder as a
 * file tree, a bounded code viewer, and a fixed git menu (status / log / diff / branches) - read
 * only, served by /api/workspace-fs and /api/workspace-git over the chat root. */
export function WorkspacePanel({ chatId, onClose }: {
    chatId: string | null;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<'files' | 'git'>('files');
    const [path, setPath] = useState('');
    const [entries, setEntries] = useState<{ name: string; dir: boolean; size: number }[] | null>(null);
    const [file, setFile] = useState<{ path: string; content?: string; binary?: boolean; size?: number; truncated?: boolean } | null>(null);
    const [gitOp, setGitOp] = useState('status');
    const [gitOut, setGitOut] = useState('');
    const [error, setError] = useState('');
    const [branch, setBranch] = useState('');
    const [switchable, setSwitchable] = useState<string[]>([]);
    const [switching, setSwitching] = useState('');
    useEffect(() => {
        if (chatId === null) return;
        let alive = true;
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=status`).then(r => r.json()).then(d => {
            setBranch((String(d.out ?? '').match(/^## ([^\s.]+)/) || [])[1] ?? '');
        }).catch(() => {});
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=branches`).then(r => r.json()).then(d => {
            const locals = String(d.out ?? '').split('\n')
                .filter(l => /^  [^\s]/.test(l) && !l.includes('remotes/'))
                .map(l => l.replace(/^\s+/, '').split(/\s+/)[0]).filter(Boolean);
            if (alive) setSwitchable(locals);
        }).catch(() => {});
    }, [chatId, path, gitOp]);

    async function doSwitch(name: string) {
        if (!chatId) return;
        setSwitching(name);
        try {
            await fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=checkout&name=${encodeURIComponent(name)}`, { method: 'POST' });
            setBranch(name);
            // the graph and status reflect the new branch after the switch
            fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=status`).then(r => r.json()).then(d => {
                setGitOut(String(d.out ?? ''));
            }).catch(() => {});
        } catch (e) { setError(String(e)); }
        setSwitching('');
    }

    useEffect(() => {
        if (tab !== 'files' || chatId === null) return;
        fetch(`/api/workspace-fs?chat=${encodeURIComponent(chatId)}&path=${encodeURIComponent(path)}`)
            .then(r => r.json()).then(d => { setEntries(d.entries ?? []); setError(''); }).catch(() => setError('The workspace is not reachable.'));
    }, [chatId, path, tab]);
    useEffect(() => {
        if (tab !== 'git' || chatId === null) return;
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=${gitOp}`)
            .then(r => r.json()).then(d => { setGitOut(String(d.out ?? d.error ?? '')); setError(''); }).catch(() => setError('The workspace is not reachable.'));
    }, [chatId, tab, gitOp]);

    async function open(name: string, dir: boolean) {
        if (!chatId) return;
        const next = path ? `${path}/${name}` : name;
        if (dir) { setFile(null); setPath(next); return; }
        try {
            const d = await fetch(`/api/workspace-fs?chat=${encodeURIComponent(chatId)}&mode=read&path=${encodeURIComponent(next)}`).then(r => r.json());
            setFile({ path: next, content: d.content, binary: d.binary, size: d.size, truncated: d.truncated });
        } catch { setError('The file could not be read.'); }
    }
    const up = () => { const at = path.lastIndexOf('/'); setFile(null); setPath(at > 0 ? path.slice(0, at) : ''); };
    const kb = (n?: number) => n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

    return <aside className="wspanel" aria-label={tr('Workspace')}>
        <div className="wspanel__head">
            <strong>{tr('Workspace')}</strong>
            <span className="wspanel__tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>{tr('Files')}</button>
                <button role="tab" aria-selected={tab === 'git'} onClick={() => setTab('git')}>Git</button>
            </span>
            <button className="wspanel__close" aria-label={tr('Close')} onClick={onClose}><Icon name="chevron" size={14}/></button>
        </div>
        {tr(tab === 'files' ? <div className="wspanel__body">
            <div className="wspanel__crumb"><button onClick={() => { setFile(null); setPath(''); }}>{tr('workspace root')}</button>{branch ? <button className="wspanel__branch" title={tr('Open the git graph')} onClick={() => { setTab('git'); setGitOp('log'); }}>⑂ {branch}</button> : null}{path.split('/').filter(Boolean).map(seg => <span key={seg}> / <button onClick={() => setPath(path.slice(0, path.lastIndexOf(seg) + seg.length))}>{seg}</button></span>)}</div>
            <div className="wspanel__split">
                <div className="wspanel__tree" role="list">
                    {path ? <button role="listitem" className="wspanel__row" onClick={up}>..</button> : null}
                    {tr((entries ?? []).map(e => <button role="listitem" key={e.name} className="wspanel__row" onClick={() => open(e.name, e.dir)}>
                        <Icon name={e.dir ? 'folder' : 'attach'} size={14}/><span className="wspanel__name">{e.name}</span><small>{e.dir ? '' : kb(e.size)}</small>
                    </button>))}
                    {entries !== null && !entries.length ? <p className="xs muted">{tr('Empty folder')}</p> : null}
                </div>
                <div className="wspanel__view">
                    {file === null ? <p className="xs muted">{tr('Choose a file to view it.')}</p>
                        : file.binary ? <p className="xs muted">{tr('Binary file - {0}, not shown here.', [kb(file.size)])}</p>
                            : <><div className="wspanel__filehead"><code>{file.path}</code><small className="muted">{kb(file.size)}{file.truncated ? tr(' · truncated at 512 KB') : ''}</small></div>
                                <pre className="wspanel__code">{file.content}</pre></>}
                </div>
            </div>
            {error ? <p className="xs inline-error">{tr(error)}</p> : null}
        </div> : <div className="wspanel__body">
            <div className="wspanel__crumb">{['status', 'log', 'diff', 'branches'].map(op => <button key={op} aria-pressed={gitOp === op} onClick={() => setGitOp(op)}>{op}</button>)}</div>
            {gitOp === 'branches' && switchable.length ? <div className="wspanel__branchswitch">{tr(switchable.map(name => <button key={name} className="text-action" disabled={name === branch || switching === name} onClick={() => void doSwitch(name)}>{tr(name === branch ? "⌃ current" : "Switch to {0}", [name])}</button>))}</div> : null}
            <pre className="wspanel__code">{gitOut || '…'}</pre>
        </div>)}
    </aside>;
}
