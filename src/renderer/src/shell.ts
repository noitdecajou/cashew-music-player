import { type ResumeState, type UiState, errorMessage } from '../../shared/ipc';
import { formatTime } from './format';
import { EMPTY_SNAPSHOT, type PlayerCommand, type PlayerSnapshot } from '../../shared/player';
import { ProgressBar } from './components/progress';
import { VolumeControl } from './components/volume';


export function startShell(): void {
const api = window.player;
const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
};
const $$ = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];
const setText = (element: Element, value: string): void => { if (element.textContent !== value) element.textContent = value; };
const send = (command: PlayerCommand): void => api.command(command);

// --- Commands -------------------------------------------------------------
let resume: ResumeState = { available: false, busy: false, error: '', title: '', artist: '', artwork: '', position: 0 };
const resumeOffered = (): boolean => resume.available && !snapshot.track;
for (const button of $$('[data-command]')) {
  button.addEventListener('click', () => {
    // Nothing loaded yet: Play resumes the last session at its position.
    if (button.dataset.command === 'toggle-play' && resumeOffered()) {
      void api.resume().catch(error => showNotice(errorMessage(error)));
      return;
    }
    send({ type: button.dataset.command as 'toggle-play' });
  });
}
for (const button of $$('[data-window]')) {
  button.addEventListener('click', () => api.window(button.dataset.window as 'pin'));
}

const mini = $('#mini');
const progress = new ProgressBar($('.progress', mini), $('.elapsed', mini), $('.total', mini), send);
const volume = new VolumeControl({
  host: $('.bottom', mini),
  button: $<HTMLButtonElement>('.volume-button', mini),
  mute: $<HTMLButtonElement>('.volume-mute', mini),
  track: $('.slider.volume', mini),
  value: $('.volume-value', mini),
}, send);

// --- Player state ---------------------------------------------------------
let snapshot: PlayerSnapshot = EMPTY_SNAPSHOT;
let notice = '';

function renderCover(img: HTMLImageElement, url: string): void {
  if (img.dataset.src === url) return;
  img.dataset.src = url;
  img.classList.remove('loaded');
  if (url) img.src = url; else img.removeAttribute('src');
}
for (const img of $$('img.cover') as HTMLImageElement[]) {
  img.addEventListener('load', () => img.classList.toggle('loaded', img.naturalWidth > 0));
  img.addEventListener('error', () => img.classList.remove('loaded'));
}

function renderSnapshot(next: PlayerSnapshot): void {
  const previousId = snapshot.track?.id ?? '';
  snapshot = next;
  const track = next.track;
  if ((track?.id ?? '') !== previousId) progress.reset(track?.id ?? '');

  const offered = resumeOffered();
  const title = track?.title || (track ? 'Chargement du morceau…' : offered ? resume.title || 'Dernière écoute' : next.signedIn === false ? 'Non connecté' : 'Aucun morceau en lecture');
  const artist = track ? track.artist : offered ? resume.artist : next.signedIn === false ? 'Connecte-toi dans le grand lecteur' : 'Lance une playlist dans le grand lecteur';
  for (const root of [mini, $('#toolbar')]) {
    setText($('.title', root), title);
    setText($('.artist', root), artist);
    $('.title', root).title = track?.title ?? '';
    $('.artist', root).title = track?.artist ?? '';
    renderCover($<HTMLImageElement>('img.cover', root), track?.artwork ?? (offered ? resume.artwork : ''));
  }

  const playing = next.status === 'playing' || next.status === 'buffering';
  const play = $('.play', mini);
  $('use', play).setAttribute('href', playing ? '#i-pause' : '#i-play');
  play.setAttribute('aria-label', offered ? 'Reprendre la dernière écoute' : playing ? 'Mettre en pause' : 'Lire');
  play.title = offered ? (resume.busy ? 'Reprise en cours…' : 'Reprendre là où tu t’étais arrêté') : playing ? 'Pause' : 'Lecture';
  (play as HTMLButtonElement).disabled = offered && resume.busy;

  const shuffle = $('.shuffle', mini);
  if (next.shuffle === null) shuffle.removeAttribute('aria-pressed'); else shuffle.setAttribute('aria-pressed', String(next.shuffle));
  shuffle.title = next.shuffle ? 'Aléatoire activé' : 'Aléatoire désactivé';

  setText($('.upnext .label', mini), offered ? 'REPRISE' : 'À SUIVRE');
  setText($('.next-title', mini), offered ? (resume.busy ? 'Préparation…' : resume.error || `Reprendre à ${formatTime(resume.position)}`) : next.next?.title ?? (track ? 'Rien à suivre' : ''));
  setText($('.next-artist', mini), offered ? '' : next.next?.artist ?? '');
  $('.upnext', mini).title = next.next ? `À suivre : ${next.next.title} — ${next.next.artist}` : 'Afficher la file';

  volume.update(next);
  renderNotice();
}

