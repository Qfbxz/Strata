import { tr } from '../lib/i18n';
import { elapsed, compactTokens } from '../lib/chat-metrics';
import type { SessionAgent } from '../lib/types';

const dot: Record<SessionAgent['status'], string> = { working: '#2e7d32', completed: '#5f6368', failed: '#b3261e', queued: '#9aa0a6', cancelled: '#9aa0a6' };

/** The chat's helpers as a chip row at the top of the conversation (DeepSeek harness keeps its
 * agent list there too): click a chip to aim the composer at that helper (what you type goes to
 * it, steering while it works, queueing when it has finished), and the folder button opens the
 * workspace panel over the folder they are working in. */
export function SubagentDock({ agents, target, onTarget, onOpenWorkspace }: {
    agents: SessionAgent[];
    target: string | null;
    onTarget: (id: string | null) => void;
    onOpenWorkspace: () => void;
}) {
    const rows = agents.filter(a => a.status !== 'cancelled');
    if (!rows.length) return null;
    return <div className="sdock" role="toolbar" aria-label={tr("Subagents")}>
        <span className="sdock__label">{tr("Subagents")}</span>
        {rows.map(a => <span key={a.id} className="sdock__chip" data-status={a.status} data-target={target === a.id || undefined}>
            <button type="button" className="sdock__pick" title={tr("Talking to {0}: messages go to this helper, not the chat.", [a.name])} onClick={() => onTarget(target === a.id ? null : a.id)}>
                <span className="sdock__dot" style={{ background: dot[a.status] ?? dot.queued }} aria-hidden={true}/>
                <strong>{a.name}</strong>
                <span className="sdock__meta">{tr(elapsed(a.durationMs))}</span>
            </button>
            <button type="button" className="sdock__folder" title={tr("Open workspace")} aria-label={tr("Open workspace")} onClick={onOpenWorkspace}>⌂</button>
            <span className="sdock__tok">{compactTokens(a.tokens)}</span>
        </span>)}
    </div>;
}
