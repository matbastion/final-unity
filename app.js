'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id); };
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
const params = new URLSearchParams(location.search);

const DOSBOX_CONF = `[sdl]
autolock=false
output=surface

[dosbox]
machine=svga_s3
memsize=16

[render]
frameskip=0
aspect=false

[cpu]
core=auto
cputype=auto
cycles=20000

[mixer]
nosound=false
rate=44100
blocksize=1024
prebuffer=20

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
oplmode=auto

[dos]
xms=true
ems=true
umb=true

[autoexec]
@echo off
mount c c
imgmount d STFU.ISO -t iso
c:
cd \\STTNG
cls
STTNG
`;

let toastTimer;
function toast(t) { const el = $('toast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.opacity = 0, 1800); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

async function hasData() {
  try {
    const root = await navigator.storage.getDirectory();
    const g = await root.getDirectoryHandle('stfu');
    await g.getFileHandle('ready');
    return true;
  } catch (_) { return false; }
}

// ---------- setup / import ----------
function showSetup(cancelable) {
  show('setup');
  $('menuBtn').style.display = 'none';
  const hint = $('installHint');
  if (!standalone && !params.has('browser')) {
    hint.innerHTML = 'Wichtig: Öffne diese Seite in Safari, tippe auf <b>Teilen → „Zum Home-Bildschirm“</b> und starte das Spiel dann über das neue Symbol. Erst dort die Spieldatei auswählen – sonst landet sie nur im Browser.';
  } else hint.textContent = cancelable ? '' : '';
}

$('pick').addEventListener('change', () => {
  const file = $('pick').files[0];
  if (!file) return;
  const bar = $('bar'), msg = $('setupMsg');
  bar.style.display = 'block'; msg.className = 'msg'; msg.textContent = 'Kopiere Spieldaten …';
  const w = new Worker('import-worker.js');
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      bar.firstElementChild.style.width = (100 * m.done / m.total).toFixed(1) + '%';
      msg.textContent = `Kopiere Spieldaten … ${Math.round(m.done / 1048576)} von ${Math.round(m.total / 1048576)} MB`;
    } else if (m.type === 'done') {
      w.terminate(); msg.textContent = 'Fertig!';
      if (navigator.storage.persist) navigator.storage.persist().catch(() => {});
      setTimeout(startGame, 400);
    } else if (m.type === 'error') {
      w.terminate(); bar.style.display = 'none'; msg.className = 'msg err'; msg.textContent = m.message;
    }
  };
  w.postMessage({file});
  $('pick').value = '';
});

// ---------- game ----------
let ci = null, gameVisible = false;
const canvas = $('screen'), ctx = canvas.getContext('2d', {alpha: false});
let img = null, fw = 640, fh = 480;

function layout() {
  const vw = innerWidth, vh = innerHeight, ar = 4 / 3;
  let w = vw, h = vw / ar;
  if (h > vh) { h = vh; w = vh * ar; }
  Object.assign(canvas.style, {width: w + 'px', height: h + 'px', left: (vw - w) / 2 + 'px', top: (vh - h) / 2 + 'px'});
}
addEventListener('resize', layout);
layout();

async function startGame() {
  show('load');
  $('loadMsg').textContent = 'wird geladen …';
  try {
    emulators.pathPrefix = new URL('./', location.href).href;
    ci = await emulators.dosboxWorker({dosboxConf: DOSBOX_CONF, jsdosConf: {version: emulators.version}}, {audioWorklet: true});
  } catch (e) {
    $('loadMsg').textContent = 'Start fehlgeschlagen: ' + (e.message || e);
    return;
  }
  const ev = ci.events();
  ev.onFrameSize((w, h) => {
    fw = w; fh = h; canvas.width = w; canvas.height = h; img = ctx.createImageData(w, h);
    if (!gameVisible && w === 640 && h === 480) {      // the game switched to SVGA: DOS phase is over
      gameVisible = true; show('game'); $('menuBtn').style.display = 'block';
    }
  });
  ev.onFrame((rgb, rgba) => {
    if (!gameVisible) return;
    if (!img || img.width !== fw) img = ctx.createImageData(fw, fh);
    const d = img.data;
    if (rgba) d.set(rgba.length === d.length ? rgba : rgba.subarray(0, d.length));
    else if (rgb) { for (let i = 0, j = 0; i < rgb.length && j < d.length; i += 3, j += 4) { d[j] = rgb[i]; d[j + 1] = rgb[i + 1]; d[j + 2] = rgb[i + 2]; d[j + 3] = 255; } }
    ctx.putImageData(img, 0, 0);
  });
  ev.onExit(() => { ci = null; gameVisible = false; $('menuBtn').style.display = 'none'; closeMenu(); show('ended'); });
}
$('restart').addEventListener('click', () => location.reload());

document.addEventListener('visibilitychange', () => {
  if (!ci) return;
  if (document.hidden) ci.pause(); else ci.resume();
});

// ---------- touch → mouse ----------
const LEFT = 0, RIGHT = 1;
let rightNext = false;
function norm(t) {
  const r = canvas.getBoundingClientRect();
  return {x: Math.min(1, Math.max(0, (t.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (t.clientY - r.top) / r.height))};
}
function move(p) { if (ci) ci.sendMouseMotion(p.x, p.y); }
function click(p, button) {
  if (!ci) return;
  move(p);
  setTimeout(() => ci && ci.sendMouseButton(button, true), 40);
  setTimeout(() => ci && ci.sendMouseButton(button, false), 110);
}

let touch = null;   // {id, start, last, timer, dragging, long}
const gameEl = $('game');
gameEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  closeMenu();
  if (e.touches.length === 2 && touch && !touch.dragging) {          // two-finger tap = right click
    clearTimeout(touch.timer); const p = touch.start; touch = null; click(p, RIGHT); return;
  }
  if (e.touches.length > 1) return;
  const t = e.changedTouches[0], p = norm(t);
  move(p);
  touch = {id: t.identifier, start: p, last: p, dragging: false, long: false, x0: t.clientX, y0: t.clientY};
  touch.timer = setTimeout(() => {                                      // long press = right click
    if (touch && !touch.dragging) { touch.long = true; click(touch.last, RIGHT); if (navigator.vibrate) navigator.vibrate(10); }
  }, 450);
}, {passive: false});

