/**
 * One display mapping for an installed model row, shared by the Models page's own-models
 * block, Storage and the delete dialog (F5): the main line is the person's own model_name
 * (a hand-written run config carries its real name there), never the raw id shouted in
 * caps; the sub line is the facts (kv, context, disk) one dash apart.
 */
import {nativeShortName} from './native-names';
import {tr} from './i18n';

export interface InstalledEntry { model: string; model_name?: string; ready?: boolean; context?: number; kv?: string; diskGb?: number }

export function modelDisplay(entry: InstalledEntry): { main: string; sub: string } {
  const main = (entry.model_name ?? '').trim() || nativeShortName(entry.model);
  const bits: string[] = [];
  if (entry.kv) bits.push(`KV ${entry.kv}`);
  if (Number.isFinite(entry.context) && (entry.context ?? 0) > 0) bits.push(tr("{0}K ctx", [String(Math.round((entry.context ?? 0) / 1024))]));
  if (Number.isFinite(entry.diskGb ?? NaN) && (entry.diskGb ?? 0) > 0) bits.push(`${Number(entry.diskGb).toFixed(1)} GB`);
  return {main, sub: bits.join(' · ')};
}
