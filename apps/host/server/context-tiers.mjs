/** The context tiers this Mac serves (the adjudicated ladder, 2026-11-06): A native 256K,
 * B zero-distortion 512K, C anchored-YaRN 1M (IQ4_XS certified, usable budget 1,006,000 after
 * the system/template/completion reserve). `advice` is what a chat is told BEFORE a send that
 * will not fit the loaded model: loud, in the person's words, with the tier to switch to -
 * never a silent mid-drop (the reactive auto-compact stays as the safety net, not the story). */

const RESERVE_TOKENS = 4000;

export const TIERS = [
    { tier: 'A', maxContext: 262144, label: '256K native', note: 'no rope flags' },
    { tier: 'B', maxContext: 524288, label: '512K zero-distortion', note: 'no rope flags' },
    { tier: 'C', maxContext: 1010000, usable: 1010000 - RESERVE_TOKENS, label: '1M anchored YaRN', note: 'iq4_xs-v31-1m; Q6_K_XL must not' },
];

export function advice(neededTokens, currentMax) {
    const need = Math.max(0, Math.ceil(Number(neededTokens) || 0));
    const have = Math.max(0, Math.ceil(Number(currentMax) || 0));
    if (!need || !have) return { state: 'ok', message: '' };
    const over = need > have;
    const tier = TIERS.find(t => t.maxContext > need);   // the smallest tier that fits
    if (!over) {
        const tight = need > have * 0.9;
        return { state: tight ? 'tight' : 'ok', message: tight ? `This chat is at ${Math.round(need / have * 100)}% of the model's window; start a new chat or switch to a bigger tier soon.` : '' };
    }
    return {
        state: 'over',
        tier: tier?.tier ?? null,
        message: tier
            ? `This send needs about ${need.toLocaleString()} tokens but the loaded model holds ${have.toLocaleString()}. Switch to tier ${tier.tier} (${tier.label}${tier.tier === 'C' ? ' - the iq4_xs-v31-1m model' : ''}) and send again, or start a new chat. Sending now will compact the older messages instead of seeing them whole.`
            : `This send needs about ${need.toLocaleString()} tokens - beyond even the 1M tier. Start a new chat (or let the auto-compact fold the older messages).`,
    };
}

/** Rough token estimate for the chat's next send: the message plus what history carries.
 * One Chinese/English mixed word ≈ 1.6 tokens is the honest quick bound, not a tokenizer. */
export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length * 1.6);
}