gameEl.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!touch) return;
  const t = [...e.changedTouches].find(x => x.identifier === touch.id); if (!t) return;
  const p = norm(t); touch.last = p; move(p);
  if (!touch.dragging && !touch.long && Math.hypot(t.clientX - touch.x0, t.clientY - touch.y0) > 14) {
    touch.dragging = true; clearTimeout(touch.timer);
    if (ci) ci.sendMouseButton(LEFT, true);                               // drag with button held
  }
}, {passive: false});

function endTouch(e) {
  e.preventDefault();
  if (!touch) return;
  const t = [...e.changedTouches].find(x => x.identifier === touch.id); if (!t) return;
  clearTimeout(touch.timer);
  const p = norm(t);
  if (touch.dragging) { move(p); if (ci) ci.sendMouseButton(LEFT, false); }
  else if (!touch.long) {
    const b = rightNext ? RIGHT : LEFT;
    if (rightNext) { rightNext = false; $('rmode').classList.remove('on'); }
    click(p, b);
  }
  touch = null;
}
gameEl.addEventListener('touchend', endTouch, {passive: false});
gameEl.addEventListener('touchcancel', endTouch, {passive: false});

// mouse (for testing on a computer / trackpad on iPad)
gameEl.addEventListener('mousemove', (e) => move(norm(e)));
gameEl.addEventListener('mousedown', (e) => { move(norm(e)); ci && ci.sendMouseButton(e.button === 2 ? RIGHT : LEFT, true); });
gameEl.addEventListener('mouseup', (e) => { ci && ci.sendMouseButton(e.button === 2 ? RIGHT : LEFT, false); });
gameEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- keyboard ----------
const CODE = {Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
  Space: 32, Minus: 45, Period: 46, Comma: 44, Slash: 47, ShiftLeft: 340, ShiftRight: 344, ControlLeft: 341, AltLeft: 342};
for (let i = 0; i < 26; i++) CODE['Key' + String.fromCharCode(65 + i)] = 65 + i;
for (let i = 0; i < 10; i++) CODE['Digit' + i] = 48 + i;
for (let i = 1; i <= 12; i++) CODE['F' + i] = 289 + i;
function charCode(ch) {
  const c = ch.toUpperCase();
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0);
  if (c >= '0' && c <= '9') return c.charCodeAt(0);
  return {' ': 32, '.': 46, '-': 45, ',': 44, '/': 47}[c];
}
function tap(code) { if (!ci || code === undefined) return; ci.sendKeyEvent(code, true); setTimeout(() => ci && ci.sendKeyEvent(code, false), 60); }

// hardware keyboard
addEventListener('keydown', (e) => { if (e.target === $('kbd') || !ci) return; const c = CODE[e.code]; if (c !== undefined) { e.preventDefault(); ci.sendKeyEvent(c, true); } });
addEventListener('keyup', (e) => { if (e.target === $('kbd') || !ci) return; const c = CODE[e.code]; if (c !== undefined) { e.preventDefault(); ci.sendKeyEvent(c, false); } });

// on-screen keyboard via hidden input
const kbd = $('kbd');
kbd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); tap(257); kbd.blur(); }
  else if (e.key === 'Backspace') { e.preventDefault(); tap(259); }
  else if (e.key === 'Escape') { e.preventDefault(); tap(256); kbd.blur(); }
});
kbd.addEventListener('input', () => { for (const ch of kbd.value) tap(charCode(ch)); kbd.value = ''; });

// ---------- menu ----------
function closeMenu() { $('menu').classList.remove('on'); }
$('menuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('menu').classList.toggle('on'); });
for (const b of document.querySelectorAll('#menu [data-key]')) b.addEventListener('click', () => { tap(+b.dataset.key); closeMenu(); });
$('kbdBtn').addEventListener('click', () => { closeMenu(); kbd.focus(); });
$('rmode').addEventListener('click', () => { rightNext = !rightNext; $('rmode').classList.toggle('on', rightNext); closeMenu(); if (rightNext) toast('Nächster Tipp ist ein Rechtsklick'); });
let muted = false;
$('mute').addEventListener('click', () => { if (!ci) return; muted = !muted; muted ? ci.mute() : ci.unmute(); $('mute').textContent = muted ? 'Ton an' : 'Ton aus'; closeMenu(); });
let reimportArmed = false;
$('reimport').addEventListener('click', () => {
  if (!reimportArmed) { reimportArmed = true; $('reimport').textContent = 'Sicher? Spielstände gehen verloren'; return; }
  closeMenu(); if (ci) ci.exit().catch(() => {}); ci = null; gameVisible = false; showSetup(true);
});

// ---------- boot ----------
(async () => {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    show('setup'); $('setupMsg').className = 'msg err'; $('setupMsg').textContent = 'Dieses Gerät unterstützt den nötigen Speicher nicht (iPadOS 17 oder neuer nötig).'; return;
  }
  if (await hasData()) startGame(); else showSetup(false);
})();
