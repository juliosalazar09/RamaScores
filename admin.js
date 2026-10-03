'use strict';

/**
 * Panel de administración (JS puro).
 * Login, alta de competiciones/equipos/jugadores y registro de resultados.
 */

const app = document.getElementById('admin-app');
const btnSalir = document.getElementById('btn-salir');

const token = {
  get: () => localStorage.getItem('token_admin'),
  set: (t) => localStorage.setItem('token_admin', t),
  borrar: () => localStorage.removeItem('token_admin')
};

const estado = {
  deportes: [], municipios: [], temporadas: [], categorias: [],
  competiciones: [], equipos: [], jugadores: []
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(ruta, opciones = {}) {
  const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  const t = token.get();
  if (t) cabeceras['Authorization'] = 'Bearer ' + t;

  const res = await fetch('/api' + ruta, { ...opciones, headers: cabeceras });
  const texto = await res.text();
  const data = texto ? JSON.parse(texto) : {};
  if (!res.ok) throw new Error(data.error || 'Error en la petición');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function aviso(mensaje, tipo = 'ok') {
  const el = document.getElementById('aviso');
  if (!el) return;
  el.className = 'aviso ' + tipo;
  el.textContent = mensaje;
  el.classList.remove('oculto');
  setTimeout(() => el.classList.add('oculto'), 3500);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
  btnSalir.addEventListener('click', cerrarSesion);
  if (!token.get()) return pantallaLogin();
  try {
    await cargarCatalogos();
    await cargarCompeticiones();
    btnSalir.classList.remove('oculto');
    pintarPanel();
  } catch (e) {
    token.borrar();
    pantallaLogin();
  }
}

async function cargarCatalogos() {
  const [deportes, municipios, temporadas, categorias] = await Promise.all([
    api('/deportes'), api('/municipios'), api('/temporadas'), api('/categorias')
  ]);
  Object.assign(estado, { deportes, municipios, temporadas, categorias });
}

async function cargarCompeticiones() {
  estado.competiciones = await api('/competiciones');
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function pantallaLogin() {
  btnSalir.classList.add('oculto');
  app.innerHTML = `
    <div class="caja-login">
      <h2>Iniciar sesión</h2>
      <p style="color:var(--texto-suave);font-size:0.9rem">Acceso restringido al gestor de la liga.</p>
      <div id="aviso" class="aviso error oculto"></div>
      <form class="formulario" id="form-login">
        <div class="campo"><label>Usuario</label><input name="usuario" autocomplete="username" required></div>
        <div class="campo"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">Entrar</button>
      </form>
      <p style="font-size:0.8rem;color:var(--texto-suave);margin-top:16px">
        Por defecto: <strong>admin / admin123</strong> (cámbialo en el servidor).
      </p>
    </div>`;

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ usuario: f.get('usuario'), password: f.get('password') })
      });
      token.set(data.token);
      iniciar();
    } catch (err) {
      aviso(err.message, 'error');
    }
  });
}

async function cerrarSesion() {
  try { await api('/logout', { method: 'POST' }); } catch {}
  token.borrar();
  pantallaLogin();
}

// ---------------------------------------------------------------------------
// Panel principal
// ---------------------------------------------------------------------------

function pintarPanel() {
  app.innerHTML = `
    <div id="aviso" class="aviso ok oculto"></div>
    <div class="pestanas">
      <button data-tab="competiciones" class="activo">Competiciones</button>
      <button data-tab="equipos">Equipos y jugadores</button>
      <button data-tab="calendario">Calendario</button>
      <button data-tab="envivo">Partido en vivo</button>
      <button data-tab="municipios">Municipios</button>
      <button data-tab="resultados">Registrar resultado</button>
    </div>
    <div id="tab-contenido"></div>`;

  app.querySelectorAll('.pestanas button').forEach((b) => {
    b.addEventListener('click', () => {
      app.querySelectorAll('.pestanas button').forEach((x) => x.classList.remove('activo'));
      b.classList.add('activo');
      mostrarTab(b.dataset.tab);
    });
  });
  mostrarTab('competiciones');
}

function mostrarTab(tab) {
  const cont = document.getElementById('tab-contenido');
  if (tab === 'competiciones') return tabCompeticiones(cont);
  if (tab === 'equipos') return tabEquipos(cont);
  if (tab === 'calendario') return tabCalendario(cont);
  if (tab === 'envivo') return tabEnVivo(cont);
  if (tab === 'municipios') return tabMunicipios(cont);
  if (tab === 'resultados') return tabResultados(cont);
}

// ---------------------------------------------------------------------------
// Tab: competiciones
// ---------------------------------------------------------------------------

async function tabCompeticiones(cont) {
  await cargarCompeticiones();
  cont.innerHTML = `
    <div class="tabla-envoltorio" style="padding:18px">
      <h3 style="margin-top:0">Nueva competición</h3>
      <form class="formulario" id="form-comp">
        <div class="fila">
          <div class="campo"><label>Nombre</label><input name="nombre" required placeholder="Liga Local ..."></div>
          <div class="campo"><label>Deporte</label><select name="deporte_id" required>
            ${estado.deportes.map((d) => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Municipio</label><select name="municipio_id">
            <option value="">—</option>${estado.municipios.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}
          </select></div>
        </div>
        <div class="fila">
          <div class="campo"><label>Temporada</label><select name="temporada_id" required>
            ${estado.temporadas.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Categoría</label><select name="categoria_id">
            <option value="">—</option>${estado.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
          </select></div>
          <div class="campo" style="justify-content:flex-end"><button class="btn" type="submit">Crear competición</button></div>
        </div>
      </form>
    </div>

    <div class="tabla-envoltorio">
      <table>
        <thead><tr><th class="equipo">Competición</th><th>Deporte</th><th>Municipio</th><th>Temporada</th><th>Categoría</th><th>Equipos</th><th></th></tr></thead>
        <tbody>
          ${estado.competiciones.map((c) => `
            <tr>
              <td class="equipo">${esc(c.nombre)}</td>
              <td>${esc(c.deporte)}</td>
              <td>${esc(c.municipio || '—')}</td>
              <td>${esc(c.temporada)}</td>
              <td>${esc(c.categoria || '—')}</td>
              <td>${c.num_equipos}</td>
              <td class="acciones"><button class="btn peligro pequeno" data-borrar-comp="${c.id}">Borrar</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin competiciones</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.getElementById('form-comp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/competiciones', { method: 'POST', body: JSON.stringify({
        nombre: f.get('nombre'),
        deporte_id: Number(f.get('deporte_id')),
        municipio_id: f.get('municipio_id') ? Number(f.get('municipio_id')) : null,
        temporada_id: Number(f.get('temporada_id')),
        categoria_id: f.get('categoria_id') ? Number(f.get('categoria_id')) : null
      }) });
      aviso('Competición creada');
      tabCompeticiones(cont);
    } catch (err) { aviso(err.message, 'error'); }
  });

  cont.querySelectorAll('[data-borrar-comp]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar la competición y todos sus equipos y partidos?')) return;
      try {
        await api('/competiciones/' + b.dataset.borrarComp, { method: 'DELETE' });
        aviso('Competición borrada');
        tabCompeticiones(cont);
      } catch (err) { aviso(err.message, 'error'); }
    });
  });
}

