import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { api } from '../lib/client';
import { selectRemoteModel } from '../lib/store';
import { nativeAction } from '../lib/native';
import { Icon } from './ui';

/**
 * The model picker's by-name field (Settings switch `modelByName`, default off). Whatever the person
 * types about a model ("ask deepseek", "the local one", "DeepSeek: V3.2") is resolved on the host
 * (server/agent/model-routes.mjs): an exact fit becomes the chat's model choice, which the chat's
 * next message applies to its Harness session through `session.selectModel`; anything that fits
 * several models comes back as buttons, and nothing fits stays a plain sentence. Nothing is
 * switched until a choice is picked or the exact answer lands.
 */
interface Choice { connectionId?: string; modelId?: string; instanceId?: string }

interface NameResult {
    status: 'exact' | 'confirm' | 'ambiguous' | 'none' | 'inherit';
    message?: string;
    choice?: Choice;
    options?: { name: string; id: string; connection: string; local: boolean; choice?: Choice }[];
}

async function applyChoice(choice: Choice, onPicked: () => void) {
    if (choice.connectionId && choice.modelId) {
        selectRemoteModel({ connectionId: choice.connectionId, modelId: choice.modelId });
        onPicked();
        return;
    }
    if (choice.instanceId) {
        await nativeAction(`instances/${choice.instanceId}/default`);
        selectRemoteModel(null);
        onPicked();
    }
}

export function ModelByNameField({ onPicked }: { onPicked: () => void }) {
    const [enabled, setEnabled] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [answer, setAnswer] = useState<NameResult | null>(null);
    const [problem, setProblem] = useState('');
    useEffect(() => {
        let alive = true;
        fetch('/api/features').then(r => r.json()).then(d => { if (alive) setEnabled(d.modelByName === true); }).catch(() => { /* the field stays hidden when the switch state cannot be read */ });
        return () => { alive = false; };
    }, []);
    if (!enabled) return null;
    async function ask(text: string) {
        setBusy(true); setProblem(''); setAnswer(null);
        try {
            const found = await api.post<NameResult>('/api/agent/model-by-name', { name: text });
            if (found.status === 'exact' && found.choice) await applyChoice(found.choice, onPicked);
            else setAnswer(found);
        } catch (e) {
            setProblem(e instanceof Error ? e.message : String(e));
        } finally { setBusy(false); }
    }
    return <div className="model-byname" role="search">
        <input className="st-input" aria-label={tr("Use a model by name")} placeholder={tr("Use a model by name…")} value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) void ask(name.trim()); }} />
        <button className="menu__item model-picker-manage" role="menuitem" disabled={busy || !name.trim()} onClick={() => void ask(name.trim())}>{tr(busy ? 'Working…' : 'Use')}</button>
        {tr(answer ? <div className="model-byname__answer">
            <p className="small muted">{answer.message}</p>
            {tr((answer.options ?? []).map(o => <button key={`${o.connection}-${o.id}`} className="menu__item" role="menuitem" disabled={!o.choice || busy}
                onClick={() => o.choice && void applyChoice(o.choice, onPicked)}><Icon name={o.local ? 'models' : 'link'} /><span><strong>{o.name}</strong><small>{o.connection}</small></span></button>))}
        </div> : null)}
        {tr(problem ? <p className="small inline-error" role="alert">{problem}</p> : null)}
    </div>;
}