function showNotice(value: string): void {
  notice = value;
  renderNotice();
  window.setTimeout(() => { if (notice === value) { notice = ''; renderNotice(); } }, 6000);
}
let online = true;
function renderNotice(): void {
  const text = notice || (!online ? 'Hors ligne — la lecture reprendra au retour du réseau.' : snapshot.signedIn === false ? 'Connecte-toi à YouTube Music pour retrouver tes playlists.' : '');
  setText($('#toolbar .notice'), text);
}

api.on('player:snapshot', renderSnapshot);
api.on('player:progress', value => progress.update(value));
api.on('ui:notice', showNotice);
api.on('resume:state', value => { resume = value; renderSnapshot(snapshot); });
const reportNetwork = (): void => api.network(navigator.onLine);
window.addEventListener('online', reportNetwork);
window.addEventListener('offline', reportNetwork);
reportNetwork();

// --- Window state ---------------------------------------------------------

function renderUi(state: UiState): void {
  const body = document.body;
  body.classList.remove('booting');
  body.classList.toggle('mini', state.mini);
  body.classList.toggle('large', !state.mini);
  body.classList.toggle('seamless', state.mini && state.seamless);
  body.classList.toggle('panel-open', state.panel !== 'none');
  body.dataset.theme = state.theme;
  body.classList.toggle('skin', state.theme !== 'modern');
  body.classList.toggle('offline', !state.online);
  if (online !== state.online) { online = state.online; renderNotice(); }
  for (const pin of $$('.pin')) {
    pin.setAttribute('aria-pressed', String(state.pinned));
    pin.title = state.pinned ? 'Désépingler' : 'Épingler au premier plan';
  }
  for (const toggle of $$('.titlebar-toggle')) {
    toggle.setAttribute('aria-pressed', String(state.seamless));
    toggle.title = `${state.seamless ? 'Afficher' : 'Masquer'} la barre de fenêtre (Ctrl+Maj+B)`;
  }
  const maximize = $('[data-window="maximize"]');
  maximize.title = state.maximized ? 'Restaurer' : 'Agrandir';
  panelOpen = state.panel !== 'none';
  volume.hide();
}
let panelOpen = false;
api.on('ui:state', renderUi);

// --- Keyboard -------------------------------------------------------------
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, [role="slider"]')) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 'k') { event.preventDefault(); api.window('toggle-search'); }
  else if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'b') { event.preventDefault(); api.window('toggle-title-bar'); }
  else if (event.key === 'Escape' && panelOpen) api.window('close-panel');
  else if (event.key === ' ' && !target?.matches('button')) { event.preventDefault(); send({ type: 'toggle-play' }); }
});

// --- Moving the mini player without a title bar ---------------------------
let dragging = false;
let frame = 0;
for (const zone of [...$$('.drag-zone'), $('.grip', mini)]) {
  zone.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !document.body.classList.contains('mini')) return;
    zone.setPointerCapture(event.pointerId);
    dragging = true;
    document.body.classList.add('moving');
    api.drag('start');
  });
  zone.addEventListener('pointermove', () => {
    if (!dragging || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (dragging) api.drag('move'); });
  });
  const end = (phase: 'end' | 'cancel') => () => {
    if (!dragging) return;
    dragging = false;
    cancelAnimationFrame(frame); frame = 0;
    document.body.classList.remove('moving');
    api.drag(phase);
  };
  zone.addEventListener('pointerup', end('end'));
  zone.addEventListener('pointercancel', end('cancel'));
  zone.addEventListener('lostpointercapture', end('end'));
}
$('.grip', mini).addEventListener('keydown', event => {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
  const move = moves[event.key];
  if (move) { event.preventDefault(); api.nudge(...move); }
});
window.addEventListener('blur', () => { if (dragging) { dragging = false; document.body.classList.remove('moving'); api.drag('cancel'); } });
}