// ---------------------------------------------------------------------------
// Tab: equipos y jugadores
// ---------------------------------------------------------------------------

async function tabEquipos(cont) {
  await cargarCompeticiones();
  cont.innerHTML = `
    <div class="panel-filtros">
      <div class="campo" style="grid-column:1/-1">
        <label>Competición</label>
        <select id="sel-comp-admin">
          ${estado.competiciones.map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.deporte)} · ${esc(c.temporada)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="tabla-envoltorio" style="padding:18px">
      <h3 style="margin-top:0">Nuevo equipo</h3>
      <form class="formulario" id="form-equipo">
        <div class="fila">
          <div class="campo"><label>Nombre del equipo</label><input name="nombre" required></div>
          <div class="campo"><label>Localidad</label><input name="localidad"></div>
          <div class="campo" style="justify-content:flex-end"><button class="btn" type="submit">Añadir equipo</button></div>
        </div>
      </form>
    </div>

    <div class="tabla-envoltorio" style="padding:18px">
      <h3 style="margin-top:0">Carga masiva de jugadores</h3>
      <p style="color:var(--texto-suave);font-size:0.88rem;margin-top:0">
        Crea plantillas automáticamente para todos los equipos, o pega/importa una lista de jugadores.
      </p>

      <div class="fila" style="align-items:end;margin-bottom:12px">
        <div class="campo"><label>Jugadores por equipo</label>
          <input id="plantilla-cantidad" type="number" min="1" max="30" value="12">
        </div>
        <div class="campo"><label style="text-transform:none;display:flex;gap:8px;align-items:center">
          <input id="plantilla-reemplazar" type="checkbox" style="width:auto"> Reemplazar plantillas existentes</label>
        </div>
        <div class="campo" style="justify-content:flex-end">
          <button class="btn" id="btn-generar-plantillas">✨ Generar plantillas de ejemplo</button>
        </div>
      </div>

      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600;color:var(--primario)">Importar desde CSV / lista de texto</summary>
        <div style="margin-top:12px">
          <p style="color:var(--texto-suave);font-size:0.84rem">
            Formato por línea: <code>Equipo, Nombre, Dorsal, Posición</code>.
            El dorsal y la posición son opcionales. La primera línea de encabezado se ignora.
          </p>
          <div class="fila" style="margin-bottom:10px">
            <div class="campo" style="grid-column:1/-1">
              <label>Datos</label>
              <textarea id="csv-jugadores" rows="8" placeholder="Classic, Juan Pérez, 1, Portero&#10;Classic, Luis Gómez, 7, Delantero&#10;Novo FC, Ana Ruiz, 10, Centrocampista"
                style="width:100%;padding:10px;border:1px solid var(--borde);border-radius:9px;font-family:ui-monospace,monospace;font-size:0.85rem;resize:vertical"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn" id="btn-importar-csv">📥 Importar jugadores</button>
            <label class="btn secundario" style="cursor:pointer">
              📄 Elegir archivo CSV
              <input id="archivo-csv" type="file" accept=".csv,.txt" class="oculto">
            </label>
            <span style="color:var(--texto-suave);font-size:0.82rem">Se añaden a los equipos por su nombre.</span>
          </div>
        </div>
      </details>
    </div>

    <div id="lista-equipos"></div>`;

  const sel = document.getElementById('sel-comp-admin');
  const recargar = () => cargarEquipos(sel.value);
  sel.addEventListener('change', recargar);
  if (estado.competiciones.length) recargar();
  else document.getElementById('lista-equipos').innerHTML = '<div class="vacio">Crea primero una competición.</div>';

  document.getElementById('form-equipo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/equipos', { method: 'POST', body: JSON.stringify({
        nombre: f.get('nombre'), localidad: f.get('localidad'), competicion_id: Number(sel.value)
      }) });
      aviso('Equipo añadido');
      e.target.reset();
      recargar();
    } catch (err) { aviso(err.message, 'error'); }
  });

  // Generar plantillas de ejemplo
  document.getElementById('btn-generar-plantillas').addEventListener('click', async () => {
    const cantidad = Number(document.getElementById('plantilla-cantidad').value) || 12;
    const reemplazar = document.getElementById('plantilla-reemplazar').checked;
    if (reemplazar && !confirm('Se borrarán los jugadores actuales de esos equipos. ¿Continuar?')) return;
    try {
      const r = await api(`/competiciones/${sel.value}/generar-plantillas`, {
        method: 'POST',
        body: JSON.stringify({ jugadores_por_equipo: cantidad, reemplazar })
      });
      aviso(`Plantillas creadas: ${r.jugadores_creados} jugadores en ${r.equipos_procesados} equipos`);
      recargar();
    } catch (err) { aviso(err.message, 'error'); }
  });

  // Importar CSV
  const importar = async () => {
    const texto = document.getElementById('csv-jugadores').value;
    const jugadores = parsearCSV(texto);
    if (!jugadores.length) { aviso('No se detectaron jugadores en el texto', 'error'); return; }
    try {
      const r = await api('/jugadores/importar', { method: 'POST', body: JSON.stringify({ jugadores }) });
      aviso(`Importados ${r.jugadores_creados} jugadores${r.errores.length ? ` · ${r.errores.length} con avisos` : ''}`);
      if (r.errores.length) console.warn('Importación con avisos:', r.errores);
      recargar();
    } catch (err) { aviso(err.message, 'error'); }
  };
  document.getElementById('btn-importar-csv').addEventListener('click', importar);

  document.getElementById('archivo-csv').addEventListener('change', (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => {
      document.getElementById('csv-jugadores').value = lector.result;
      aviso('Archivo cargado. Pulsa «Importar jugadores».');
    };
    lector.readAsText(archivo);
  });
}

