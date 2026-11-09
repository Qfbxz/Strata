import { localeTag } from '../lib/i18n';
import { tr } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';
import { nativeAction, useNative, type NativeJob } from '../lib/native';
import { Btn, Dialog, ErrorNotice, Select } from './ui';

export function NativeBenchmark({ open, onClose }: {
    open: boolean;
    onClose: () => void;
}) {
    const native = useNative();
    const [selected, setSelected] = useState(''), [error, setError] = useState(''), [jobId, setJobId] = useState(''), [report, setReport] = useState<Record<string, any> | null>(null);
    const instance = native?.instances.find(i => i.id === selected) ?? native?.instances.find(i => i.id === native.defaultId) ?? native?.instances[0];
    const job = native?.jobs.find(j => j.id === jobId), active = native?.jobs.some(j => j.state === 'running');
    useEffect(() => {
        if (open)
            void api.get<Record<string, any> | null>('/api/native/benchmark').then(setReport).catch(() => { });
    }, [open]);
    useEffect(() => {
        if (job?.state === 'done' && job.result)
            setReport(job.result);
        if (job?.state === 'error')
            setError(job.error ?? job.summary);
    }, [job?.state]);
    async function run() {
        setError('');
        try {
            const job = await nativeAction<NativeJob>('operations', { kind: 'benchmark', args: { instanceId: instance?.id } });
            setJobId(job.id);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }
    function download() {
        if (!report)
            return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'strata-benchmark.json';
        a.click();
        URL.revokeObjectURL(url);
    }
    return <Dialog open={open} title={tr("Measure performance")} onClose={onClose} actions={<><Btn onClick={onClose}>{tr("Close")}</Btn>{tr(job?.state === 'running' ? <Btn onClick={() => void nativeAction(`operations/${job.id}/cancel`).catch(e => setError(e.message))}>{tr("Stop benchmark")}</Btn> : null)}{tr(report ? <Btn icon="download" onClick={download}>{tr("Save report")}</Btn> : null)}<Btn variant="primary" disabled={!instance || instance.status !== 'ready' || active} onClick={() => void run()}>{tr(active ? 'Measuring…' : 'Run short benchmark')}</Btn></>}><div className="stack"><p className="small muted">{tr("A fixed prompt with thinking off and up to 200 output tokens. Usually takes 10\u201360 seconds. Results are measured by your engine.")}</p>{tr((native?.instances.length ?? 0) > 1 ? <Select ariaLabel={tr("Benchmark model")} value={instance?.id ?? ''} options={(native?.instances ?? []).map(i => ({ value: i.id, label: i.label }))} onChange={setSelected}/> : null)}{tr(!instance ? <p>{tr("Load a native model first.")}</p> : null)}{tr(job?.state === 'running' ? <p role="status">{tr(job.summary)}</p> : null)}{tr(report ? <div className="native-benchmark"><div><span>{tr("Generating")}</span><strong>{tr(report.outputTps == null ? '—' : Number(report.outputTps).toFixed(1))} <small>{tr("tok/s")}</small></strong></div><div><span>{tr("Reading")}</span><strong>{tr(report.promptTps == null ? '—' : Number(report.promptTps).toFixed(0))} <small>{tr("tok/s")}</small></strong></div><p className="xs muted">{tr(report.model)} · {tr(new Date(report.at).toLocaleString(localeTag()))} · {tr(report.settings)}</p></div> : null)}{tr(error ? <ErrorNotice message={error}/> : null)}</div></Dialog>;
}
