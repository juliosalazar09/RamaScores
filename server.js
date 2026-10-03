'use strict';

/**
 * Servidor HTTP sin dependencias externas.
 * - Sirve los archivos estaticos de /public
 * - Expone la API REST bajo /api
 * - Panel de administracion protegido con usuario/contrasena
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { db } = require('./db');
const {
  getClasificacion,
  getEstadisticasJugadores,
  getSanciones,
  getResumenCompeticion,
  recalcularMarcador,
  getPartidoDetalle,
  getEnVivo,
  calcularCronometro
} = require('./stats');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Credenciales del administrador (cambiables por variables de entorno).
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// Sesiones en memoria: token -> { usuario, creado }
const sesiones = new Map();
const DURACION_SESION = 1000 * 60 * 60 * 8; // 8 horas

// ---------------------------------------------------------------------------
// Server-Sent Events (tiempo real sin dependencias)
// ---------------------------------------------------------------------------

const sseClientes = new Set();

function emitir(evento, datos) {
  const payload = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const res of sseClientes) {
    try {
      res.write(payload);
    } catch {
      sseClientes.delete(res);
    }
  }
}

function abrirSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': conectado\n\n');
  sseClientes.add(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
      sseClientes.delete(res);
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClientes.delete(res);
  });
}

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    let tam = 0;
    req.on('data', (chunk) => {
      tam += chunk.length;
      if (tam > 1e6) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      datos += chunk;
    });
    req.on('end', () => {
      if (!datos) return resolve({});
      try {
        resolve(JSON.parse(datos));
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const cab = req.headers['authorization'] || '';
  if (cab.startsWith('Bearer ')) return cab.slice(7);
  return null;
}

function sesionValida(req) {
  const token = getToken(req);
  if (!token) return null;
  const sesion = sesiones.get(token);
  if (!sesion) return null;
  if (Date.now() - sesion.creado > DURACION_SESION) {
    sesiones.delete(token);
    return null;
  }
  return sesion;
}

function requiereAdmin(req, res) {
  const sesion = sesionValida(req);
  if (!sesion) {
    json(res, 401, { error: 'No autorizado. Inicia sesion.' });
    return null;
  }
  return sesion;
}

/** Baraja un array (Fisher-Yates) devolviendo una copia. */
function barajar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Generador de calendario aleatorio (round-robin)
// ---------------------------------------------------------------------------

/**
 * Crea un calendario todos-contra-todos con sorteo aleatorio:
 * - Se barajan los equipos.
 * - En cada jornada se sortea qué equipo juega en casa.
 * - Con `dobleVuelta` se genera también la vuelta con los campos invertidos.
 * Devuelve el número de partidos creados.
 */