/** Convierte texto CSV/lista en objetos de jugador. */
function parsearCSV(texto) {
  const filas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const jugadores = [];
  filas.forEach((linea, i) => {
    const partes = linea.split(',').map((c) => c.trim());
    // Ignora una cabecera que contenga a la vez "equipo" y "nombre"
    if (i === 0 && /equipo/i.test(linea) && /nombre/i.test(linea)) return;
    if (partes.length < 2 || !partes[1]) return;
    jugadores.push({
      equipo: partes[0],
      nombre: partes[1],
      dorsal: partes[2] ? Number(partes[2]) : null,
      posicion: partes[3] || null
    });
  });
  return jugadores;
}

async function cargarEquipos(competicionId) {
  const cont = document.getElementById('lista-equipos');
  cont.innerHTML = '<div class="cargando"><div class="spinner"></div></div>';
  const equiposReales = await api('/equipos?competicion_id=' + competicionId).catch(() => null);

  if (!equiposReales) {
    cont.innerHTML = '<div class="vacio">No se pudieron cargar los equipos.</div>';
    return;
  }
  estado.equipos = equiposReales;

  if (!equiposReales.length) { cont.innerHTML = '<div class="vacio">Esta competición aún no tiene equipos.</div>'; return; }

  cont.innerHTML = equiposReales.map((eq) => `
    <div class="tabla-envoltorio" style="padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <strong style="font-size:1.05rem">${esc(eq.nombre)}</strong>
        ${eq.localidad ? `<span class="etiqueta gris">${esc(eq.localidad)}</span>` : ''}
        <button class="btn peligro pequeno" style="margin-left:auto" data-borrar-eq="${eq.id}">Borrar equipo</button>
      </div>
      <div id="jugadores-${eq.id}">Cargando jugadores…</div>
      <form class="formulario" data-form-jugador="${eq.id}" style="margin-top:10px">
        <div class="fila">
          <div class="campo"><label>Jugador</label><input name="nombre" required placeholder="Nombre y apellidos"></div>
          <div class="campo"><label>Dorsal</label><input name="dorsal" type="number" min="1" max="99"></div>
          <div class="campo"><label>Posición</label><input name="posicion"></div>
          <div class="campo" style="justify-content:flex-end"><button class="btn peque" type="submit">Añadir jugador</button></div>
        </div>
      </form>
    </div>`).join('');

  cont.querySelectorAll('[data-borrar-eq]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar este equipo y sus jugadores?')) return;
      await api('/equipos/' + b.dataset.borrarEq, { method: 'DELETE' });
      aviso('Equipo borrado');
      cargarEquipos(competicionId);
    });
  });

  for (const eq of equiposReales) {
    pintarJugadores(eq.id);
    cont.querySelector(`[data-form-jugador="${eq.id}"]`).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/jugadores', { method: 'POST', body: JSON.stringify({
          nombre: f.get('nombre'), dorsal: f.get('dorsal') ? Number(f.get('dorsal')) : null,
          posicion: f.get('posicion'), equipo_id: eq.id
        }) });
        aviso('Jugador añadido');
        e.target.reset();
        pintarJugadores(eq.id);
      } catch (err) { aviso(err.message, 'error'); }
    });
  }
}

