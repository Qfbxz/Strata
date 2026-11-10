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
    { key: 'promptRewrite', label: "Rewrite vague messages with the small model before the main one" },
    { key: 'branchChip', label: "Branch chip in the composer" },
    { key: 'checkpoints', label: "Restore-point picker in the composer" },
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

export function FeatureFlagsSetting() {
    const [features, setFeatures] = useState<Features | null>(null);
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
    const [guard, setGuard] = useState<{ identicalCalls: number; compactFailures: number } | null>(null);
  useEffect(() => { fetch('/api/agent-guard').then(r => r.json()).then(d => setGuard(d)).catch(() => {}); }, []);
  function saveGuard(key: 'identicalCalls' | 'compactFailures', value: number) {
    if (!guard) return;
    const next = { ...guard, [key]: value };
    setGuard(next);
    fetch('/api/agent-guard', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: value }) }).catch(() => {});
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
  return <span className="row feature-flags">
        <span className="feature-flags__grid">
            {tr(SWITCHES.map(s => <label key={s.key} className="feature-flags__row">
                <button className="st-toggle" role="switch" aria-checked={features ? !!features[s.key] : false} aria-label={tr(s.label)} disabled={!features} onClick={() => toggle(s.key)}/>
                <span>{tr(s.label)}</span>
            </label>))}
        </span>
        <span className="feature-flags__grid">
          <label className="feature-flags__row">
            <span><strong>{tr("Stop a stuck assistant")}</strong><small className="muted">{tr("Stop after this many identical tool calls in a row. 0 = never stop.")}</small></span>
            <input className="st-input" style={{ width: 64 }} inputMode="numeric" aria-label={tr("Stop a stuck assistant")} value={guard?.identicalCalls ?? ''} disabled={!guard} onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isInteger(n) && n >= 0) saveGuard('identicalCalls', n); }} />
          </label>
          <label className="feature-flags__row">
            <span><strong>{tr("Stop retrying automatic summarizing")}</strong><small className="muted">{tr("Stop retrying automatic summarizing after this many failures. 0 = keep trying.")}</small></span>
            <input className="st-input" style={{ width: 64 }} inputMode="numeric" aria-label={tr("Stop retrying automatic summarizing")} value={guard?.compactFailures ?? ''} disabled={!guard} onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isInteger(n) && n >= 0) saveGuard('compactFailures', n); }} />
          </label>
        </span>
        <span className="feature-flags__grid">
          <label className="feature-flags__row">
            <span><strong>{tr("Small model sidecar")}</strong><small className="muted">{tr("A second, small model answers session titles and summaries on \"model\": \"small\", and describes pictures for a main model with no vision. Off = everything goes to the main model as before. Used from the next start of the model.")}</small></span>
            <button className="st-toggle" role="switch" aria-checked={!!small?.enabled} aria-label={tr("Small model sidecar")} disabled={!small} onClick={() => saveSmall({ enabled: !small?.enabled })} />
          </label>
          <label className="feature-flags__row">
            <span><strong>{tr("Stop the small model after (seconds)")}</strong><small className="muted">{tr("Stop the small model's process after this many seconds without requests. 0 = keep it running.")}</small></span>
            <input className="st-input" style={{ width: 64 }} inputMode="numeric" aria-label={tr("Stop the small model after (seconds)")} value={small?.idleUnloadS ?? ''} disabled={!small} onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n) && n >= 0) saveSmall({ idleUnloadS: n }); }} />
          </label>
          <label className="feature-flags__row">
            <span><strong>{tr("Small model files")}</strong><small className="muted">{tr("The llama-server binary and the small model's GGUF (a multimodal Qwen2.5-VL works best) with its picture projector.")}</small></span>
            <span className="small" style={{ display: 'grid', gap: 4 }}>
              <input className="st-input" style={{ width: 320 }} aria-label={tr("llama-server binary")} placeholder="llama-server" value={small?.exe ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, exe: e.target.value } : s)} onBlur={() => saveSmall({})} />
              <input className="st-input" style={{ width: 320 }} aria-label={tr("small model GGUF")} placeholder="Qwen2.5-VL-3B Q8_0.gguf" value={small?.model ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, model: e.target.value } : s)} onBlur={() => saveSmall({})} />
              <input className="st-input" style={{ width: 320 }} aria-label={tr("picture projector GGUF")} placeholder="mmproj f16.gguf" value={small?.mmproj ?? ''} disabled={!small} onChange={e => setSmall(s => s ? { ...s, mmproj: e.target.value } : s)} onBlur={() => saveSmall({})} />
            </span>
          </label>
        </span>
        {tr(problem ? <span className="small inline-error" role="alert">{problem}</span> : null)}
    </span>;
}
