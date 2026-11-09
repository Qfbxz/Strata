import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { Btn, Dialog, IconBtn } from './ui';

interface BranchRow { name: string; current: boolean; local: boolean }

function parseBranches(status: string, branchList: string): { current: string; rows: BranchRow[] } {
    const current = (status.match(/^## ([^\s.]+)/) || [])[1] ?? '';
    const rows: BranchRow[] = [];
    for (const line of branchList.split('\n')) {
        const m = /^(\*|\s)\s+(\S+)/.exec(line);
        if (!m) continue;
        const name = m[2];
        rows.push({ name, current: m[1] === '*', local: !name.startsWith('remotes/') });
    }
    return { current, rows };
}

/** The current git branch beside the project chip in the composer row (Codex desktop keeps it
 * there too), with the branch count. Clicking opens the branch manager: switch among local
 * branches, or open the workspace panel's git graph. Hidden when this chat has no folder or the
 * folder is not a git repository. */
export function BranchChip({ chatId, onOpenWorkspace }: {
    chatId: string | null | undefined;
    onOpenWorkspace: () => void;
}) {
    const [branch, setBranch] = useState('');
    const [count, setCount] = useState(0);
    const [enabled, setEnabled] = useState(true);
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<BranchRow[]>([]);
    const [current, setCurrent] = useState('');
    const [busy, setBusy] = useState('');
    const [problem, setProblem] = useState('');

    useEffect(() => {
        setBranch(''); setCount(0); setEnabled(true);
        if (!chatId) return;
        let alive = true;
        fetch('/api/features').then(r => r.json()).then(d => { if (alive) setEnabled(d.branchChip !== false); }).catch(() => {});
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=status`).then(r => r.json()).then(d => {
            if (alive) setBranch((String(d.out ?? '').match(/^## ([^\s.]+)/) || [])[1] ?? '');
        }).catch(() => { /* not a repository: no chip */ });
        // The badge on the chip counts the branches before the manager is opened (the owner's "branch count" ask).
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=branches`).then(r => r.json()).then(d => {
            if (alive) setCount(parseBranches('', String(d.out ?? '')).rows.length);
        }).catch(() => { /* not a repository: the chip stays without a badge */ });
        return () => { alive = false; };
    }, [chatId]);

    function loadDialog() {
        if (!chatId) return;
        setOpen(true); setProblem(''); setRows([]);
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=branches`).then(r => r.json()).then(d => {
            const parsed = parseBranches(branch, String(d.out ?? ''));
            setRows(parsed.rows); setCurrent(parsed.current); setCount(parsed.rows.length);
        }).catch(e => setProblem(e.message));
    }
    function switchTo(name: string) {
        if (!chatId || busy) return;
        setBusy(name); setProblem('');
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=checkout&name=${encodeURIComponent(name)}`)
            .then(r => r.json()).then(d => {
                setBranch((String(d.out ?? '').match(/Switched to (\S+)/) || [])[1] ?? name);
                setRows(rows2 => rows2.map(r => ({ ...r, current: r.name === name })));
                setCurrent(name); setBusy('');
            }).catch(e => { setProblem(e.message); setBusy(''); });
    }

    if (!branch || !enabled) return null;
    return <>
        <button type="button" className="branchchip" title={tr("Branches in this workspace")} onClick={loadDialog}>
            <span aria-hidden={true}>⑂</span>{branch}
            {count > 0 ? <span className="branchchip__count">{count}</span> : null}
            <IconBtn name="expand" size={13} title={tr("Open the workspace")} onClick={() => onOpenWorkspace()}/>
        </button>
        <Dialog open={open} title={tr("Branches in this workspace")} onClose={() => setOpen(false)} actions={<><Btn onClick={() => { loadDialog(); }}>{tr("Refresh")}</Btn><Btn onClick={() => { setOpen(false); onOpenWorkspace(); }}>{tr("Open the git graph")}</Btn><Btn onClick={() => setOpen(false)}>{tr("Close")}</Btn></>}>
            <><p className="xs muted mempanel__root">{tr("Current branch")}: <strong>{branch || current || '?'}</strong></p>
            <div className="mempanel__list" role="listbox" aria-label={tr("Branches")}>
                {tr(rows.length ? rows.map(r => <div key={r.name} className="mempanel__row branchmgr__row" data-current={r.current || undefined}>
                    {r.current ? <strong>⑂ {r.name}</strong> : <button type="button" className="text-action" disabled={busy === r.name} onClick={() => switchTo(r.name)}>{tr("Switch to {0}", [r.name])}</button>}
                    {!r.local ? <span className="xs muted">{tr("remote")}</span> : null}
                </div>) : <p className="small muted">{tr("Reading branches…")}</p>)}
            </div>
            {tr(problem ? <p className="small inline-error" role="alert">{problem}</p> : null)}
            {tr(count > 0 ? <p className="xs muted">{tr("{0} branches total.", [String(count)])}</p> : null)}</>
        </Dialog>
    </>;
}