async function pintarJugadores(equipoId) {
  const cont = document.getElementById('jugadores-' + equipoId);
  if (!cont) return;
  const jugadores = await api('/jugadores/' + equipoId).catch(() => []);
  if (!jugadores.length) { cont.innerHTML = '<span style="color:var(--texto-suave);font-size:0.88rem">Sin jugadores.</span>'; return; }
  cont.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px">
    ${jugadores.map((j) => `
      <span class="etiqueta">${j.dorsal ? '#' + j.dorsal + ' ' : ''}${esc(j.nombre)}
        ${j.posicion ? `<em style="opacity:.7">· ${esc(j.posicion)}</em>` : ''}
        <button data-borrar-jug="${j.id}" style="border:none;background:none;color:#b91c1c;cursor:pointer;font-weight:700;margin-left:4px">×</button>
      </span>`).join('')}
  </div>`;

  cont.querySelectorAll('[data-borrar-jug]').forEach((b) => {
    b.addEventListener('click', async () => {
      await api('/jugadores/' + b.dataset.borrarJug, { method: 'DELETE' });
      aviso('Jugador borrado');
      pintarJugadores(equipoId);
    });
  });
}

// ---------------------------------------------------------------------------
// Tab: calendario aleatorio
// ---------------------------------------------------------------------------

async function tabCalendario(cont) {
  await cargarCompeticiones();
  cont.innerHTML = `
    <div class="panel-filtros">
      <div class="campo" style="grid-column:1/-1">
        <label>Competición</label>
        <select id="sel-comp-cal">
          ${estado.competiciones.map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.deporte)} · ${esc(c.temporada)} (${c.num_equipos} equipos)</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="tabla-envoltorio" style="padding:18px">
      <h3 style="margin-top:0">Generar calendario aleatorio</h3>
      <p style="color:var(--texto-suave);font-size:0.88rem;margin-top:0">
        Crea todos los enfrentamientos con sorteo aleatorio de equipos y de localía (formato liga).
        Cada equipo descansa una jornada si el número es impar.
      </p>
      <form class="formulario" id="form-cal">
        <div class="fila">
          <div class="campo"><label>Fecha de inicio</label><input name="fecha_inicio" type="date" required></div>
          <div class="campo"><label>Días entre jornadas</label><input name="dias_entre_jornadas" type="number" min="1" value="7" required></div>
          <div class="campo"><label>Formato</label>
            <select name="doble_vuelta">
              <option value="no">Solo ida</option>
              <option value="si">Ida y vuelta</option>
            </select>
          </div>
        </div>
        <div class="fila">
          <div class="campo"><label style="display:flex;align-items:center;gap:8px;text-transform:none">
            <input type="checkbox" name="reemplazar" style="width:auto"> Borrar los partidos existentes antes de generar
          </label></div>
          <div class="campo" style="justify-content:flex-end"><button class="btn" type="submit">Generar calendario</button></div>
        </div>
      </form>
    </div>
    <div id="cal-resultado"></div>`;

  document.getElementById('form-cal').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const data = await api(`/competiciones/${document.getElementById('sel-comp-cal').value}/generar-calendario`, {
        method: 'POST',
        body: JSON.stringify({
          fecha_inicio: f.get('fecha_inicio'),
          dias_entre_jornadas: Number(f.get('dias_entre_jornadas')),
          doble_vuelta: f.get('doble_vuelta') === 'si',
          reemplazar: f.get('reemplazar') === 'on'
        })
      });
      aviso(`Calendario generado: ${data.partidos_creados} partidos`);
      document.getElementById('cal-resultado').innerHTML = `<div class="aviso ok">✅ ${data.partidos_creados} partidos creados. Puedes verlos en la web pública, sección Calendario.</div>`;
    } catch (err) { aviso(err.message, 'error'); }
  });
}

// ---------------------------------------------------------------------------
// Tab: partido en vivo
// ---------------------------------------------------------------------------

let temporizadorVivo = null;

async function tabEnVivo(cont) {
  if (temporizadorVivo) { clearInterval(temporizadorVivo); temporizadorVivo = null; }
  await cargarCompeticiones();

  cont.innerHTML = `
    <div class="panel-filtros">
      <div class="campo" style="grid-column:1/-1">
        <label>Competición</label>
        <select id="sel-comp-vivo">
          ${estado.competiciones.map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.deporte)} · ${esc(c.temporada)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="panel-filtros">
      <div class="campo" style="grid-column:1/-1">
        <label>Partido</label>
        <select id="sel-partido-vivo"><option value="">Cargando…</option></select>
      </div>
    </div>
    <div id="consola-vivo"></div>`;

  const selComp = document.getElementById('sel-comp-vivo');
  selComp.addEventListener('change', () => cargarPartidosVivo(selComp.value));
  cargarPartidosVivo(selComp.value);
}

async function cargarPartidosVivo(competicionId) {
  const sel = document.getElementById('sel-partido-vivo');
  sel.innerHTML = '<option value="">Cargando…</option>';
  try {
    const partidos = await api(`/competiciones/${competicionId}/partidos`);
    if (!partidos.length) {
      sel.innerHTML = '<option value="">Sin partidos. genera el calendario primero.</option>';
      document.getElementById('consola-vivo').innerHTML = '';
      return;
    }
    sel.innerHTML = partidos.map((p) => {
      const marca = p.estado === 'en_vivo' ? '🔴 EN VIVO' : p.estado === 'descanso' ? '⏸️ DESCANSO'
        : p.estado === 'finalizado' ? '✅ Final' : '📅';
      return `<option value="${p.id}">${marca} J${p.jornada} · ${esc(p.local)} vs ${esc(p.visitante)}${p.fecha ? ' · ' + p.fecha : ''}</option>`;
    }).join('');
    sel.addEventListener('change', () => abrirConsolaVivo(Number(sel.value)));
    abrirConsolaVivo(Number(sel.value));
  } catch (err) {
    sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
  }
}

async function abrirConsolaVivo(partidoId) {
  const cont = document.getElementById('consola-vivo');
  if (!partidoId) { cont.innerHTML = ''; return; }
  cont.innerHTML = '<div class="cargando"><div class="spinner"></div></div>';
  try {
    const detalle = await api(`/partidos/${partidoId}/detalle`);
    pintarConsolaVivo(detalle);
  } catch (err) {
    cont.innerHTML = `<div class="aviso error">${esc(err.message)}</div>`;
  }
}

function pintarConsolaVivo(detalle) {
  const cont = document.getElementById('consola-vivo');
  if (!cont) return;
  const p = detalle.partido;
  const jugadoresPorEquipo = (equipoId) => detalle.jugadores.filter((j) => j.equipo_id === equipoId);

  const opcionesJugador = (equipoId) =>
    `<option value="">Sin especificar</option>` +
    jugadoresPorEquipo(equipoId).map((j) => `<option value="${j.id}">${j.dorsal ? '#' + j.dorsal + ' ' : ''}${esc(j.nombre)}</option>`).join('');

  const tipoAnotacion = p.tipo_resultado === 'puntos' ? 'Canasta' : p.tipo_resultado === 'sets' ? 'Punto de set' : 'Gol';
  const valoresAnotacion = p.tipo_resultado === 'puntos'
    ? [[1, '1 punto'], [2, '2 puntos'], [3, '3 puntos']]
    : [[1, tipoAnotacion]];

  const estadoTexto = { programado: 'No iniciado', en_vivo: '🔴 EN VIVO', descanso: '⏸️ Descanso', finalizado: '✅ Finalizado' }[p.estado];
  const enJuego = p.estado === 'en_vivo' || p.estado === 'descanso';
  const seg = p.segundos || 0;
  const reloj = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;

  cont.innerHTML = `
    <div class="tabla-envoltorio" style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span style="font-weight:700;color:${p.estado === 'en_vivo' ? '#dc2626' : 'var(--texto-suave)'}">${estadoTexto}</span>
        <span class="etiqueta gris">Jornada ${p.jornada} · ${esc(p.competicion)}</span>
        ${p.periodo ? `<span class="etiqueta">${esc(p.periodo)}</span>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:22px 0 14px">
        <div style="text-align:right;font-weight:700;font-size:1.1rem">${esc(p.local)}</div>
        <div style="background:#0f172a;color:#fff;font-weight:800;font-size:1.8rem;padding:10px 22px;border-radius:12px;text-align:center;min-width:130px">
          ${p.puntos_local ?? 0} - ${p.puntos_visitante ?? 0}
        </div>
        <div style="font-weight:700;font-size:1.1rem">${esc(p.visitante)}</div>
      </div>

      <div style="text-align:center;margin-bottom:16px">
        <span id="reloj-vivo" data-segundos="${seg}" data-activo="${p.cronometro_activo ? 1 : 0}"
              style="font-size:2rem;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:2px;color:${p.cronometro_activo ? '#dc2626' : 'var(--texto-suave)'}">
          ${reloj}
        </span>
        <div style="display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap">
          ${p.cronometro_activo
            ? `<button class="btn pequeno secundario" id="btn-crono-pausar">⏸️ Pausar reloj</button>`
            : `<button class="btn pequeno" id="btn-crono-reanudar" ${enJuego ? '' : 'disabled'}>▶️ Reanudar reloj</button>`}
          <button class="btn pequeno secundario" id="btn-crono-reiniciar" ${enJuego ? '' : 'disabled'}>🔄 Reiniciar</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:18px">
        ${p.estado === 'programado' ? `<button class="btn" id="btn-iniciar">▶️ Iniciar partido</button>` : ''}
        ${p.estado === 'en_vivo' ? `<button class="btn secundario" id="btn-descanso">⏸️ Descanso</button>` : ''}
        ${p.estado === 'descanso' ? `<button class="btn" id="btn-reanudar">▶️ Reanudar</button>` : ''}
        ${enJuego ? `<button class="btn peligro" id="btn-finalizar" style="background:#16a34a">🏁 Finalizar</button>` : ''}
        ${p.estado === 'finalizado' ? `<button class="btn secundario" id="btn-reabrir">↩️ Reabrir partido</button>` : ''}
      </div>

      ${enJuego ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${[p.local_id, p.visitante_id].map((eqId, idx) => {
          const nombre = idx === 0 ? p.local : p.visitante;
          return `
          <div style="border:1px solid var(--borde);border-radius:12px;padding:14px">
            <h4 style="margin:0 0 10px">${esc(nombre)}</h4>
            <div class="campo"><label>Jugador</label>
              <select class="jugador-evento" data-equipo="${eqId}">${opcionesJugador(eqId)}</select>
            </div>
            <div class="campo" style="margin-top:8px"><label>Minuto</label>
              <input class="minuto-evento" data-equipo="${eqId}" type="number" min="0" max="120" placeholder="opcional" style="margin-top:4px">
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
              ${valoresAnotacion.map(([v, etq]) => `<button class="btn pequeno anotar" data-equipo="${eqId}" data-valor="${v}">+ ${etq}</button>`).join('')}
              <button class="btn pequeno secundario asistenciar" data-equipo="${eqId}">🅰️ Asistencia</button>
              <button class="btn pequeno secundario amonestar" data-equipo="${eqId}" data-tipo="amarilla">🟨 Amarilla</button>
              <button class="btn pequeno peligro amonestar" data-equipo="${eqId}" data-tipo="roja">🟥 Roja</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${detalle.estadisticas && detalle.estadisticas.length ? `
      <h4 style="margin:22px 0 8px">Estadísticas del partido</h4>
      <div class="tabla-envoltorio" style="box-shadow:none">
        <table style="min-width:420px">
          <thead><tr><th class="equipo">Jugador</th><th>Eq.</th><th>Anotación</th><th>🅰️</th><th>🟨</th><th>🟥</th><th>MVP</th></tr></thead>
          <tbody>
            ${detalle.estadisticas.map((e) => `
              <tr${p.mvp_jugador_id === e.jugador_id ? ' style="background:#fffbeb"' : ''}>
                <td class="equipo">${esc(e.jugador || 'Sin nombre')}</td>
                <td>${e.equipo_id === p.local_id ? 'Local' : 'Vis.'}</td>
                <td class="pts">${e.anotacion}</td>
                <td>${e.asistencias || 0}</td>
                <td>${e.amarillas || 0}</td>
                <td>${e.rojas || 0}</td>
                <td>${p.mvp_jugador_id === e.jugador_id ? '⭐' : `<button class="btn pequeno secundario mvp-btn" data-jugador="${e.jugador_id}">Elegir</button>`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <h4 style="margin:22px 0 8px">Registro de eventos</h4>
      <div style="max-height:280px;overflow-y:auto">
        ${detalle.eventos.length ? detalle.eventos.map((ev) => {
          const icono = TIPOS_ICONO[ev.tipo] || '•';
          const nombreEquipo = ev.equipo_id === p.local_id ? p.local : p.visitante;
          return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:0.9rem">
            <span style="width:30px;color:var(--texto-suave)">${ev.minuto != null ? ev.minuto + "'" : '—'}</span>
            <span>${icono}</span>
            <span style="flex:1"><strong>${esc(ev.jugador || 'Sin jugador')}</strong> <span style="color:var(--texto-suave)">(${esc(nombreEquipo)})</span></span>
            <span style="color:var(--texto-suave)">${ev.tipo}${ev.valor > 1 ? ' ×' + ev.valor : ''}</span>
            ${enJuego ? `<button class="btn peligro pequeno borrar-evento" data-evento="${ev.id}" style="padding:2px 8px">×</button>` : ''}
          </div>`;
        }).join('') : '<div class="vacio" style="padding:16px">Todavía no hay eventos.</div>'}
      </div>
    </div>`;

  // Reloj que avanza en pantalla mientras el cronómetro está activo
  iniciarRelojVivo();

  // Acciones de estado
  document.getElementById('btn-iniciar')?.addEventListener('click', () => accionVivo(p.id, 'iniciar'));
  document.getElementById('btn-descanso')?.addEventListener('click', () => accionVivo(p.id, 'estado', { estado: 'descanso' }));
  document.getElementById('btn-reanudar')?.addEventListener('click', () => accionVivo(p.id, 'estado', { estado: 'en_vivo' }));
  document.getElementById('btn-finalizar')?.addEventListener('click', () => {
    if (confirm('¿Finalizar el partido? El resultado contará para la clasificación.')) accionVivo(p.id, 'estado', { estado: 'finalizado' });
  });
  document.getElementById('btn-reabrir')?.addEventListener('click', () => accionVivo(p.id, 'estado', { estado: 'en_vivo' }));

  // Cronómetro
  document.getElementById('btn-crono-pausar')?.addEventListener('click', () => accionCronometro(p.id, 'pausar'));
  document.getElementById('btn-crono-reanudar')?.addEventListener('click', () => accionCronometro(p.id, 'reanudar'));
  document.getElementById('btn-crono-reiniciar')?.addEventListener('click', () => {
    if (confirm('¿Reiniciar el cronómetro a 00:00?')) accionCronometro(p.id, 'reiniciar');
  });

  // Anotaciones
  cont.querySelectorAll('.anotar').forEach((b) => {
    b.addEventListener('click', () => {
      const jugador = cont.querySelector(`.jugador-evento[data-equipo="${b.dataset.equipo}"]`)?.value || null;
      const minuto = cont.querySelector(`.minuto-evento[data-equipo="${b.dataset.equipo}"]`)?.value
        || cont.querySelector('.minuto-evento')?.value || null;
      registrarEvento(p.id, {
        equipo_id: Number(b.dataset.equipo),
        jugador_id: jugador ? Number(jugador) : null,
        tipo: tipoEvento(p.tipo_resultado),
        valor: Number(b.dataset.valor),
        minuto: minuto ? Number(minuto) : null,
        periodo: p.periodo
      });
    });
  });

  // Asistencias
  cont.querySelectorAll('.asistenciar').forEach((b) => {
    b.addEventListener('click', () => {
      const jugador = cont.querySelector(`.jugador-evento[data-equipo="${b.dataset.equipo}"]`)?.value || null;
      registrarEvento(p.id, {
        equipo_id: Number(b.dataset.equipo),
        jugador_id: jugador ? Number(jugador) : null,
        tipo: 'asistencia',
        valor: 1,
        minuto: cont.querySelector(`.minuto-evento[data-equipo="${b.dataset.equipo}"]`)?.value || null,
        periodo: p.periodo
      });
    });
  });

  cont.querySelectorAll('.amonestar').forEach((b) => {
    b.addEventListener('click', () => {
      const jugador = cont.querySelector(`.jugador-evento[data-equipo="${b.dataset.equipo}"]`)?.value || null;
      registrarEvento(p.id, {
        equipo_id: Number(b.dataset.equipo),
        jugador_id: jugador ? Number(jugador) : null,
        tipo: b.dataset.tipo,
        valor: 1,
        minuto: cont.querySelector(`.minuto-evento[data-equipo="${b.dataset.equipo}"]`)?.value || null,
        periodo: p.periodo
      });
    });
  });

  // MVP
  cont.querySelectorAll('.mvp-btn').forEach((b) => {
    b.addEventListener('click', () => elegirMVP(p.id, Number(b.dataset.jugador)));
  });

  cont.querySelectorAll('.borrar-evento').forEach((b) => {
    b.addEventListener('click', () => borrarEvento(p.id, Number(b.dataset.evento)));
  });
}

function tipoEvento(tipoResultado) {
  if (tipoResultado === 'puntos') return 'canasta';
  if (tipoResultado === 'sets') return 'set';
  return 'gol';
}

/** Iconos por tipo de evento. */
const TIPOS_ICONO = {
  gol: '⚽',
  punto: '🏀',
  canasta: '🏀',
  set: '🏐',
  tanto: '🏆',
  asistencia: '🅰️',
  amarilla: '🟨',
  roja: '🟥'
};

let intervaloReloj = null;

/** Hace avanzar el reloj en pantalla cada segundo si el cronómetro está activo. */
function iniciarRelojVivo() {
  if (intervaloReloj) { clearInterval(intervaloReloj); intervaloReloj = null; }
  const el = document.getElementById('reloj-vivo');
  if (!el) return;
  let segundos = Number(el.dataset.segundos) || 0;
  const activo = el.dataset.activo === '1';
  const pintar = () => {
    el.textContent = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
  };
  pintar();
  if (!activo) return;
  intervaloReloj = setInterval(() => {
    segundos++;
    pintar();
  }, 1000);
}

async function accionCronometro(partidoId, accion) {
  try {
    await api(`/partidos/${partidoId}/cronometro`, { method: 'POST', body: JSON.stringify({ accion }) });
    await abrirConsolaVivo(partidoId);
  } catch (err) { aviso(err.message, 'error'); }
}

async function elegirMVP(partidoId, jugadorId) {
  try {
    await api(`/partidos/${partidoId}/mvp`, { method: 'POST', body: JSON.stringify({ jugador_id: jugadorId }) });
    await abrirConsolaVivo(partidoId);
  } catch (err) { aviso(err.message, 'error'); }
}

async function accionVivo(partidoId, accion, extra = {}) {
  try {
    if (accion === 'iniciar') {
      await api(`/partidos/${partidoId}/iniciar`, { method: 'POST' });
    } else {
      await api(`/partidos/${partidoId}/estado`, { method: 'POST', body: JSON.stringify(extra) });
    }
    aviso('Actualizado');
    await abrirConsolaVivo(partidoId);
  } catch (err) { aviso(err.message, 'error'); }
}

async function registrarEvento(partidoId, evento) {
  try {
    await api(`/partidos/${partidoId}/evento`, { method: 'POST', body: JSON.stringify(evento) });
    await abrirConsolaVivo(partidoId);
  } catch (err) { aviso(err.message, 'error'); }
}

async function borrarEvento(partidoId, eventoId) {
  try {
    await api(`/partidos/${partidoId}/evento/${eventoId}`, { method: 'DELETE' });
    await abrirConsolaVivo(partidoId);
  } catch (err) { aviso(err.message, 'error'); }
}

// ---------------------------------------------------------------------------
// Tab: municipios
// ---------------------------------------------------------------------------

async function tabMunicipios(cont) {
  const municipios = await api('/municipios');
  estado.municipios = municipios;

  cont.innerHTML = `
    <div class="tabla-envoltorio" style="padding:18px">
      <h3 style="margin-top:0">Nuevo municipio</h3>
      <form class="formulario" id="form-municipio">
        <div class="fila">
          <div class="campo"><label>Nombre del municipio</label><input name="nombre" required placeholder="Ej: Alicante"></div>
          <div class="campo" style="justify-content:flex-end"><button class="btn" type="submit">Añadir municipio</button></div>
        </div>
      </form>
    </div>

    <div class="tabla-envoltorio">
      <table>
        <thead><tr><th class="equipo">Municipio</th><th>Competiciones</th><th></th></tr></thead>
        <tbody>
          ${municipios.length ? municipios.map((m) => `
            <tr>
              <td class="equipo">📍 ${esc(m.nombre)}</td>
              <td>${m.num_competiciones}</td>
              <td class="acciones">
                <button class="btn peligro pequeno" data-borrar-mun="${m.id}" ${m.num_competiciones ? 'disabled title="Tiene competiciones asociadas"' : ''}>Borrar</button>
              </td>
            </tr>`).join('') : '<tr><td colspan="3" class="vacio">No hay municipios</td></tr>'}
        </tbody>
      </table>
    </div>`;

  document.getElementById('form-municipio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/municipios', { method: 'POST', body: JSON.stringify({ nombre: f.get('nombre') }) });
      aviso('Municipio añadido');
      tabMunicipios(cont);
    } catch (err) { aviso(err.message, 'error'); }
  });

  cont.querySelectorAll('[data-borrar-mun]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar este municipio?')) return;
      try {
        await api('/municipios/' + b.dataset.borrarMun, { method: 'DELETE' });
        aviso('Municipio borrado');
        tabMunicipios(cont);
      } catch (err) { aviso(err.message, 'error'); }
    });
  });
}