function crearCalendarioAleatorio(competicionId, equipos, opciones) {
  const { fechaInicio, diasEntreJornadas, dobleVuelta } = opciones;

  // Barajado Fisher-Yates
  const lista = equipos.map((e) => e.id);
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  if (lista.length % 2 !== 0) lista.push(null); // descanso

  const n = lista.length;
  const rondas = n - 1;
  const porJornada = n / 2;
  const jornadas = [];

  // Algoritmo del círculo (Berger)
  for (let r = 0; r < rondas; r++) {
    const enfrentamientos = [];
    for (let i = 0; i < porJornada; i++) {
      const a = lista[i];
      const b = lista[n - 1 - i];
      if (a === null || b === null) continue;
      // Sorteo de localía
      enfrentamientos.push(Math.random() < 0.5 ? [a, b] : [b, a]);
    }
    jornadas.push(enfrentamientos);
    lista.splice(1, 0, lista.pop());
  }

  const insertar = db.prepare(
    `INSERT INTO partidos (competicion_id, jornada, fecha, local_id, visitante_id)
     VALUES (?, ?, date(?, '+' || ? || ' days'), ?, ?)`
  );

  let total = 0;
  let jornadaNum = 0;

  const escribirJornada = (jornada, enfrentamientos, offset) => {
    const fecha = fechaInicio;
    const dias = (jornada - 1) * diasEntreJornadas + offset;
    for (const [local, visitante] of enfrentamientos) {
      insertar.run(competicionId, jornada, fecha, dias, local, visitante);
      total++;
    }
  };

  for (const enfrentamientos of jornadas) {
    jornadaNum++;
    escribirJornada(jornadaNum, enfrentamientos, 0);
  }

  if (dobleVuelta) {
    for (const enfrentamientos of jornadas) {
      jornadaNum++;
      const invertidos = enfrentamientos.map(([l, v]) => [v, l]);
      escribirJornada(jornadaNum, invertidos, 0);
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Rutas de la API
// ---------------------------------------------------------------------------

async function api(req, res, url) {
  const partes = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const metodo = req.method;

  // --- Autenticacion ---
  if (partes[0] === 'login' && metodo === 'POST') {
    const body = await leerBody(req);
    if (body.usuario === ADMIN_USER && body.password === ADMIN_PASS) {
      const token = crypto.randomBytes(24).toString('hex');
      sesiones.set(token, { usuario: ADMIN_USER, creado: Date.now() });
      return json(res, 200, { token, usuario: ADMIN_USER });
    }
    return json(res, 401, { error: 'Usuario o contrasena incorrectos' });
  }

  if (partes[0] === 'logout' && metodo === 'POST') {
    const token = getToken(req);
    if (token) sesiones.delete(token);
    return json(res, 200, { ok: true });
  }

  // --- Tiempo real (Server-Sent Events) ---
  if (partes[0] === 'envivo' && partes[1] === 'stream' && metodo === 'GET') {
    return abrirSSE(req, res);
  }

  // --- Partidos en vivo (público) ---
  if (partes[0] === 'envivo' && metodo === 'GET') {
    return json(res, 200, getEnVivo());
  }

  // --- Catalogos ---
  if (partes[0] === 'deportes' && metodo === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM deportes ORDER BY id').all());
  }

  // Municipios: listar, crear y borrar
  if (partes[0] === 'municipios') {
    if (metodo === 'GET') {
      return json(
        res,
        200,
        db
          .prepare(
            `SELECT m.*,
                    (SELECT COUNT(*) FROM competiciones c WHERE c.municipio_id = m.id) AS num_competiciones
             FROM municipios m ORDER BY m.nombre`
          )
          .all()
      );
    }
    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const nombre = String(b.nombre || '').trim();
      if (!nombre) return json(res, 400, { error: 'El nombre es obligatorio' });
      try {
        const info = db.prepare('INSERT INTO municipios (nombre) VALUES (?)').run(nombre);
        return json(res, 201, { id: Number(info.lastInsertRowid), nombre });
      } catch {
        return json(res, 409, { error: 'Ese municipio ya existe' });
      }
    }
    if (metodo === 'DELETE' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      const id = Number(partes[1]);
      const enUso = db.prepare('SELECT COUNT(*) AS n FROM competiciones WHERE municipio_id = ?').get(id).n;
      if (enUso) return json(res, 409, { error: 'No se puede borrar: hay competiciones en este municipio' });
      db.prepare('DELETE FROM municipios WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  // Temporadas: listar y crear
  if (partes[0] === 'temporadas') {
    if (metodo === 'GET') {
      return json(res, 200, db.prepare('SELECT * FROM temporadas ORDER BY nombre DESC').all());
    }
    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const nombre = String(b.nombre || '').trim();
      if (!nombre) return json(res, 400, { error: 'El nombre es obligatorio' });
      try {
        const info = db.prepare('INSERT INTO temporadas (nombre) VALUES (?)').run(nombre);
        return json(res, 201, { id: Number(info.lastInsertRowid), nombre });
      } catch {
        return json(res, 409, { error: 'Esa temporada ya existe' });
      }
    }
  }

  // Categorias: listar y crear
  if (partes[0] === 'categorias') {
    if (metodo === 'GET') {
      return json(res, 200, db.prepare('SELECT * FROM categorias ORDER BY nombre').all());
    }
    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const nombre = String(b.nombre || '').trim();
      if (!nombre) return json(res, 400, { error: 'El nombre es obligatorio' });
      try {
        const info = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(nombre);
        return json(res, 201, { id: Number(info.lastInsertRowid), nombre });
      } catch {
        return json(res, 409, { error: 'Esa categoría ya existe' });
      }
    }
  }

  // --- Competiciones ---
  if (partes[0] === 'competiciones') {
    if (partes.length === 1 && metodo === 'GET') {
      const filtros = [];
      const valores = [];
      for (const campo of ['deporte', 'municipio', 'temporada', 'categoria']) {
        const valor = url.searchParams.get(campo);
        if (valor) {
          filtros.push(`${{ deporte: 'd.slug', municipio: 'm.id', temporada: 't.id', categoria: 'cat.id' }[campo]} = ?`);
          valores.push(valor);
        }
      }
      const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
      const filas = db
        .prepare(
          `SELECT c.id, c.nombre, c.activa,
                  d.slug AS deporte_slug, d.nombre AS deporte, d.tipo_resultado, d.color,
                  m.nombre AS municipio, t.nombre AS temporada, cat.nombre AS categoria,
                  (SELECT COUNT(*) FROM equipos e WHERE e.competicion_id = c.id) AS num_equipos
           FROM competiciones c
           JOIN deportes d ON d.id = c.deporte_id
           LEFT JOIN municipios m ON m.id = c.municipio_id
           JOIN temporadas t ON t.id = c.temporada_id
           LEFT JOIN categorias cat ON cat.id = c.categoria_id
           ${where}
           ORDER BY d.id, m.nombre, c.nombre`
        )
        .all(...valores);
      return json(res, 200, filas);
    }

    if (partes.length === 2 && metodo === 'GET') {
      const resumen = getResumenCompeticion(Number(partes[1]));
      if (!resumen) return json(res, 404, { error: 'Competicion no encontrada' });
      return json(res, 200, resumen);
    }

    if (partes[2] === 'clasificacion' && metodo === 'GET') {
      const data = getClasificacion(Number(partes[1]));
      if (!data) return json(res, 404, { error: 'Competicion no encontrada' });
      return json(res, 200, data);
    }

    if (partes[2] === 'jugadores' && metodo === 'GET') {
      const limite = Number(url.searchParams.get('limite')) || 50;
      const data = getEstadisticasJugadores(Number(partes[1]), limite);
      if (!data) return json(res, 404, { error: 'Competicion no encontrada' });
      return json(res, 200, data);
    }

    if (partes[2] === 'sanciones' && metodo === 'GET') {
      const deporte = getClasificacion(Number(partes[1]));
      if (!deporte) return json(res, 404, { error: 'Competicion no encontrada' });
      return json(res, 200, { filas: getSanciones(Number(partes[1])) });
    }

    // Generar plantillas de ejemplo para los equipos de la competicion
    if (partes[2] === 'generar-plantillas' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const competicionId = Number(partes[1]);
      const competicion = db.prepare('SELECT * FROM competiciones WHERE id = ?').get(competicionId);
      if (!competicion) return json(res, 404, { error: 'Competicion no encontrada' });

      const equipos = db
        .prepare('SELECT id, nombre FROM equipos WHERE competicion_id = ? ORDER BY nombre')
        .all(competicionId);
      if (!equipos.length) {
        return json(res, 400, { error: 'La competición no tiene equipos' });
      }

      const b = await leerBody(req);
      const porEquipo = Math.max(1, Math.min(30, Number(b.jugadores_por_equipo) || 12));
      const reemplazar = !!b.reemplazar;
      const posiciones = ['Portero', 'Defensa', 'Defensa', 'Centrocampista', 'Centrocampista', 'Delantero'];

      db.exec('BEGIN');
      try {
        const ins = db.prepare(
          'INSERT INTO jugadores (nombre, dorsal, posicion, equipo_id) VALUES (?, ?, ?, ?)'
        );
        let creados = 0;
        let equiposProcesados = 0;
        for (const equipo of equipos) {
          const yaTiene = db.prepare('SELECT COUNT(*) AS n FROM jugadores WHERE equipo_id = ?').get(equipo.id).n;
          if (yaTiene && !reemplazar) continue; // No tocar plantillas existentes
          if (reemplazar) {
            db.prepare('DELETE FROM jugadores WHERE equipo_id = ?').run(equipo.id);
          }
          // Nombre base a partir del equipo
          const base = equipo.nombre.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, '').trim().split(/\s+/)[0] || 'Jugador';
          const dorsales = barajar([...Array(30).keys()].map((n) => n + 1)).slice(0, porEquipo);
          for (let i = 0; i < porEquipo; i++) {
            ins.run(
              `${base} ${i + 1}`,
              dorsales[i],
              posiciones[i % posiciones.length],
              equipo.id
            );
            creados++;
          }
          equiposProcesados++;
        }
        db.exec('COMMIT');
        return json(res, 201, { ok: true, jugadores_creados: creados, equipos_procesados: equiposProcesados });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    if (partes[2] === 'partidos' && metodo === 'GET') {
      const jornada = url.searchParams.get('jornada');
      const params = [Number(partes[1])];
      let where = 'WHERE p.competicion_id = ?';
      if (jornada) {
        where += ' AND p.jornada = ?';
        params.push(Number(jornada));
      }
      const filas = db
        .prepare(
          `SELECT p.*, el.nombre AS local, ev.nombre AS visitante
           FROM partidos p
           JOIN equipos el ON el.id = p.local_id
           JOIN equipos ev ON ev.id = p.visitante_id
           ${where}
           ORDER BY p.jornada, p.fecha, p.id`
        )
        .all(...params);
      return json(res, 200, filas);
    }

    // Calendario aleatorio (round-robin) para la competicion
    if (partes[2] === 'generar-calendario' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const competicionId = Number(partes[1]);
      const competicion = db.prepare('SELECT * FROM competiciones WHERE id = ?').get(competicionId);
      if (!competicion) return json(res, 404, { error: 'Competicion no encontrada' });

      const equipos = db
        .prepare('SELECT id, nombre FROM equipos WHERE competicion_id = ?')
        .all(competicionId);
      if (equipos.length < 2) {
        return json(res, 400, { error: 'Se necesitan al menos 2 equipos para generar el calendario' });
      }

      const b = await leerBody(req);
      const fechaInicio = b.fecha_inicio || new Date().toISOString().slice(0, 10);
      const diasEntreJornadas = Math.max(1, Number(b.dias_entre_jornadas) || 7);
      const dobleVuelta = !!b.doble_vuelta;
      const reemplazar = !!b.reemplazar;

      db.exec('BEGIN');
      try {
        if (reemplazar) {
          db.prepare('DELETE FROM partidos WHERE competicion_id = ?').run(competicionId);
        }
        const total = crearCalendarioAleatorio(competicionId, equipos, {
          fechaInicio,
          diasEntreJornadas,
          dobleVuelta
        });
        db.exec('COMMIT');
        return json(res, 201, { ok: true, partidos_creados: total });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    if (metodo === 'POST' && partes.length === 1) {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const info = db
        .prepare(
          `INSERT INTO competiciones (nombre, deporte_id, municipio_id, temporada_id, categoria_id, activa)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(b.nombre, b.deporte_id, b.municipio_id || null, b.temporada_id, b.categoria_id || null, b.activa ?? 1);
      return json(res, 201, { id: Number(info.lastInsertRowid) });
    }

    if (metodo === 'DELETE' && partes.length === 2) {
      if (!requiereAdmin(req, res)) return;
      db.prepare('DELETE FROM competiciones WHERE id = ?').run(Number(partes[1]));
      return json(res, 200, { ok: true });
    }
  }

  // --- Equipos ---
  if (partes[0] === 'equipos') {
    // Listado por competicion: /api/equipos?competicion_id=N
    if (metodo === 'GET' && !partes[1] && url.searchParams.get('competicion_id')) {
      const filas = db
        .prepare('SELECT * FROM equipos WHERE competicion_id = ? ORDER BY nombre')
        .all(Number(url.searchParams.get('competicion_id')));
      return json(res, 200, filas);
    }
    if (metodo === 'GET' && partes[1]) {
      const equipo = db.prepare('SELECT * FROM equipos WHERE id = ?').get(Number(partes[1]));
      if (!equipo) return json(res, 404, { error: 'Equipo no encontrado' });
      return json(res, 200, equipo);
    }
    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const info = db
        .prepare('INSERT INTO equipos (nombre, competicion_id, localidad) VALUES (?, ?, ?)')
        .run(b.nombre, b.competicion_id, b.localidad || null);
      return json(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if (metodo === 'PUT' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      db.prepare('UPDATE equipos SET nombre = ?, localidad = ? WHERE id = ?')
        .run(b.nombre, b.localidad || null, Number(partes[1]));
      return json(res, 200, { ok: true });
    }
    if (metodo === 'DELETE' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      db.prepare('DELETE FROM equipos WHERE id = ?').run(Number(partes[1]));
      return json(res, 200, { ok: true });
    }
  }

  // --- Jugadores ---
  if (partes[0] === 'jugadores') {
    // Importacion masiva: /api/jugadores/importar
    if (partes[1] === 'importar' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const lista = Array.isArray(b.jugadores) ? b.jugadores : [];
      if (!lista.length) return json(res, 400, { error: 'No se recibieron jugadores' });

      // Mapa de equipos para resolver por nombre "Equipo 1, Nombre, Dorsal, Posicion"
      const equipos = db.prepare('SELECT id, nombre FROM equipos').all();
      const equipoPorNombre = new Map(equipos.map((e) => [e.nombre.toLowerCase(), e.id]));

      db.exec('BEGIN');
      try {
        const ins = db.prepare(
          'INSERT INTO jugadores (nombre, dorsal, posicion, equipo_id) VALUES (?, ?, ?, ?)'
        );
        let creados = 0;
        const errores = [];
        lista.forEach((j, i) => {
          const fila = i + 1;
          const nombre = String(j.nombre || '').trim();
          if (!nombre) { errores.push(`Fila ${fila}: falta el nombre`); return; }
          let equipoId = j.equipo_id ? Number(j.equipo_id) : null;
          if (!equipoId && j.equipo) {
            equipoId = equipoPorNombre.get(String(j.equipo).trim().toLowerCase()) || null;
          }
          if (!equipoId) { errores.push(`Fila ${fila}: equipo no encontrado (${j.equipo || 'sin equipo'})`); return; }
          const dorsal = j.dorsal !== '' && j.dorsal != null ? Number(j.dorsal) : null;
          ins.run(nombre, Number.isFinite(dorsal) ? dorsal : null, j.posicion || null, equipoId);
          creados++;
        });
        db.exec('COMMIT');
        return json(res, 201, { ok: true, jugadores_creados: creados, errores });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    if (metodo === 'GET' && partes[1]) {
      const filas = db
        .prepare(
          `SELECT j.*, e.nombre AS equipo FROM jugadores j
           JOIN equipos e ON e.id = j.equipo_id
           WHERE j.equipo_id = ? ORDER BY j.dorsal, j.nombre`
        )
        .all(Number(partes[1]));
      return json(res, 200, filas);
    }
    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const info = db
        .prepare('INSERT INTO jugadores (nombre, dorsal, posicion, equipo_id) VALUES (?, ?, ?, ?)')
        .run(b.nombre, b.dorsal || null, b.posicion || null, b.equipo_id);
      return json(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if (metodo === 'PUT' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      db.prepare('UPDATE jugadores SET nombre = ?, dorsal = ?, posicion = ? WHERE id = ?')
        .run(b.nombre, b.dorsal || null, b.posicion || null, Number(partes[1]));
      return json(res, 200, { ok: true });
    }
    if (metodo === 'DELETE' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      db.prepare('DELETE FROM jugadores WHERE id = ?').run(Number(partes[1]));
      return json(res, 200, { ok: true });
    }
  }

  // --- Partidos ---
  if (partes[0] === 'partidos') {
    const partidoId = Number(partes[1]);

    // Detalle para la consola en vivo (publico)
    if (partes[2] === 'detalle' && metodo === 'GET') {
      const detalle = getPartidoDetalle(partidoId);
      if (!detalle) return json(res, 404, { error: 'Partido no encontrado' });
      return json(res, 200, detalle);
    }

    // Iniciar partido en vivo (arranca el cronómetro)
    if (partes[2] === 'iniciar' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return json(res, 404, { error: 'Partido no encontrado' });
      db.prepare(
        `UPDATE partidos SET estado = 'en_vivo',
                             iniciado_en = COALESCE(iniciado_en, datetime('now')),
                             cronometro_inicio = datetime('now'),
                             cronometro_activo = 1,
                             actualizado_en = datetime('now') WHERE id = ?`
      ).run(partidoId);
      emitir('envivo', { accion: 'iniciado', partido_id: partidoId });
      return json(res, 200, getPartidoDetalle(partidoId));
    }

    // Cronómetro: pausar / reanudar / reiniciar
    if (partes[2] === 'cronometro' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return json(res, 404, { error: 'Partido no encontrado' });
      const b = await leerBody(req);
      const accion = b.accion;

      if (accion === 'pausar') {
        // Guarda lo transcurrido y detiene
        const segundos = calcularCronometro(partido);
        db.prepare(
          `UPDATE partidos SET cronometro_acumulado = ?, cronometro_activo = 0,
                               cronometro_inicio = NULL, actualizado_en = datetime('now') WHERE id = ?`
        ).run(segundos, partidoId);
      } else if (accion === 'reanudar') {
        db.prepare(
          `UPDATE partidos SET cronometro_inicio = datetime('now'), cronometro_activo = 1,
                               actualizado_en = datetime('now') WHERE id = ?`
        ).run(partidoId);
      } else if (accion === 'reiniciar') {
        db.prepare(
          `UPDATE partidos SET cronometro_acumulado = 0, cronometro_activo = 0,
                               cronometro_inicio = NULL, actualizado_en = datetime('now') WHERE id = ?`
        ).run(partidoId);
      } else if (accion === 'ajustar') {
        // Fija manualmente los segundos (por si se recupera un partido)
        const segundos = Math.max(0, Number(b.segundos) || 0);
        db.prepare(
          `UPDATE partidos SET cronometro_acumulado = ?, cronometro_activo = 0,
                               cronometro_inicio = NULL, actualizado_en = datetime('now') WHERE id = ?`
        ).run(segundos, partidoId);
      } else {
        return json(res, 400, { error: 'Acción de cronómetro no válida' });
      }
      const detalle = getPartidoDetalle(partidoId);
      emitir('envivo', { accion: 'cronometro', partido_id: partidoId });
      return json(res, 200, detalle);
    }

    // Designar MVP del partido
    if (partes[2] === 'mvp' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return json(res, 404, { error: 'Partido no encontrado' });
      const b = await leerBody(req);
      db.prepare('UPDATE partidos SET mvp_jugador_id = ?, actualizado_en = datetime(\'now\') WHERE id = ?')
        .run(b.jugador_id || null, partidoId);
      emitir('envivo', { accion: 'mvp', partido_id: partidoId });
      return json(res, 200, getPartidoDetalle(partidoId));
    }

    // Registrar un evento en vivo
    if (partes[2] === 'evento' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return json(res, 404, { error: 'Partido no encontrado' });
      const b = await leerBody(req);
      const equipoId = Number(b.equipo_id);
      if (equipoId !== partido.local_id && equipoId !== partido.visitante_id) {
        return json(res, 400, { error: 'El equipo no juega este partido' });
      }
      const tipo = b.tipo || 'gol';
      const valor = Number(b.valor) || 1;
      const info = db
        .prepare(
          `INSERT INTO partido_eventos (partido_id, equipo_id, jugador_id, tipo, valor, minuto, periodo)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(partidoId, equipoId, b.jugador_id || null, tipo, valor, b.minuto || null, b.periodo || null);
      recalcularMarcador(partidoId);
      const detalle = getPartidoDetalle(partidoId);
      emitir('envivo', { accion: 'evento', partido_id: partidoId, evento_id: Number(info.lastInsertRowid) });
      return json(res, 201, detalle);
    }

    // Borrar un evento (deshacer)
    if (partes[2] === 'evento' && metodo === 'DELETE' && partes[3]) {
      if (!requiereAdmin(req, res)) return;
      const evento = db
        .prepare('SELECT * FROM partido_eventos WHERE id = ? AND partido_id = ?')
        .get(Number(partes[3]), partidoId);
      if (!evento) return json(res, 404, { error: 'Evento no encontrado' });
      db.prepare('DELETE FROM partido_eventos WHERE id = ?').run(evento.id);
      recalcularMarcador(partidoId);
      const detalle = getPartidoDetalle(partidoId);
      emitir('envivo', { accion: 'evento_borrado', partido_id: partidoId });
      return json(res, 200, detalle);
    }

    // Cambiar estado: descanso / en_vivo / finalizado
    if (partes[2] === 'estado' && metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return json(res, 404, { error: 'Partido no encontrado' });
      const b = await leerBody(req);
      const estado = b.estado;
      if (!['programado', 'en_vivo', 'descanso', 'finalizado'].includes(estado)) {
        return json(res, 400, { error: 'Estado no válido' });
      }

      if (estado === 'finalizado') {
        db.exec('BEGIN');
        try {
          // Detiene el cronómetro
          const segundos = calcularCronometro(partido);

          // Vuelca los eventos de anotación a las estadísticas de jugador
          db.prepare('DELETE FROM estadisticas_partido WHERE partido_id = ?').run(partidoId);
          const anotadores = db
            .prepare(
              `SELECT jugador_id, minuto, valor FROM partido_eventos
               WHERE partido_id = ? AND jugador_id IS NOT NULL
                 AND tipo IN ('gol','punto','set','tanto','canasta')`
            )
            .all(partidoId);
          const ins = db.prepare(
            'INSERT INTO estadisticas_partido (partido_id, jugador_id, minuto, valor) VALUES (?, ?, ?, ?)'
          );
          for (const a of anotadores) ins.run(partidoId, a.jugador_id, a.minuto, a.valor);
          db.prepare(
            `UPDATE partidos SET estado = 'finalizado', jugado = 1, periodo = NULL,
                                 cronometro_acumulado = ?, cronometro_activo = 0,
                                 cronometro_inicio = NULL,
                                 actualizado_en = datetime('now') WHERE id = ?`
          ).run(segundos, partidoId);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      } else {
        const periodo = 'periodo' in b ? b.periodo : partido.periodo;
        // Al pasar a descanso se pausa el cronómetro automáticamente
        let acumulado = partido.cronometro_acumulado || 0;
        let activo = partido.cronometro_activo ? 1 : 0;
        let inicio = partido.cronometro_inicio;
        if (estado === 'descanso' && partido.cronometro_activo) {
          acumulado = calcularCronometro(partido);
          activo = 0;
          inicio = null;
        }
        db.prepare(
          `UPDATE partidos SET estado = ?, periodo = ?, cronometro_acumulado = ?,
                               cronometro_activo = ?, cronometro_inicio = ?,
                               actualizado_en = datetime('now') WHERE id = ?`
        ).run(estado, periodo ?? null, acumulado, activo, inicio, partidoId);
      }
      emitir('envivo', { accion: 'estado', partido_id: partidoId, estado });
      return json(res, 200, getPartidoDetalle(partidoId));
    }

    if (metodo === 'POST') {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      const info = db
        .prepare(
          `INSERT INTO partidos (competicion_id, jornada, fecha, local_id, visitante_id)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(b.competicion_id, b.jornada, b.fecha || null, b.local_id, b.visitante_id);
      return json(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if (metodo === 'PUT' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      const b = await leerBody(req);
      db.prepare(
        `UPDATE partidos SET jornada = ?, fecha = ?, local_id = ?, visitante_id = ? WHERE id = ?`
      ).run(b.jornada, b.fecha || null, b.local_id, b.visitante_id, Number(partes[1]));
      return json(res, 200, { ok: true });
    }
    if (metodo === 'DELETE' && partes[1]) {
      if (!requiereAdmin(req, res)) return;
      db.prepare('DELETE FROM partidos WHERE id = ?').run(Number(partes[1]));
      return json(res, 200, { ok: true });
    }
  }

  // --- Resultado de un partido + eventos ---
  if (partes[0] === 'resultados' && metodo === 'POST') {
    if (!requiereAdmin(req, res)) return;
    const b = await leerBody(req);
    const partidoId = Number(b.partido_id);
    const partido = db.prepare('SELECT * FROM partidos WHERE id = ?').get(partidoId);
    if (!partido) return json(res, 404, { error: 'Partido no encontrado' });

    db.exec('BEGIN');
    try {
      const estado = b.estado || 'finalizado';
      db.prepare(
        `UPDATE partidos SET puntos_local = ?, puntos_visitante = ?, jugado = ?,
                             estado = ?, actualizado_en = datetime('now') WHERE id = ?`
      ).run(
        Number(b.puntos_local),
        Number(b.puntos_visitante),
        estado === 'finalizado' ? 1 : 0,
        estado,
        partidoId
      );

      // Eventos del partido (goles, asistencias, tarjetas) si se envían.
      if (Array.isArray(b.eventos)) {
        db.prepare('DELETE FROM partido_eventos WHERE partido_id = ?').run(partidoId);
        const insEv = db.prepare(
          `INSERT INTO partido_eventos (partido_id, equipo_id, jugador_id, tipo, valor, minuto, periodo)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const ev of b.eventos) {
          insEv.run(
            partidoId,
            ev.equipo_id,
            ev.jugador_id || null,
            ev.tipo || 'gol',
            ev.valor || 1,
            ev.minuto ?? null,
            ev.periodo || null
          );
        }
      }

      // Sincroniza las estadísticas de jugador con el resultado final.
      if (estado === 'finalizado') {
        db.prepare('DELETE FROM estadisticas_partido WHERE partido_id = ?').run(partidoId);
        const insEst = db.prepare(
          'INSERT INTO estadisticas_partido (partido_id, jugador_id, minuto, valor) VALUES (?, ?, ?, ?)'
        );
        if (Array.isArray(b.eventos)) {
          // Se derivan de los eventos de anotación
          const anotadores = db
            .prepare(
              `SELECT jugador_id, minuto, valor FROM partido_eventos
               WHERE partido_id = ? AND jugador_id IS NOT NULL
                 AND tipo IN ('gol','punto','set','tanto','canasta')`
            )
            .all(partidoId);
          for (const a of anotadores) insEst.run(partidoId, a.jugador_id, a.minuto, a.valor);
        } else if (Array.isArray(b.estadisticas)) {
          for (const est of b.estadisticas) {
            if (!est.jugador_id) continue;
            insEst.run(partidoId, est.jugador_id, est.minuto ?? null, est.valor ?? 1);
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return json(res, 200, getPartidoDetalle(partidoId));
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// ---------------------------------------------------------------------------
// Archivos estaticos
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function servirEstatico(req, res, url) {
  let ruta = url.pathname === '/' ? '/index.html' : url.pathname;
  ruta = path.normalize(ruta).replace(/^(\.\.[/\\])+/, '');
  const archivo = path.join(PUBLIC_DIR, ruta);

  if (!archivo.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }

  fs.readFile(archivo, (err, contenido) => {
    if (err) {
      // Fallback SPA: cualquier ruta desconocida devuelve index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, index) => {
        if (e2) {
          res.writeHead(404);
          return res.end('No encontrado');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(index);
      });
      return;
    }
    const ext = path.extname(archivo).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(contenido);
  });
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS basico para desarrollo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (url.pathname.startsWith('/api')) {
      return await api(req, res, url);
    }
    return servirEstatico(req, res, url);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message || 'Error interno' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Servidor deportivo en http://localhost:${PORT}`);
  console.log(`  Panel admin en http://localhost:${PORT}/admin.html`);
  console.log(`  Usuario: ${ADMIN_USER} / Contrasena: ${ADMIN_PASS}\n`);
});
