/**
 * The Drafting choice the Models screen offers for a model. It exists only where there is something to choose: DFlash2 is for Qwen3.8-Flash-Next
 * only (the qwen, gyro and unsloth families: Qwen3.8-Flash-Next, its Gyro build and Unsloth's quantizations of the same weights), and only while this computer's engine can run it: strata_control/drafting.py hardware_support (Control reports it as
 * `capabilities.dflash2`; Metal and Intel engines and PCs without a supported card have none). Every other model has no dropdown at all: DeepSeek has no
 * MTP (its own DSpark drafter is chosen by the engine), and the other families have the MTP and nothing to pick against it (Settings > Draft layer turns it off).
 */
export const DRAFTING_FAMILIES = ['qwen', 'gyro', 'unsloth'];

/** The drafter a choice means for a family (one per run; strata_control/drafting.py choice_of): Auto is the MTP for the qwen family (the measured verdict of 2026-11-06: faster on both workloads) and DFlash2 for gyro or unsloth where the engine has it (`served`), else the MTP. */
export function resolveDrafter(choice: string | null | undefined, family: string | null | undefined, served: boolean | null | undefined, split?: boolean | null): 'dflash2' | 'mtp' | 'off' {
  const c = String(choice ?? 'auto').toLowerCase();
  if (c === 'off' || c === 'mtp') return c;
  if (!(served === true && DRAFTING_FAMILIES.includes(String(family)))) return 'mtp';
  if (c !== 'dflash2') {
    if (String(family).toLowerCase() === 'qwen') return 'mtp';
    // `split`: Control's plan says the all-cards split engine takes this start; it runs the MTP, so Auto is the MTP there (a DFlash2 the person chose stays)
    if (split === true) return 'mtp';
  }
  return 'dflash2';
}

/** What was measured on this kind of card (Control's words): tested = faster on some text and slower on others, slower = slower on every prompt. */
export interface Dflash2Support { level: 'tested' | 'slower' | 'untested'; line: string }

/** The choices for a model, or null when there is nothing to choose (no dropdown). */
export function draftingChoices(family: string | null | undefined, dflash2Served: boolean | null | undefined): string[] | null {
  return DRAFTING_FAMILIES.includes(String(family)) && dflash2Served === true ? ['auto', 'mtp', 'dflash2', 'off'] : null;
}

/** The Drafting select as the screen draws it, including the greyed state (the owner's rule of 2026-11-05: an
 * option that does not apply stays VISIBLE and disabled with its reason - never hidden, never forced).
 *  - a family with one drafter: the select is greyed with the reason (the MTP runs; Settings turns it off);
 *  - a Qwen3.8 family on an engine without DFlash2: three live choices, Auto is the MTP, and the reason says why;
 *  - the full choice: auto / mtp / dflash2 / off. */
export interface DraftingBox { values: string[]; disabled: boolean; reason: string }

export function draftingChoiceBox(family: string | null | undefined, dflash2Served: boolean | null | undefined): DraftingBox {
  if (!DRAFTING_FAMILIES.includes(String(family)))
    return {values: ['auto', 'off'], disabled: true,
            reason: 'This model runs its one drafter by itself: DeepSeek picks its own, the other families run the MTP (Settings > Draft layer turns it off).'};
  if (dflash2Served !== true)
    return {values: ['auto', 'mtp', 'off'], disabled: false,
            reason: 'DFlash2 does not run on this engine, so Auto is the MTP.'};
  return {values: ['auto', 'mtp', 'dflash2', 'off'], disabled: false, reason: ''};
}
