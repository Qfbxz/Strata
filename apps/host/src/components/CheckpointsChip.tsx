import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { rewindTo } from '../lib/store';
import { Btn, Dialog } from './ui';

/** The turn shape the picker needs — the picker only reads, never writes. */
interface CheckpointMsg { id: string; role: string; at: string; content: string; local?: boolean }

/** The user turns that are rewind points, oldest first, capped so a long chat stays a list.
 * Notes from the app itself and empty sends are not checkpoints. */
export function checkpointRows(messages: CheckpointMsg[] | undefined): CheckpointMsg[] {
    const rows = (messages ?? []).filter(m => m.role === 'user' && !m.local && m.content.trim());
    return rows.slice(-40).reverse();
}

function timeOf(at: string): string {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The restore-point picker beside the branch chip (Claude Code keeps a rewind there too).
 * Every sent message is a checkpoint: picking one forks the chat at that turn and puts the
 * message's words back into the composer, the same way the per-message rewind button works. */
export function CheckpointsChip({ messages, streaming, onEditPrompt }: {
    messages: CheckpointMsg[] | undefined;
    streaming: boolean;
    onEditPrompt: (prompt: string) => void;
}) {
    const [enabled, setEnabled] = useState(true);
    const [open, setOpen] = useState(false);
    const rows = checkpointRows(messages);

    useEffect(() => {
        let alive = true;
        fetch('/api/features').then(r => r.json()).then(d => { if (alive) setEnabled(d.checkpoints !== false); }).catch(() => {});
        return () => { alive = false; };
    }, []);

    if (!enabled || rows.length === 0) return null;
    return <>
        <button type="button" className="branchchip" title={tr("Restore points")} onClick={() => setOpen(true)}>
            <span aria-hidden={true}>⟲</span>{tr("Restore points")}
        </button>
        <Dialog open={open} title={tr("Restore points")} onClose={() => setOpen(false)} actions={<Btn onClick={() => setOpen(false)}>{tr("Close")}</Btn>}>
            <><p className="xs muted mempanel__root">{tr("The chat forks at the message you pick; your words come back to the composer.")}</p>
            <div className="mempanel__list" role="listbox" aria-label={tr("Restore points")}>
                {rows.map(m => <button type="button" key={m.id} className="mempanel__row" disabled={streaming}
                    onClick={() => {
                        const prompt = rewindTo(m.id);
                        if (prompt !== null) { onEditPrompt(prompt); setOpen(false); }
                    }}>
                    <span className="xs muted">{timeOf(m.at)}</span>
                    <span className="small" title={m.content.slice(0, 200)}>{m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content}</span>
                    <span className="text-action">{tr("Rewind here")}</span>
                </button>)}
            </div></>
        </Dialog>
    </>;
}