// ---------------------------------------------------------------------------
// Tab: registrar resultado
// ---------------------------------------------------------------------------

async function tabResultados(cont) {
  await cargarCompeticiones();
  cont.innerHTML = `
    <div class="panel-filtros">
      <div class="campo" style="grid-column:1/-1">
        <label>Competición</label>
        <select id="sel-comp-res">
          ${estado.competiciones.map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.deporte)} · ${esc(c.temporada)}</option>`).join('')}
        </select>
      </div>
      <div class="campo" style="grid-column:1/-1">
        <label>Partido</label>
        <select id="sel-partido-res"><option value="">Cargando…</option></select>
      </div>
    </div>
    <div id="partidos-res"></div>`;

  const selComp = document.getElementById('sel-comp-res');
  const selPartido = document.getElementById('sel-partido-res');
  selComp.addEventListener('change', () => cargarListaPartidosRes(selComp.value));
  selPartido.addEventListener('change', () => abrirResultado(Number(selPartido.value)));

  if (estado.competiciones.length) cargarListaPartidosRes(selComp.value);
  else cont.querySelector('#partidos-res').innerHTML = '<div class="vacio">Crea primero una competición.</div>';
}

async function cargarListaPartidosRes(competicionId) {
  const sel = document.getElementById('sel-partido-res');
  const cont = document.getElementById('partidos-res');
  sel.innerHTML = '<option value="">Cargando…</option>';
  cont.innerHTML = '';
  try {
    const partidos = await api('/competiciones/' + competicionId + '/partidos');
    if (!partidos.length) {
      sel.innerHTML = '<option value="">Sin partidos. Genera el calendario primero.</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Selecciona un partido —</option>' + partidos.map((p) => {
      const marca = p.jugado ? '✅' : '📅';
      return `<option value="${p.id}">${marca} J${p.jornada} · ${esc(p.local)} vs ${esc(p.visitante)}${p.fecha ? ' · ' + p.fecha : ''}</option>`;
    }).join('');
  } catch (err) {
    sel.innerHTML = `<option value="">${esc(err.message)}</option>`;
  }
}

async function abrirResultado(partidoId) {
  const cont = document.getElementById('partidos-res');
  if (!partidoId) { cont.innerHTML = ''; return; }
  cont.innerHTML = '<div class="cargando"><div class="spinner"></div></div>';
  try {
    const detalle = await api(`/partidos/${partidoId}/detalle`);
    pintarResultado(detalle);
  } catch (err) {
    cont.innerHTML = `<div class="aviso error">${esc(err.message)}</div>`;
  }
}

function pintarResultado(detalle) {
  const cont = document.getElementById('partidos-res');
  if (!cont) return;
  const p = detalle.partido;
  const seg = p.segundos || 0;
  const reloj = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
  const tipoAnot = p.tipo_resultado === 'puntos' ? 'Puntos' : p.tipo_resultado === 'sets' ? 'Puntos de set' : 'Goles';

  // Mapa de estadísticas existentes por jugador
  const est = new Map();
  for (const e of detalle.estadisticas || []) {
    est.set(e.jugador_id, {
      anotacion: e.anotacion || 0,
      asistencias: e.asistencias || 0,
      amarillas: e.amarillas || 0,
      rojas: e.rojas || 0
    });
  }

  const jugadoresPorEquipo = (eqId) => detalle.jugadores.filter((j) => j.equipo_id === eqId);
  const filaJugador = (j) => {
    const s = est.get(j.id) || { anotacion: 0, asistencias: 0, amarillas: 0, rojas: 0 };
    return `
      <tr data-jugador="${j.id}" data-equipo="${j.equipo_id}">
        <td class="equipo">${j.dorsal ? '#' + j.dorsal + ' ' : ''}${esc(j.nombre)}</td>
        <td><input class="res-anot" type="number" min="0" value="${s.anotacion}" style="width:64px;text-align:center"></td>
        <td><input class="res-asist" type="number" min="0" value="${s.asistencias}" style="width:64px;text-align:center"></td>
        <td><input class="res-am" type="number" min="0" value="${s.amarillas}" style="width:64px;text-align:center"></td>
        <td><input class="res-ro" type="number" min="0" value="${s.rojas}" style="width:64px;text-align:center"></td>
      </tr>`;
  };

  cont.innerHTML = `
    <div class="tabla-envoltorio" style="padding:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <strong>Jornada ${p.jornada} · ${esc(p.competicion)}</strong>
        <span>
          ${p.estado === 'finalizado' ? '<span class="etiqueta gris">✅ Finalizado</span>' : p.estado === 'en_vivo' ? '<span class="etiqueta">🔴 En vivo</span>' : '<span class="etiqueta gris">📅 Programado</span>'}
          <span class="etiqueta gris">⏱ ${reloj}</span>
        </span>
      </div>

      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-bottom:18px">
        <div style="text-align:right;font-weight:700">${esc(p.local)}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="res-local" type="number" min="0" value="${p.puntos_local ?? 0}" style="width:70px;text-align:center;font-weight:800;font-size:1.2rem">
          <span style="font-weight:800">-</span>
          <input id="res-visitante" type="number" min="0" value="${p.puntos_visitante ?? 0}" style="width:70px;text-align:center;font-weight:800;font-size:1.2rem">
        </div>
        <div style="font-weight:700">${esc(p.visitante)}</div>
      </div>

      <h4 style="margin:0 0 8px">Estadísticas del partido</h4>
      <p style="color:var(--texto-suave);font-size:0.82rem;margin-top:0">
        Edita la aportación de cada jugador. El marcador se calcula automáticamente desde la columna «${tipoAnot}».
      </p>

      <div class="tabla-envoltorio" style="box-shadow:none;margin-bottom:18px">
        <table style="min-width:520px">
          <thead>
            <tr>
              <th class="equipo">Jugador</th>
              <th>${tipoAnot}</th><th>🅰️ Asist.</th><th>🟨</th><th>🟥</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="5" style="background:#f8fafc;font-weight:700;text-align:left;padding-left:16px">${esc(p.local)}</td></tr>
            ${jugadoresPorEquipo(p.local_id).map(filaJugador).join('') || '<tr><td colspan="5" class="vacio">Sin jugadores registrados.</td></tr>'}
            <tr><td colspan="5" style="background:#f8fafc;font-weight:700;text-align:left;padding-left:16px">${esc(p.visitante)}</td></tr>
            ${jugadoresPorEquipo(p.visitante_id).map(filaJugador).join('') || '<tr><td colspan="5" class="vacio">Sin jugadores registrados.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${detalle.eventos.length ? `
      <h4 style="margin:0 0 8px">Registro de eventos</h4>
      <div style="max-height:200px;overflow-y:auto;margin-bottom:16px">
        ${detalle.eventos.map((ev) => {
          const icono = TIPOS_ICONO[ev.tipo] || '•';
          const nombreEquipo = ev.equipo_id === p.local_id ? p.local : p.visitante;
          return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:0.88rem">
            <span style="width:30px;color:var(--texto-suave)">${ev.minuto != null ? ev.minuto + "'" : '—'}</span>
            <span>${icono}</span>
            <span style="flex:1"><strong>${esc(ev.jugador || 'Sin jugador')}</strong> <span style="color:var(--texto-suave)">(${esc(nombreEquipo)})</span></span>
            <span style="color:var(--texto-suave)">${ev.tipo}${ev.valor > 1 ? ' ×' + ev.valor : ''}</span>
          </div>`;
        }).join('')}
      </div>` : ''}

      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" id="btn-guardar-res">💾 Guardar y finalizar</button>
        <button class="btn secundario" id="btn-guardar-borrador">Guardar sin finalizar</button>
        <span style="color:var(--texto-suave);font-size:0.82rem">El marcador se recalcula solo desde las estadísticas.</span>
      </div>
    </div>`;

  // Recalcula el marcador al cambiar anotaciones
  const recalcular = () => {
    let gl = 0, gv = 0;
    cont.querySelectorAll('tr[data-jugador]').forEach((tr) => {
      const v = Number(tr.querySelector('.res-anot').value) || 0;
      if (Number(tr.dataset.equipo) === p.local_id) gl += v; else gv += v;
    });
    cont.querySelector('#res-local').value = gl;
    cont.querySelector('#res-visitante').value = gv;
  };
  cont.querySelectorAll('.res-anot').forEach((inp) => inp.addEventListener('input', recalcular));

  document.getElementById('btn-guardar-res').addEventListener('click', () => guardarResultado(p, cont, true));
  document.getElementById('btn-guardar-borrador').addEventListener('click', () => guardarResultado(p, cont, false));
}

function guardarResultado(p, cont, finalizar) {
  // Convierte la tabla de estadísticas en eventos del partido
  const eventos = [];
  cont.querySelectorAll('tr[data-jugador]').forEach((tr) => {
    const jugadorId = Number(tr.dataset.jugador);
    const equipoId = Number(tr.dataset.equipo);
    const anot = Number(tr.querySelector('.res-anot').value) || 0;
    const asist = Number(tr.querySelector('.res-asist').value) || 0;
    const am = Number(tr.querySelector('.res-am').value) || 0;
    const ro = Number(tr.querySelector('.res-ro').value) || 0;
    const tipoAnot = tipoEvento(p.tipo_resultado);
    if (anot > 0) eventos.push({ equipo_id: equipoId, jugador_id: jugadorId, tipo: tipoAnot, valor: anot });
    for (let i = 0; i < asist; i++) eventos.push({ equipo_id: equipoId, jugador_id: jugadorId, tipo: 'asistencia', valor: 1 });
    for (let i = 0; i < am; i++) eventos.push({ equipo_id: equipoId, jugador_id: jugadorId, tipo: 'amarilla', valor: 1 });
    for (let i = 0; i < ro; i++) eventos.push({ equipo_id: equipoId, jugador_id: jugadorId, tipo: 'roja', valor: 1 });
  });

  const puntosLocal = Number(cont.querySelector('#res-local').value) || 0;
  const puntosVisitante = Number(cont.querySelector('#res-visitante').value) || 0;

  return api('/resultados', {
    method: 'POST',
    body: JSON.stringify({
      partido_id: p.id,
      puntos_local: puntosLocal,
      puntos_visitante: puntosVisitante,
      estado: finalizar ? 'finalizado' : p.estado,
      eventos
    })
  }).then(() => {
    aviso(finalizar ? 'Resultado guardado y partido finalizado' : 'Estadísticas guardadas');
    return abrirResultado(p.id);
  }).catch((err) => aviso(err.message, 'error'));
}

iniciar();
