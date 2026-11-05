import type { ShellApi } from '../../shared/ipc';
import { startDrawer } from './drawer';
import { startShell } from './shell';

declare global { interface Window { player: ShellApi } }

if (new URLSearchParams(location.search).get('view') === 'drawer') startDrawer();
else startShell();
