/**
 * Tool-server presets the Settings > Tools editor offers as one-click fills: the browser
 * (Playwright), the desktop (ScreenHand's native control on macOS/Windows) and phones
 * (mobile-mcp). The commands are the universal npx forms - a person who installed a global
 * copy can shorten them, and every field stays editable after the fill. The label and the
 * about line go through tr() (catalog entries, nine languages); the product names stay.
 */
export interface McpPreset { id: string; name: string; label: string; about: string; server: { command?: string; args?: string[]; url?: string } }

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'playwright', name: 'playwright', label: 'Playwright (browser)',
    about: 'Drive the person\'s own Chrome or Edge: navigate, click, fill forms, read pages and take screenshots.',
    server: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  },
  {
    id: 'screenhand', name: 'screenhand', label: 'ScreenHand (desktop)',
    about: 'Native desktop control on macOS and Windows: click, type, read the screen, drive any app.',
    server: { command: 'npx', args: ['-y', 'screenhand'] },
  },
  {
    id: 'mobile-mcp', name: 'mobile-mcp', label: 'mobile-mcp (phone)',
    about: 'Drive a real Android or iOS device: tap, type, install apps, read the screen over adb or a simulator.',
    server: { command: 'npx', args: ['-y', 'mobile-mcp'] },
  },
];
