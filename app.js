'use strict';

/**
 * Frontend en JavaScript puro.
 * Enrutado por hash (#/ruta), llama a la API y pinta las vistas:
 * inicio, clasificaciones, calendario y jugadores.
 */

const app = document.getElementById('app');

const estado = {
  deportes: [],
  municipios: [],
  temporadas: [],
  categorias: [],
  filtros: { deporte: '', municipio: '', temporada: '', categoria: '' },
  competiciones: []
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function api(ruta) {
  const res = await fetch('/api' + ruta);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error de red' }));
    throw new Error(err.error || 'Error al cargar los datos');
  }
  return res.json();
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function qs(sel, raiz = document) { return raiz.querySelector(sel); }

function opciones(select, items, valor, etiqueta, placeholder) {
  let html = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  html += items.map((i) => `<option value="${esc(i[valor])}">${esc(i[etiqueta])}</option>`).join('');
  select.innerHTML = html;
}

function cargando() {
  return '<div class="cargando"><div class="spinner"></div>Cargando…</div>';
}

function vacio(mensaje) {
  return `<div class="vacio">${esc(mensaje)}</div>`;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
  try {
    const [deportes, municipios, temporadas, categorias] = await Promise.all([
      api('/deportes'),
      api('/municipios'),
      api('/temporadas'),
      api('/categorias')
    ]);
    estado.deportes = deportes;
    estado.municipios = municipios;
    estado.temporadas = temporadas;
    estado.categorias = categorias;
  } catch (e) {
    app.innerHTML = `<div class="aviso error">No se pudo conectar con el servidor: ${esc(e.message)}</div>`;
    return;
  }
  window.addEventListener('hashchange', router);
  router();
}

// ---------------------------------------------------------------------------
// Enrutado
// ---------------------------------------------------------------------------

function router() {
  const hash = location.hash.replace(/^#\/?/, '');
  const partes = hash.split('/').filter(Boolean);
  marcarNav(partes[0] || 'inicio');

  if (!partes.length) return vistaInicio();
  if (partes[0] === 'clasificaciones') return vistaClasificaciones(partes[1]);
  if (partes[0] === 'calendario') return vistaCalendario(partes[1]);
  if (partes[0] === 'jugadores') return vistaJugadores(partes[1]);
  if (partes[0] === 'envivo') return vistaEnVivo();
  return vistaInicio();
}

function marcarNav(seccion) {
  const mapa = { '': 'nav-inicio', inicio: 'nav-inicio', clasificaciones: 'nav-clasif', calendario: 'nav-calendario', jugadores: 'nav-jugadores', envivo: 'nav-envivo' };
  document.querySelectorAll('.cabecera nav a').forEach((a) => a.classList.remove('activo'));
  const id = mapa[seccion];
  if (id) document.getElementById(id)?.classList.add('activo');
}

// ---------------------------------------------------------------------------
// Filtros reutilizables
// ---------------------------------------------------------------------------

function htmlFiltros(ocultarDeporte = false) {
  return `
    <div class="panel-filtros">
      ${ocultarDeporte ? '' : `
      <div class="campo">
        <label for="f-deporte">Deporte</label>
        <select id="f-deporte"><option value="">Todos</option>
          ${estado.deportes.map((d) => `<option value="${d.slug}">${esc(d.nombre)}</option>`).join('')}
        </select>
      </div>`}
      <div class="campo">
        <label for="f-municipio">Municipio</label>
        <select id="f-municipio"><option value="">Todos</option>
          ${estado.municipios.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="f-temporada">Temporada</label>
        <select id="f-temporada"><option value="">Todas</option>
          ${estado.temporadas.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}
        </select>
      </div>
      <div class="campo">
        <label for="f-categoria">Categoría</label>
        <select id="f-categoria"><option value="">Todas</option>
          ${estado.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function conectarFiltros(callback, ocultarDeporte = false) {
  const ids = ocultarDeporte
    ? [['f-municipio', 'municipio'], ['f-temporada', 'temporada'], ['f-categoria', 'categoria']]
    : [['f-deporte', 'deporte'], ['f-municipio', 'municipio'], ['f-temporada', 'temporada'], ['f-categoria', 'categoria']];
  for (const [id, clave] of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = estado.filtros[clave] || '';
    el.addEventListener('change', () => {
      estado.filtros[clave] = el.value;
      callback();
    });
  }
}

function queryFiltros(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...estado.filtros, ...extra })) {
    if (v) p.set(k, v);
  }
  return p.toString();
}

// ---------------------------------------------------------------------------
// Vista: inicio
// ---------------------------------------------------------------------------

async function vistaInicio() {
  app.innerHTML = `
    <div class="titulo-seccion"><span class="punto" style="background:#2563eb"></span><h2>Deportes</h2></div>
    <div class="grid-deportes">
      ${estado.deportes.map((d) => `
        <div class="tarjeta-deporte" style="border-left-color:${d.color}" data-deporte="${esc(d.slug)}">
          <h3>${esc(d.nombre)}</h3>
          <div class="cuenta" data-cuenta="${esc(d.slug)}">—</div>
          <p>Competiciones activas</p>
        </div>`).join('')}
    </div>

    <div class="titulo-seccion"><span class="punto" style="background:#16a34a"></span><h2>Competiciones</h2></div>
    ${htmlFiltros()}
    <div id="lista-comp">${cargando()}</div>`;

  conectarFiltros(recargarCompeticiones);
  document.querySelectorAll('.tarjeta-deporte').forEach((t) => {
    t.addEventListener('click', () => {
      const dep = t.dataset.deporte;
      estado.filtros.deporte = estado.filtros.deporte === dep ? '' : dep;
      location.hash = '#/clasificaciones';
    });
  });
  recargarCompeticiones();
}

async function recargarCompeticiones() {
  const cont = document.getElementById('lista-comp');
  if (!cont) return;
  cont.innerHTML = cargando();
  try {
    const lista = await api('/competiciones?' + queryFiltros());
    estado.competiciones = lista;

    // Contador de competiciones por deporte
    for (const d of estado.deportes) {
      const n = lista.filter((c) => c.deporte_slug === d.slug).length;
      const el = document.querySelector(`[data-cuenta="${d.slug}"]`);
      if (el) el.textContent = n;
    }

    if (!lista.length) {
      cont.innerHTML = vacio('No hay competiciones con esos filtros.');
      return;
    }

    cont.innerHTML = `<div class="grid-competiciones">${lista.map(tarjetaCompeticion).join('')}</div>`;
    cont.querySelectorAll('.tarjeta-comp').forEach((t) => {
      t.addEventListener('click', () => {
        location.hash = `#/clasificaciones/${t.dataset.id}`;
      });
    });
  } catch (e) {
    cont.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`;
  }
}

function tarjetaCompeticion(c) {
  return `
    <div class="tarjeta-comp" data-id="${c.id}" style="border-top-color:${c.color}">
      <h3>${esc(c.nombre)}</h3>
      <div class="meta">
        <span class="etiqueta">${esc(c.deporte)}</span>
        ${c.municipio ? `<span class="etiqueta gris">📍 ${esc(c.municipio)}</span>` : ''}
        <span class="etiqueta gris">📅 ${esc(c.temporada)}</span>
        ${c.categoria ? `<span class="etiqueta gris">${esc(c.categoria)}</span>` : ''}
      </div>
      <div style="color:var(--texto-suave);font-size:0.88rem">
        ${c.num_equipos} equipos · Ver clasificación →
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Selector de competicion (para clasificacion / calendario / jugadores)
// ---------------------------------------------------------------------------

async function selectorCompeticion() {
  const lista = await api('/competiciones?' + queryFiltros());
  estado.competiciones = lista;
  if (!lista.length) return null;

  const actual = estado.compSeleccionada;
  const cont = document.createElement('div');
  cont.className = 'panel-filtros';
  cont.innerHTML = `
    <div class="campo" style="grid-column:1/-1">
      <label for="sel-comp">Competición</label>
      <select id="sel-comp">
        ${lista.map((c) => `<option value="${c.id}" ${actual == c.id ? 'selected' : ''}>
          ${esc(c.nombre)} · ${esc(c.deporte)}${c.municipio ? ' · ' + esc(c.municipio) : ''} · ${esc(c.temporada)}${c.categoria ? ' · ' + esc(c.categoria) : ''}
        </option>`).join('')}
      </select>
    </div>`;
  if (!actual) estado.compSeleccionada = lista[0].id;
  return { elemento: cont, id: estado.compSeleccionada };
}

async function vistaConCompeticion(titulo, pintar) {
  app.innerHTML = cargando();
  const sel = await selectorCompeticion();
  if (!sel) {
    app.innerHTML = `<div class="aviso error">No hay competiciones con los filtros seleccionados.</div>` +
      `<p><a href="#/">← Volver al inicio</a></p>`;
    return;
  }
  app.innerHTML = `
    <button class="volver" onclick="location.hash='#/'">← Inicio</button>
    <div class="titulo-seccion"><h2>${esc(titulo)}</h2></div>
    <div id="selector"></div>
    <div id="contenido">${cargando()}</div>`;
  document.getElementById('selector').appendChild(sel.elemento);
  sel.elemento.querySelector('select').addEventListener('change', (e) => {
    estado.compSeleccionada = e.target.value;
    pintar(estado.compSeleccionada);
  });
  pintar(sel.id);
}

// ---------------------------------------------------------------------------
// Vista: clasificaciones
// ---------------------------------------------------------------------------

function vistaClasificaciones(id) {
  if (id) estado.compSeleccionada = id;
  vistaConCompeticion('Clasificación', pintarClasificacion);
}

async function pintarClasificacion(id) {
  const cont = document.getElementById('contenido');
  cont.innerHTML = cargando();
  try {
    const data = await api(`/competiciones/${id}/clasificacion`);
    if (!data.filas.length) { cont.innerHTML = vacio('Esta competición aún no tiene equipos.'); return; }
    const d = data.deporte;
    const cab = d.tipo_resultado === 'sets'
      ? ['PJ', 'PG', 'PP', 'SF', 'SC', 'DIF', 'PT']
      : d.tipo_resultado === 'puntos'
        ? ['PJ', 'PG', 'PP', 'PF', 'PC', 'DIF', 'PT']
        : ['PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'DIF', 'PT'];

    cont.innerHTML = `
      <div class="tabla-envoltorio">
        <table>
          <thead>
            <tr>
              <th style="width:44px">#</th>
              <th class="equipo">Equipo</th>
              ${cab.map((c) => `<th>${c}</th>`).join('')}
              <th>Últimos 5</th>
            </tr>
          </thead>
          <tbody>
            ${data.filas.map((f) => `
              <tr>
                <td class="pos ${f.posicion <= 2 ? 'pos-ascenso' : ''} ${f.posicion >= data.filas.length - 1 && data.filas.length > 4 ? 'pos-descenso' : ''}" style="border-left:none">${f.posicion}</td>
                <td class="equipo">${esc(f.nombre)}</td>
                <td>${f.pj}</td>
                <td>${f.pg}</td>
                ${d.tipo_resultado === 'goles' ? `<td>${f.pe}</td>` : ''}
                <td>${f.pp}</td>
                <td>${f.af}</td>
                <td>${f.ec}</td>
                <td>${f.dif > 0 ? '+' : ''}${f.dif}</td>
                <td class="pts">${f.pt}</td>
                <td><span class="racha">
                  ${f.ultimos5.map((r) => `<span class="r-${r}">${r}</span>`).join('') || '—'}
                </span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="color:var(--texto-suave);font-size:0.82rem">
        Puntuación: victoria ${d.puntos_victoria}
        ${d.puntos_empate ? `· empate ${d.puntos_empate}` : ''}
        · derrota ${d.puntos_derrota}
        ${d.tipo_resultado === 'sets' ? '· SF/SC = sets a favor/en contra' : ''}
        ${d.tipo_resultado === 'puntos' ? '· PF/PC = puntos a favor/en contra' : ''}
      </p>`;
  } catch (e) {
    cont.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Vista: calendario
// ---------------------------------------------------------------------------

function vistaCalendario(id) {
  if (id) estado.compSeleccionada = id;
  vistaConCompeticion('Calendario y resultados', pintarCalendario);
}

async function pintarCalendario(id) {
  const cont = document.getElementById('contenido');
  cont.innerHTML = cargando();
  try {
    const partidos = await api(`/competiciones/${id}/partidos`);
    if (!partidos.length) { cont.innerHTML = vacio('No hay partidos programados.'); return; }

    const porJornada = new Map();
    for (const p of partidos) {
      if (!porJornada.has(p.jornada)) porJornada.set(p.jornada, []);
      porJornada.get(p.jornada).push(p);
    }

    cont.innerHTML = `<div class="tabla-envoltorio">
      <div class="jornada-titulo">Jornadas</div>
      ${[...porJornada.entries()].map(([jornada, lista]) => `
        <div class="jornada-titulo" style="background:#f8fafc">Jornada ${jornada}</div>
        ${lista.map((p) => `
          <div class="partido">
            <div class="eq local">${esc(p.local)}</div>
            <div>
              <div class="marcador ${p.jugado ? '' : 'pendiente'}">
                ${p.jugado ? `${p.puntos_local} - ${p.puntos_visitante}` : 'vs'}
              </div>
              <span class="fecha">${p.fecha ? formatearFecha(p.fecha) : 'Por confirmar'}</span>
            </div>
            <div class="eq">${esc(p.visitante)}</div>
          </div>`).join('')}
      `).join('')}
    </div>`;
  } catch (e) {
    cont.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`;
  }
}

function formatearFecha(fecha) {
  const d = new Date(fecha + 'T00:00:00');
  if (isNaN(d)) return fecha;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Vista: jugadores
// ---------------------------------------------------------------------------

function vistaJugadores(id) {
  if (id) estado.compSeleccionada = id;
  vistaConCompeticion('Estadísticas de jugadores', pintarJugadores);
}

async function pintarJugadores(id) {
  const cont = document.getElementById('contenido');
  cont.innerHTML = cargando();
  try {
    const data = await api(`/competiciones/${id}/jugadores?limite=50`);
    const sanciones = await api(`/competiciones/${id}/sanciones`).then((r) => r.filas).catch(() => []);

    if (!data.filas.length && !sanciones.length) {
      cont.innerHTML = vacio('Todavía no hay estadísticas de jugadores.');
      return;
    }

    const etiqueta = data.deporte.tipo_resultado === 'puntos' ? 'Puntos'
      : data.deporte.tipo_resultado === 'sets' ? 'Aciertos/Puntos' : 'Goles';
    const mvp = data.mvp || data.filas;

    cont.innerHTML = `
      <div class="pestanas" id="pest-jug">
        <button data-jtab="anotadores" class="activo">${etiqueta}</button>
        <button data-jtab="mvp">⭐ MVP</button>
        <button data-jtab="sanciones">Tarjetas</button>
      </div>

      <div id="jtab-anotadores">
        ${!data.filas.length ? vacio('Sin datos de anotación.') : `
        <div class="tabla-envoltorio">
          <table>
            <thead>
              <tr>
                <th style="width:44px">#</th><th class="equipo">Jugador</th><th>Equipo</th>
                <th>Pos.</th><th>${etiqueta}</th><th>Partidos</th><th>Media</th><th>🟨</th><th>🟥</th>
              </tr>
            </thead>
            <tbody>
              ${data.filas.map((f, i) => `
                <tr>
                  <td class="pos">${i + 1}</td>
                  <td class="equipo">${esc(f.nombre)} ${f.dorsal ? `<span style="color:var(--texto-suave)">#${f.dorsal}</span>` : ''}</td>
                  <td>${esc(f.equipo)}</td>
                  <td>${esc(f.posicion || '—')}</td>
                  <td class="pts">${f.total}</td>
                  <td>${f.partidos}</td>
                  <td>${f.partidos ? (f.total / f.partidos).toFixed(2) : '0.00'}</td>
                  <td>${f.amarillas || 0}</td>
                  <td>${f.rojas || 0}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <div id="jtab-mvp" class="oculto">
        ${!mvp.length ? vacio('Sin datos para el MVP.') : `
        <div class="tabla-envoltorio">
          <table>
            <thead><tr><th style="width:44px">#</th><th class="equipo">Jugador</th><th>Equipo</th><th>${etiqueta}</th><th>Partidos</th><th>Tarjetas</th><th>Valoración</th></tr></thead>
            <tbody>
              ${mvp.map((f, i) => `
                <tr${i === 0 ? ' style="background:#fffbeb"' : ''}>
                  <td class="pos">${i === 0 ? '⭐' : i + 1}</td>
                  <td class="equipo">${esc(f.nombre)} ${f.dorsal ? `<span style="color:var(--texto-suave)">#${f.dorsal}</span>` : ''}</td>
                  <td>${esc(f.equipo)}</td>
                  <td class="pts">${f.total}</td>
                  <td>${f.partidos}</td>
                  <td>${f.amarillas || 0}🟨 ${f.rojas || 0}🟥</td>
                  <td><strong>${f.valoracion ?? 0}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p style="color:var(--texto-suave);font-size:0.8rem">Valoración = anotaciones + partidos jugados − tarjetas amarillas − 3 × tarjetas rojas.</p>`}
      </div>

      <div id="jtab-sanciones" class="oculto">
        ${!sanciones.length ? vacio('No hay tarjetas registradas.') : `
        <div class="tabla-envoltorio">
          <table>
            <thead><tr><th style="width:44px">#</th><th class="equipo">Jugador</th><th>Equipo</th><th>🟨 Amarillas</th><th>🟥 Rojas</th><th>Total</th></tr></thead>
            <tbody>
              ${sanciones.map((f, i) => `
                <tr>
                  <td class="pos">${i + 1}</td>
                  <td class="equipo">${esc(f.nombre)} ${f.dorsal ? `<span style="color:var(--texto-suave)">#${f.dorsal}</span>` : ''}</td>
                  <td>${esc(f.equipo)}</td>
                  <td>${f.amarillas}</td>
                  <td>${f.rojas}</td>
                  <td><strong>${f.amarillas + f.rojas}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>`;

    cont.querySelectorAll('#pest-jug button').forEach((b) => {
      b.addEventListener('click', () => {
        cont.querySelectorAll('#pest-jug button').forEach((x) => x.classList.remove('activo'));
        b.classList.add('activo');
        ['anotadores', 'mvp', 'sanciones'].forEach((t) => {
          document.getElementById('jtab-' + t)?.classList.toggle('oculto', t !== b.dataset.jtab);
        });
      });
    });
  } catch (e) {
    cont.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Vista: en vivo
// ---------------------------------------------------------------------------

let fuenteSSE = null;

function vistaEnVivo() {
  if (fuenteSSE) { fuenteSSE.close(); fuenteSSE = null; }
  app.innerHTML = `
    <div class="titulo-seccion"><span class="punto" style="background:#dc2626"></span><h2>Partidos en vivo</h2></div>
    <p style="color:var(--texto-suave);font-size:0.9rem;margin-top:-8px">
      <span id="indicador-live">🟢 Conectado · actualización automática</span>
    </p>
    <div id="lista-envivo">${cargando()}</div>`;

  cargarEnVivo();
  conectarSSE();
  animarRelojesPublicos();
}

async function cargarEnVivo() {
  const cont = document.getElementById('lista-envivo');
  if (!cont) return;
  try {
    const partidos = await api('/envivo');
    if (!partidos.length) {
      cont.innerHTML = vacio('Ahora mismo no hay partidos en directo.');
      return;
    }
    cont.innerHTML = `<div class="grid-competiciones">${partidos.map(tarjetaEnVivo).join('')}</div>`;
  } catch (e) {
    cont.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`;
  }
}

function tarjetaEnVivo(p) {
  const estado = {
    en_vivo: '<span style="color:#dc2626;font-weight:700">🔴 EN VIVO</span>',
    descanso: '<span style="color:#64748b;font-weight:700">⏸️ DESCANSO</span>',
    finalizado: '<span style="color:#16a34a;font-weight:700">✅ FINAL</span>'
  }[p.estado] || '';
  const seg = p.segundos || 0;
  const reloj = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
  return `
    <div class="tarjeta-comp" style="cursor:default;border-top-color:${p.color}" data-partido="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        ${estado}
        <span class="etiqueta gris">${esc(p.deporte)}${p.periodo ? ' · ' + esc(p.periodo) : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin:14px 0 8px">
        <div style="text-align:right;font-weight:600">${esc(p.local)}</div>
        <div style="background:#0f172a;color:#fff;font-weight:800;font-size:1.5rem;padding:7px 16px;border-radius:10px;min-width:96px;text-align:center">
          ${p.puntos_local ?? 0} - ${p.puntos_visitante ?? 0}
        </div>
        <div style="font-weight:600">${esc(p.visitante)}</div>
      </div>
      <div style="text-align:center;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:1px;color:${p.cronometro_activo ? '#dc2626' : 'var(--texto-suave)'};margin-bottom:6px">
        <span class="reloj-publico" data-segundos="${seg}" data-activo="${p.cronometro_activo ? 1 : 0}">⏱ ${reloj}</span>
      </div>
      <div style="color:var(--texto-suave);font-size:0.82rem">
        ${esc(p.competicion)} · Jornada ${p.jornada}${p.num_eventos ? ' · ' + p.num_eventos + ' eventos' : ''}
      </div>
    </div>`;
}

let intervaloRelojPublico = null;

/** Avanza los relojes visibles cada segundo sin recargar. */
function animarRelojesPublicos() {
  if (intervaloRelojPublico) clearInterval(intervaloRelojPublico);
  intervaloRelojPublico = setInterval(() => {
    const relojes = document.querySelectorAll('.reloj-publico');
    if (!relojes.length) { clearInterval(intervaloRelojPublico); intervaloRelojPublico = null; return; }
    relojes.forEach((el) => {
      if (el.dataset.activo !== '1') return;
      const s = (Number(el.dataset.segundos) || 0) + 1;
      el.dataset.segundos = s;
      el.textContent = `⏱ ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    });
  }, 1000);
}

function conectarSSE() {
  try {
    fuenteSSE = new EventSource('/api/envivo/stream');
    fuenteSSE.addEventListener('envivo', () => {
      if (location.hash.replace(/^#\/?/, '').startsWith('envivo')) cargarEnVivo();
    });
    fuenteSSE.onopen = () => {
      const el = document.getElementById('indicador-live');
      if (el) el.textContent = '🟢 Conectado · actualización automática';
    };
    fuenteSSE.onerror = () => {
      const el = document.getElementById('indicador-live');
      if (el) el.textContent = '🟠 Reconectando…';
    };
  } catch {
    // Si SSE no está disponible, no pasa nada: se recarga al entrar
  }
}

iniciar();
