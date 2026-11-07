import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { IconBtn } from './ui';

/** The current git branch beside the project chip in the composer row (Codex desktop keeps it
 * there too). Read-only: the same /api/workspace-git status the workspace panel reads; clicking
 * it opens that panel, where the branch button leads to the git graph. Hidden when this chat has
 * no folder or the folder is not a git repository. */
export function BranchChip({ chatId, onOpenWorkspace }: {
    chatId: string | null | undefined;
    onOpenWorkspace: () => void;
}) {
    const [branch, setBranch] = useState('');
    const [enabled, setEnabled] = useState(true);
    useEffect(() => {
        setBranch('');
        if (!chatId) return;
        let alive = true;
        fetch('/api/features').then(r => r.json()).then(d => { if (alive) setEnabled(d.branchChip !== false); }).catch(() => {});
        fetch(`/api/workspace-git?chat=${encodeURIComponent(chatId)}&op=status`).then(r => r.json()).then(d => {
            if (alive) setBranch((String(d.out ?? '').match(/^## ([^\s.]+)/) || [])[1] ?? '');
        }).catch(() => { /* not a repository: no chip */ });
        return () => { alive = false; };
    }, [chatId]);
    if (!branch || !enabled) return null;
    return <button type="button" className="branchchip" title={tr("Open the workspace")} onClick={onOpenWorkspace}>
        <span aria-hidden={true}>⑂</span>{branch}
        <IconBtn name="expand" size={13} title={tr("Open the workspace")} onClick={onOpenWorkspace}/>
    </button>;
}
