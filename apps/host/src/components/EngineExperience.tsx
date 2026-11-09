import { tr } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Btn, Dialog, Icon } from './ui';
import { speedText } from '../lib/experience';
import type { Experience } from '../lib/experience';
export function SpeedPair({ experience: e }: {
    experience: Experience;
}) {
    return <div className="speed-summary" title={tr(e.provenance)} aria-label={tr("Reading and answer speeds. {0}.", [e.source === 'demo' ? tr('Illustrative estimates') : e.source])}><div className="speed-pair">{tr([{ label: 'Reading', value: e.reading, tone: 'info' }, { label: 'Answer', value: e.answer, tone: 'accent' }].map(m => <div key={m.label} data-tone={m.tone}><span className="small muted">{tr(m.label)}</span><strong className="speed-value">{tr(speedText(m.value))}{tr(m.value ? <small>{tr(" tok/s")}</small> : null)}</strong></div>))}</div></div>;
}
export function DemoTest({ open, onClose, experience }: {
    open: boolean;
    onClose: () => void;
    experience: Experience;
}) {
    const status = useRef<HTMLParagraphElement>(null);
    const [stage, setStage] = useState(0);
    const [running, setRunning] = useState(false);
    useEffect(() => {
        if (open) {
            setStage(0);
            setRunning(false);
        }
    }, [open]);
    useEffect(() => {
        if (!open || !running || stage >= 4)
            return;
        const timer = setTimeout(() => setStage(s => s + 1), 900);
        return () => clearTimeout(timer);
    }, [open, running, stage]);
    useEffect(() => {
        if (open && running && (stage === 0 || stage === 4))
            status.current?.focus({ preventScroll: true });
    }, [open, running, stage]);
    const demoOnly = experience.source === 'demo';
    return <Dialog open={open} title={tr("Speed test preview")} onClose={onClose} actions={<><Btn onClick={() => { setRunning(false); onClose(); }}>{tr(running && stage < 4 ? 'Cancel preview' : 'Close')}</Btn><Btn variant="primary" disabled={!experience.fitsWorkload || running && stage < 4} onClick={() => { setStage(0); setRunning(true); }}>{tr(stage === 4 ? 'Replay preview' : 'Start preview')}</Btn></>}>
    <div className="stack"><p className="muted">{tr("Explore the test flow. Preview values are never stored as measured performance or used as real recommendation evidence.")}</p>
    <ol className="test-stages">{tr(['Warm up', 'Read sample prompt', 'Generate sample answer', 'Review results'].map((label, i) => <li key={label} data-state={running && stage > i ? 'done' : running && stage === i ? 'active' : 'pending'}><span>{tr(running && stage > i ? <Icon name="check" size={16}/> : i + 1)}</span>{tr(label)}</li>))}</ol>
    <p ref={status} tabIndex={-1} role="status" className="small">{tr(!running ? 'Ready to preview' : stage === 4 ? 'Preview complete. No measurement was taken.' : tr('Preview: {0}…', [tr(['warming up', 'reading', 'generating', 'preparing results'][stage])]))}</p>
    {tr(stage === 4 ? demoOnly ? <SpeedPair experience={experience}/> : <p className="small muted">{tr("The flow is ready. Speeds remain unmeasured until a local benchmark adapter is connected.")}</p> : null)}</div>
  </Dialog>;
}
