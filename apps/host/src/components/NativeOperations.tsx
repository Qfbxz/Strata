import { tr } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';
import { useNative } from '../lib/native';
import { Btn, Dialog, ErrorNotice } from './ui';
import { NativeProgress } from './NativeModels';
import { jobErrorText } from '../lib/native-job-diagnostics';
import { SettingsEngine } from './SettingsEngine';
export function NativeOperations() {
    const native = useNative();
    const [error, setError] = useState(''), [saved, setSaved] = useState(''), [saving, setSaving] = useState(false);
    const [logs, setLogs] = useState<{
        at: string;
        instanceId: string;
        line: string;
    }[]>([]), [showLogs, setShowLogs] = useState(false);
    const active = native?.jobs.find(j => j.state === 'running');
    useEffect(() => {
        if (!showLogs)
            return;
        const read = () => void api.get<{
            logs: typeof logs;
        }>('/api/native/logs').then(value => { setLogs(value.logs); }).catch(() => { });
        read();
        const timer = setInterval(read, 2000);
        return () => clearInterval(timer);
    }, [showLogs]);
    // The window cannot save a download, so the host writes the file to Downloads and says where.
    async function saveLogs() {
        setSaving(true);
        setSaved('');
        setError('');
        try {
            const result = await api.post<{ path: string }>('/api/native/logs/save', {});
            setSaved(result.path);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setSaving(false);
        }
    }
    return <div className="stack stack--lg native-engine-settings">
 <SettingsEngine />
 <section className="st-card"><div className="section-toolbar"><h2 className="h3">{tr("Diagnostics")}</h2><Btn size="sm" onClick={() => setShowLogs(true)}>{tr("View logs")}</Btn></div><p className="small muted">{tr("Downloads, preparation and engine failures include their original messages here.")}</p>{tr(native?.jobs.filter(j => j.state === 'error').slice(-3).map(j => <ErrorNotice key={j.id} message={jobErrorText(j, native.jobs)} detail={j.details}/>))}</section>
 <Dialog open={showLogs} wide compact title={tr("Engine logs")} onClose={() => setShowLogs(false)} actions={<><Btn icon="download" disabled={saving} onClick={() => void saveLogs()}>{tr(saving ? 'Working…' : 'Save logs')}</Btn><Btn variant="primary" onClick={() => setShowLogs(false)}>{tr("Close")}</Btn></>}>
  <pre className="native-log" aria-label={tr("Engine log")}>{logs.length ? logs.map(l => `${l.at} · ${l.line}`).join(String.fromCharCode(10)) : tr('No engine messages yet.')}</pre>
  {tr(saved ? <p className="small" role="status">{tr("Saved to {0}", [saved])}</p> : null)}
 </Dialog>
 {tr(active ? <NativeProgress job={active}/> : null)}{tr(error ? <ErrorNotice message={error}/> : null)}
 </div>;
}
