import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';

/** The switches behind the assistant's file surfaces, all in one place (the Settings page reads
 * and writes /api/features; the host re-reads the saved object on every turn). Dropping files in
 * the folders turns a surface on; the switch here turns it back off without moving the files. */
const SWITCHES: { key: string; label: string }[] = [
    { key: 'agents', label: "Agent personas (agents folders)" },
    { key: 'hooks', label: "Hook scripts (hooks folders; pre-turn can veto)" },
    { key: 'memory', label: "Memory index in direct chats" },
    { key: 'projectInstructions', label: "Project instructions (CLAUDE.md / AGENTS.md)" },
    { key: 'skillsNative', label: "Native skill packs (other agents' folders, read-only)" },
    { key: 'branchChip', label: "Branch chip in the composer" },
    { key: 'checkpoints', label: "Restore-point picker in the composer" },
    { key: 'modelByName', label: "Pick a chat model by typing its name" },
];

interface Features { [key: string]: boolean }

interface SmallModelView {
    enabled: boolean;
    idleUnloadS: number;
    exe?: string;
    model?: string;
    mmproj?: string;
    servingEnabled?: boolean | null;
    note?: string;
    pushedToServer?: boolean;
}

/** One row: the name on the left, the control on the right (never squeezed), the hint full-width below. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return <label className="feature-flags__row">
        <span className="feature-flags__name">{tr(label)}</span>
        {children}
        {hint ? <small className="muted feature-flags__hint">{tr(hint)}</small> : null}
    </label>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return <fieldset className="feature-flags__section">
        <legend className="feature-flags__title">{tr(title)}</legend>
        {children}
    </fieldset>;
}

export function FeatureFlagsSetting() {    const [features, setFeatures] = useState<Features | null>(null);
    const [problem, setProblem] = useState('');
    useEffect(() => {
        fetch('/api/features').then(r => r.json()).then(d => setFeatures(d)).catch(e => setProblem(e.message));
    }, []);
    function toggle(key: string) {
        if (!features) return;
        const next = { ...features, [key]: !features[key] };
        setFeatures(next);   // optimistic; the host answers with the merged view
        fetch('/api/features', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: next[key] }) })
            .then(r => r.json())
            .then((saved: Features) => setFeatures(saved))
            .catch(e => setProblem(e.message));
    }
    const [small, setSmall] = useState<SmallModelView | null>(null);
    useEffect(() => { fetch('/api/small-model').then(r => r.json()).then(d => setSmall(d)).catch(() => {}); }, []);
    function saveSmall(patch: Partial<SmallModelView>) {
        if (!small) return;
        const next = { ...small, ...patch };
        setSmall(next);
        fetch('/api/small-model', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !!next.enabled, idleUnloadS: Number(next.idleUnloadS) || 0, exe: next.exe ?? '', model: next.model ?? '', mmproj: next.mmproj ?? '' }) })
            .then(r => r.json()).then(d => setSmall(d)).catch(() => {});
    }
    const switchRow = (s: { key: string; label: string }) => <label key={s.key} className="feature-flags__row">
        <span className="feature-flags__name">{tr(s.label)}</span>
        <button className="st-toggle" role="switch" aria-checked={features ? !!features[s.key] : false} aria-label={tr(s.label)} disabled={!features} onClick={() => toggle(s.key)}/>
    </label>;
    return <span className="row feature-flags">
        <Section title="What the assistant reads and runs">
            {tr(SWITCHES.map(switchRow))}
        </Section>
        <Section title="Prompt rewrite">
            <Row label="Rewrite vague messages with the small model before the main one"
                 hint="A second, small model restates an unclear message into a clear request, and asks you back when the request is truly ambiguous. The original wording always rides along. Needs the small model below.">
                <button className="st-toggle" role="switch" aria-checked={features ? !!features.promptRewrite : false} aria-label={tr("Rewrite vague messages with the small model before the main one")} disabled={!features} onClick={() => toggle('promptRewrite')}/>
            </Row>
        </Section>
        <Section title="Small model sidecar">
            <Row label="Small model sidecar"
                 hint="A second, small model answers session titles and summaries on 'model': 'small', and describes pictures for a main model with no vision. Off = everything goes to the main model as before. Used from the next start of the model.">
                <button className="st-toggle" role="switch" aria-checked={!!small?.enabled} aria-label={tr("Small model sidecar")} disabled={!small} onClick={() => saveSmall({ enabled: !small?.enabled })} />
            </Row>
            <Row label="Stop the small model after (seconds)"
                 hint="Stop the small model's process after this many seconds without requests. 0 = keep it running.">
                <input className="st-input" style={{ width: 72 }} inputMode="numeric" aria-label={tr("Stop the small model after (seconds)")} value={small?.idleUnloadS ?? ''} disabled={!small} onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n) && n >= 0) saveSmall({ idleUnloadS: n }); }} />
            </Row>
            <Row label="Small model files"
                 hint="The llama-server binary and the small model's GGUF (a multimodal Qwen2.5-VL works best) with its picture projector.">
                <span className="feature-flags__paths">
                    <input className="st-input" aria-label={tr("llama-server binary")} placeholder="llama-server" value={small?.exe ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, exe: e.target.value } : s)} onBlur={() => saveSmall({})} />
                    <input className="st-input" aria-label={tr("small model GGUF")} placeholder="Qwen3-VL-4B Q8_0.gguf" value={small?.model ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, model: e.target.value } : s)} onBlur={() => saveSmall({})} />
                    <input className="st-input" aria-label={tr("picture projector GGUF")} placeholder="mmproj Q8_0.gguf" value={small?.mmproj ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, mmproj: e.target.value } : s)} onBlur={() => saveSmall({})} />
                    {small?.pushedToServer != null && <span className="muted feature-flags__hint">{tr(small.pushedToServer ? "Saved. Used from the next start of the model." : "Saved here. The model server is not running, so this is used from its next start.")}</span>}
                </span>
            </Row>
        </Section>
        {tr(problem ? <span className="small inline-error" role="alert">{problem}</span> : null)}
    </span>;
}
