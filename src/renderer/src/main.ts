import type { ShellApi } from '../../shared/ipc';
import { installGlyphSymbols } from './brand';
import { startDrawer } from './drawer';
import { startShell } from './shell';

declare global { interface Window { player: ShellApi } }

const sprite = document.getElementById('sprite');
if (sprite) installGlyphSymbols(sprite);

if (new URLSearchParams(location.search).get('view') === 'drawer') startDrawer();
else startShell();
