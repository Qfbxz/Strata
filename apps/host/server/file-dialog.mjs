/**
 * The host's native "choose a file" dialog, one per platform:
 *   macOS    osascript (choose file)
 *   Windows  PowerShell OpenFileDialog (STA, topmost owner, GGUF filter)
 *   Linux    zenity --file-selection, then kdialog
 * Where no dialog works the caller gets { unavailable: true } and the app keeps the path field.
 */
import { spawn } from 'node:child_process';
import { exec } from './util.mjs';

const MAC_SCRIPT = prompt => `POSIX path of (choose file with prompt "${prompt.replace(/["\\]/g, '')}")`;

export function windowsFileScript(prompt) {
  const text = prompt.replace(/'/g, "''");
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = "CenterScreen"; $owner.Size = New-Object System.Drawing.Size(0, 0)',
    '$owner.Show(); $owner.Activate()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.Title = '${text}'`,
    '$dialog.Filter = \'GGUF models (*.gguf)|*.gguf|All files (*.*)|*.*\'',
    '[Console]::Out.WriteLine("READY"); [Console]::Out.Flush()',
    'if ($dialog.ShowDialog($owner) -eq "OK") { [Console]::Out.WriteLine($dialog.FileName) } else { [Console]::Out.WriteLine("CANCELLED") }',
  ].join('\n');
}

function runCollect(cmd, args, timeoutMs = 300_000) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(null); }, timeoutMs);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('exit', code => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) resolve({ path: text.split(/\r?\n/).filter(Boolean).at(-1) });
      else if (/CANCELLED/.test(text) || /User canceled|用户已取消/.test(err)) resolve({ cancelled: true });
      else resolve(null);
    });
  });
}

/** -> { path } | { cancelled: true } | null (no dialog available on this platform). */
export async function chooseFile(prompt = 'Choose a file') {
  if (process.platform === 'darwin') {
    const r = await runCollect('osascript', ['-e', MAC_SCRIPT(prompt)], 600_000);
    return r;
  }
  if (process.platform === 'win32') {
    const r = await runCollect('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command',
      windowsFileScript(prompt)], 600_000);
    return r;
  }
  for (const [cmd, args] of [
    ['zenity', ['--file-selection', `--title=${prompt}`]],
    ['kdialog', [`--title`, prompt, '--getopenfilename', '. *.gguf']],
  ]) {
    const r = await runCollect(cmd, args, 600_000);
    if (r) return r;
  }
  return null;
}
