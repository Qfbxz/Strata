/** The engine's own update watcher (the person's ask, 2026-11-06): the engine updates apart
 * from the app, so it is checked apart from it too - once shortly after the host starts and
 * then daily. The last engine view is cached for the settings page; a failed check keeps the
 * last good view and notes the error. Nothing here throws or blocks. */

export function hasEngineUpdate(engineView) {
    const status = engineView?.status;
    return status === 'available' || status === 'install';
}

export function createEngineUpdateWatcher({ check, intervalMs = 24 * 3600 * 1000, initialDelayMs = 60_000 } = {}) {
    let last = { checkedAt: null, engine: null, error: null };
    let running = null;
    let timer = null;
    async function run() {
        try {
            const report = await check();
            last = { checkedAt: new Date().toISOString(), engine: report?.engine ?? null, error: null };
        } catch (error) {
            last = { ...last, error: String(error?.message ?? error) };
        }
        return state();
    }
    function state() { return { ...last, hasUpdate: hasEngineUpdate(last.engine) }; }
    if (initialDelayMs >= 0 && check) {
        timer = setTimeout(() => { void run(); schedule(); }, initialDelayMs);
        timer.unref?.();
    }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(() => { void run(); schedule(); }, intervalMs);
        timer.unref?.();
    }
    return {
        state,
        /** The first check, awaited (tests and a curious caller); later ones ride the timer. */
        firstCheck: async () => { running ??= run(); return running; },
        /** Check now, whatever the timer says. */
        poke: async () => { running = run(); return running; },
        stop() { clearTimeout(timer); },
    };
}
