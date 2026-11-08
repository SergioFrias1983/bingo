'use strict';

const VERSION = 'Versión 1 · 08/11/26';
const MAXIMO = 99;
const BLOQUEO_MS = 700;

/* ---------- Lógica del juego (sin pantalla, se puede probar sola) ---------- */

function sacarNumero(salidos, azar = Math.random) {
  const usados = new Set(salidos);
  const libres = [];
  for (let n = 1; n <= MAXIMO; n++) if (!usados.has(n)) libres.push(n);
  if (libres.length === 0) return null;
  return libres[Math.floor(azar() * libres.length)];
}

function ultimos(salidos, cantidad = 5) {
  return salidos.slice(-cantidad).reverse(); // el más nuevo primero
}

function validarCopia(datos) {
  if (!datos || datos.app !== 'bingo' || !Array.isArray(datos.salidos)) return null;
  const vistos = new Set();
  for (const n of datos.salidos) {
    if (!Number.isInteger(n) || n < 1 || n > MAXIMO || vistos.has(n)) return null;
    vistos.add(n);
  }
  return datos.salidos.slice();
}

if (typeof module !== 'undefined') module.exports = { sacarNumero, ultimos, validarCopia, MAXIMO };

/* ---------- Guardado en el dispositivo (IndexedDB) ---------- */

const db = {
  abrir() {
    return new Promise((ok, mal) => {
      const pedido = indexedDB.open('bingo', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('estado');
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => mal(pedido.error);
    });
  },
  async leer() {
    const base = await this.abrir();
    return new Promise((ok) => {
      const p = base.transaction('estado').objectStore('estado').get('salidos');
      p.onsuccess = () => ok(Array.isArray(p.result) ? p.result : []);
      p.onerror = () => ok([]);
    });
  },
  async guardar(salidos) {
    const base = await this.abrir();
    return new Promise((ok) => {
      const t = base.transaction('estado', 'readwrite');
      t.objectStore('estado').put(salidos, 'salidos');
      t.oncomplete = ok;
      t.onerror = ok;
    });
  }
};

/* ---------- Sonido (generado, funciona sin internet) ---------- */

let audio = null;
function sonar() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const ahora = audio.currentTime;
    [[880, 0], [1320, 0.12]].forEach(([frec, demora]) => {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = frec;
      vol.gain.setValueAtTime(0.0001, ahora + demora);
      vol.gain.exponentialRampToValueAtTime(0.5, ahora + demora + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, ahora + demora + 0.6);
      osc.connect(vol).connect(audio.destination);
      osc.start(ahora + demora);
      osc.stop(ahora + demora + 0.65);
    });
  } catch (e) { /* sin sonido disponible */ }
}

/* ---------- Pantalla ---------- */

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  let salidos = [];
  let bloqueadoHasta = 0;

  const bloquear = () => { bloqueadoHasta = Date.now() + BLOQUEO_MS; };
  const bloqueado = () => Date.now() < bloqueadoHasta;

  // Bloquea todos los botones un momento (para que un toque no active otra cosa)
  function bloquearBotones() {
    bloquear();
    document.querySelectorAll('button').forEach((b) => { b.dataset.pausa = '1'; });
    setTimeout(() => {
      document.querySelectorAll('button[data-pausa]').forEach((b) => delete b.dataset.pausa);
    }, BLOQUEO_MS);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') && bloqueado()) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  function mostrar(animar) {
    const lista = ultimos(salidos);
    const hist = $('historial');
    hist.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const li = document.createElement('li');
      if (lista[i] !== undefined) li.textContent = lista[i];
      else li.className = 'hueco';
      hist.appendChild(li);
    }
    const bola = $('bola');
    const actual = salidos[salidos.length - 1];
    bola.textContent = actual ?? '–';
    bola.classList.toggle('vacia', actual === undefined);
    if (animar) { bola.classList.remove('sale'); void bola.offsetWidth; bola.classList.add('sale'); }

    const fin = salidos.length >= MAXIMO;
    $('contador').textContent = fin
      ? '¡Salieron los 99 números!'
      : `Salieron ${salidos.length} de ${MAXIMO}`;
    $('btnSacar').disabled = fin;
  }

  function avisar(texto) {
    const a = $('aviso');
    a.textContent = texto;
    a.hidden = false;
    clearTimeout(avisar.t);
    avisar.t = setTimeout(() => { a.hidden = true; }, 2500);
  }

  async function sacar() {
    if (bloqueado() || algoAbierto()) return;
    const n = sacarNumero(salidos);
    if (n === null) return;
    salidos.push(n);
    sonar();
    mostrar(true);
    bloquear(); // evita sacar dos números con un doble toque
    await db.guardar(salidos);
  }

  const algoAbierto = () => !$('menu').hidden || !$('confirmar').hidden;
  function abrir(id) { $(id).hidden = false; bloquearBotones(); }
  function cerrar(id) { $(id).hidden = true; }

  function exportar() {
    const datos = { app: 'bingo', fecha: new Date().toISOString(), salidos };
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const hoy = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `bingo-${hoy}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    avisar('Copia exportada');
  }

  async function importar(archivo) {
    try {
      const lista = validarCopia(JSON.parse(await archivo.text()));
      if (!lista) throw new Error();
      salidos = lista;
      await db.guardar(salidos);
      mostrar(false);
      cerrar('menu');
      avisar('Copia importada');
    } catch {
      avisar('Ese archivo no es una copia válida del bingo');
    }
  }

  async function nuevoJuego() {
    salidos = [];
    await db.guardar(salidos);
    cerrar('confirmar');
    mostrar(false);
    avisar('Juego nuevo');
  }

  $('btnSacar').addEventListener('click', sacar);
  $('btnMenu').addEventListener('click', () => abrir('menu'));
  $('btnCerrarMenu').addEventListener('click', () => cerrar('menu'));
  $('btnExportar').addEventListener('click', exportar);
  $('btnImportar').addEventListener('click', () => $('archivo').click());
  $('archivo').addEventListener('change', (e) => {
    if (e.target.files[0]) importar(e.target.files[0]);
    e.target.value = '';
  });
  $('btnNuevo').addEventListener('click', () => { cerrar('menu'); abrir('confirmar'); });
  $('btnConfSi').addEventListener('click', nuevoJuego);
  $('btnConfNo').addEventListener('click', () => cerrar('confirmar'));
  ['menu', 'confirmar'].forEach((id) => {
    $(id).addEventListener('click', (e) => { if (e.target.id === id && !bloqueado()) cerrar(id); });
  });

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tecla = e.key.toLowerCase();
    if (tecla === 'escape') { cerrar('menu'); cerrar('confirmar'); return; }
    if (algoAbierto()) return;
    if (tecla === ' ' || tecla === 'enter') { e.preventDefault(); sacar(); }
    else if (tecla === 'm') abrir('menu');
    else if (tecla === 'n') abrir('confirmar');
  });

  $('version').textContent = VERSION;

  db.leer().then((lista) => { salidos = validarCopia({ app: 'bingo', salidos: lista }) || []; mostrar(false); })
    .catch(() => mostrar(false));

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
