'use strict';

/**
 * Logica de negocio: clasificaciones y estadisticas.
 * Se calcula todo a partir de los partidos jugados, usando la configuracion
 * de puntuacion de cada deporte.
 */

const { db } = require('./db');

function getDeportePorCompeticion(competicionId) {
  return db
    .prepare(
      `SELECT d.* FROM deportes d
       JOIN competiciones c ON c.deporte_id = d.id
       WHERE c.id = ?`
    )
    .get(competicionId);
}

/**
 * Devuelve la tabla de posiciones ordenada.
 * Calcula PJ, PG, PE, PP, AF, EC, DIF y PT a partir de los partidos jugados.
 */
function getClasificacion(competicionId) {
  const deporte = getDeportePorCompeticion(competicionId);
  if (!deporte) return null;

  const equipos = db
    .prepare('SELECT id, nombre, localidad FROM equipos WHERE competicion_id = ?')
    .all(competicionId);

  const tabla = new Map();
  for (const eq of equipos) {
    tabla.set(eq.id, {
      equipo_id: eq.id,
      nombre: eq.nombre,
      localidad: eq.localidad,
      pj: 0, pg: 0, pe: 0, pp: 0,
      af: 0, ec: 0, dif: 0, pt: 0,
      racha: []
    });
  }

  const partidos = db
    .prepare(
      `SELECT local_id, visitante_id, puntos_local, puntos_visitante, fecha
       FROM partidos
       WHERE competicion_id = ? AND jugado = 1
       ORDER BY fecha`
    )
    .all(competicionId);

  for (const p of partidos) {
    const local = tabla.get(p.local_id);
    const visitante = tabla.get(p.visitante_id);
    if (!local || !visitante) continue;

    const gl = p.puntos_local;
    const gv = p.puntos_visitante;

    local.pj += 1;
    visitante.pj += 1;
    local.af += gl;
    local.ec += gv;
    visitante.af += gv;
    visitante.ec += gl;

    if (gl > gv) {
      local.pg += 1;
      visitante.pp += 1;
      local.pt += deporte.puntos_victoria;
      visitante.pt += deporte.puntos_derrota;
      local.racha.push('V');
      visitante.racha.push('D');
    } else if (gv > gl) {
      visitante.pg += 1;
      local.pp += 1;
      visitante.pt += deporte.puntos_victoria;
      local.pt += deporte.puntos_derrota;
      visitante.racha.push('V');
      local.racha.push('D');
    } else {
      local.pe += 1;
      visitante.pe += 1;
      local.pt += deporte.puntos_empate;
      visitante.pt += deporte.puntos_empate;
      local.racha.push('E');
      visitante.racha.push('E');
    }
  }

  const filas = [...tabla.values()].map((f) => {
    f.dif = f.af - f.ec;
    f.ultimos5 = f.racha.slice(-5);
    delete f.racha;
    return f;
  });

  filas.sort((a, b) => b.pt - a.pt || b.dif - a.dif || b.af - a.af || a.nombre.localeCompare(b.nombre));
  filas.forEach((f, i) => { f.posicion = i + 1; });
  return { deporte, filas };
}

/**
 * Ranking de jugadores de una competicion segun el tipo de evento:
 * goles (futbol/sala), puntos (baloncesto o sets/aciertos).
 * Incluye tarjetas y una valoracion tipo MVP.
 */
function getEstadisticasJugadores(competicionId, limite = 50) {
  const deporte = getDeportePorCompeticion(competicionId);
  if (!deporte) return null;

  const filas = db
    .prepare(
      `SELECT j.id AS jugador_id, j.nombre, j.dorsal, j.posicion,
              e.nombre AS equipo,
              SUM(es.valor) AS total,
              COUNT(es.id) AS apariciones,
              COUNT(DISTINCT es.partido_id) AS partidos
       FROM estadisticas_partido es
       JOIN jugadores j ON j.id = es.jugador_id
       JOIN equipos e ON e.id = j.equipo_id
       JOIN partidos p ON p.id = es.partido_id
       WHERE p.competicion_id = ?
       GROUP BY j.id
       ORDER BY total DESC, partidos ASC, j.nombre
       LIMIT ?`
    )
    .all(competicionId, limite);

  // Tarjetas y valoracion por jugador (a partir de los eventos registrados)
  const tarjetas = new Map();
  const eventos = db
    .prepare(
      `SELECT e.jugador_id, e.tipo, e.valor
       FROM partido_eventos e
       JOIN partidos p ON p.id = e.partido_id
       WHERE p.competicion_id = ? AND e.jugador_id IS NOT NULL`
    )
    .all(competicionId);
  for (const ev of eventos) {
    if (!tarjetas.has(ev.jugador_id)) {
      tarjetas.set(ev.jugador_id, { amarillas: 0, rojas: 0, anotacion: 0 });
    }
    const t = tarjetas.get(ev.jugador_id);
    if (ev.tipo === 'amarilla') t.amarillas += 1;
    else if (ev.tipo === 'roja') t.rojas += 1;
    if (TIPOS_ANOTACION.has(ev.tipo)) t.anotacion += ev.valor;
  }

  for (const f of filas) {
    const t = tarjetas.get(f.jugador_id) || { amarillas: 0, rojas: 0 };
    f.amarillas = t.amarillas || 0;
    f.rojas = t.rojas || 0;
    f.media = f.partidos ? f.total / f.partidos : 0;
    // Valoracion MVP: anotaciones + partidos jugados - sanciones
    f.valoracion = f.total + f.partidos * 1 - f.amarillas * 1 - f.rojas * 3;
  }

  // Ranking MVP por valoracion
  const mvp = [...filas].sort((a, b) => b.valoracion - a.valoracion || a.nombre.localeCompare(b.nombre));

  return { deporte, filas, mvp };
}

/** Tabla de sanciones (amarillas y rojas) de una competicion. */
function getSanciones(competicionId) {
  const filas = db
    .prepare(
      `SELECT j.id AS jugador_id, j.nombre, j.dorsal, e.nombre AS equipo,
              SUM(CASE WHEN ev.tipo = 'amarilla' THEN 1 ELSE 0 END) AS amarillas,
              SUM(CASE WHEN ev.tipo = 'roja' THEN 1 ELSE 0 END) AS rojas
       FROM partido_eventos ev
       JOIN jugadores j ON j.id = ev.jugador_id
       JOIN equipos e ON e.id = j.equipo_id
       JOIN partidos p ON p.id = ev.partido_id
       WHERE p.competicion_id = ? AND ev.jugador_id IS NOT NULL
         AND ev.tipo IN ('amarilla','roja')
       GROUP BY j.id
       ORDER BY rojas DESC, amarillas DESC, j.nombre`
    )
    .all(competicionId);
  return filas;
}

/** Lista de equipos que mas y menos anotan en el torneo. */
function getResumenCompeticion(competicionId) {
  const clasificacion = getClasificacion(competicionId);
  if (!clasificacion) return null;

  const partidosTotales = db
    .prepare('SELECT COUNT(*) AS n FROM partidos WHERE competicion_id = ?')
    .get(competicionId).n;
  const jugados = db
    .prepare('SELECT COUNT(*) AS n FROM partidos WHERE competicion_id = ? AND jugado = 1')
    .get(competicionId).n;

  return {
    deporte: clasificacion.deporte,
    partidos_totales: partidosTotales,
    partidos_jugados: jugados,
    equipos: clasificacion.filas.length
  };
}

/** Tipos de evento que suman al marcador. */
const TIPOS_ANOTACION = new Set(['gol', 'punto', 'set', 'tanto', 'canasta']);

/** Convierte una fecha UTC de SQLite ("YYYY-MM-DD HH:MM:SS") en milisegundos. */
function fechaSQLaMs(valor) {
  if (!valor) return null;
  return new Date(valor.replace(' ', 'T') + 'Z').getTime();
}

/** Segundos transcurridos del cronómetro de un partido. */
function calcularCronometro(partido) {
  let seg = partido.cronometro_acumulado || 0;
  if (partido.cronometro_activo && partido.cronometro_inicio) {
    const inicio = fechaSQLaMs(partido.cronometro_inicio);
    if (inicio) seg += Math.floor((Date.now() - inicio) / 1000);
  }
  return Math.max(0, Math.floor(seg));
}

/**
 * Recalcula el marcador de un partido sumando los eventos de anotacion.
 * Es idempotente: el marcador siempre se deriva de los eventos registrados.
 */
function recalcularMarcador(partidoId) {
  const p = db.prepare('SELECT local_id, visitante_id FROM partidos WHERE id = ?').get(partidoId);
  if (!p) return null;
  const sumar = (equipoId) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(valor), 0) AS n FROM partido_eventos
         WHERE partido_id = ? AND equipo_id = ?
           AND tipo IN ('gol','punto','set','tanto','canasta')`
      )
      .get(partidoId, equipoId).n;
  const gl = sumar(p.local_id);
  const gv = sumar(p.visitante_id);
  db.prepare(
    `UPDATE partidos SET puntos_local = ?, puntos_visitante = ?,
                         actualizado_en = datetime('now') WHERE id = ?`
  ).run(gl, gv, partidoId);
  return { puntos_local: gl, puntos_visitante: gv };
}

/** Detalle completo de un partido para el panel en vivo. */
function getPartidoDetalle(partidoId) {
  const partido = db
    .prepare(
      `SELECT p.*, el.nombre AS local, ev.nombre AS visitante,
              d.tipo_resultado, d.nombre AS deporte, d.slug AS deporte_slug,
              c.nombre AS competicion
       FROM partidos p
       JOIN equipos el ON el.id = p.local_id
       JOIN equipos ev ON ev.id = p.visitante_id
       JOIN competiciones c ON c.id = p.competicion_id
       JOIN deportes d ON d.id = c.deporte_id
       WHERE p.id = ?`
    )
    .get(partidoId);
  if (!partido) return null;

  const eventos = db
    .prepare(
      `SELECT e.*, j.nombre AS jugador
       FROM partido_eventos e
       LEFT JOIN jugadores j ON j.id = e.jugador_id
       WHERE e.partido_id = ?
       ORDER BY e.id DESC`
    )
    .all(partidoId);

  const jugadores = db
    .prepare(
      `SELECT j.id, j.nombre, j.dorsal, j.equipo_id
       FROM jugadores j
       WHERE j.equipo_id IN (?, ?)
       ORDER BY j.equipo_id, j.dorsal, j.nombre`
    )
    .all(partido.local_id, partido.visitante_id);

  // Cronómetro y estadísticas individuales del partido
  const segundos = calcularCronometro(partido);
  let estadisticas = db
    .prepare(
      `SELECT e.jugador_id, j.nombre AS jugador, e.equipo_id,
              SUM(CASE WHEN e.tipo IN ('gol','punto','set','tanto','canasta') THEN e.valor ELSE 0 END) AS anotacion,
              SUM(CASE WHEN e.tipo = 'asistencia' THEN 1 ELSE 0 END) AS asistencias,
              SUM(CASE WHEN e.tipo = 'amarilla' THEN 1 ELSE 0 END) AS amarillas,
              SUM(CASE WHEN e.tipo = 'roja' THEN 1 ELSE 0 END) AS rojas
       FROM partido_eventos e
       LEFT JOIN jugadores j ON j.id = e.jugador_id
       WHERE e.partido_id = ? AND e.jugador_id IS NOT NULL
       GROUP BY e.jugador_id
       ORDER BY anotacion DESC, j.nombre`
    )
    .all(partidoId);

  // Si no hay eventos en vivo, se toman las estadísticas guardadas (resultados manuales o datos antiguos).
  if (!estadisticas.length) {
    estadisticas = db
      .prepare(
        `SELECT es.jugador_id, j.nombre AS jugador, j.equipo_id,
                SUM(es.valor) AS anotacion, 0 AS asistencias, 0 AS amarillas, 0 AS rojas
         FROM estadisticas_partido es
         JOIN jugadores j ON j.id = es.jugador_id
         WHERE es.partido_id = ?
         GROUP BY es.jugador_id
         ORDER BY anotacion DESC, j.nombre`
      )
      .all(partidoId);
  }

  return { partido: { ...partido, segundos }, eventos, jugadores, estadisticas };
}

/** Partidos en vivo, en descanso o finalizados recientemente. */
function getEnVivo(limite = 30) {
  const filas = db
    .prepare(
      `SELECT p.id, p.jornada, p.fecha, p.estado, p.periodo,
              p.puntos_local, p.puntos_visitante, p.iniciado_en, p.actualizado_en,
              p.cronometro_inicio, p.cronometro_acumulado, p.cronometro_activo,
              p.local_id, p.visitante_id,
              el.nombre AS local, ev.nombre AS visitante,
              d.tipo_resultado, d.nombre AS deporte, d.color,
              c.nombre AS competicion, c.id AS competicion_id,
              (SELECT COUNT(*) FROM partido_eventos e WHERE e.partido_id = p.id) AS num_eventos
       FROM partidos p
       JOIN equipos el ON el.id = p.local_id
       JOIN equipos ev ON ev.id = p.visitante_id
       JOIN competiciones c ON c.id = p.competicion_id
       JOIN deportes d ON d.id = c.deporte_id
       WHERE p.estado != 'programado'
       ORDER BY CASE p.estado WHEN 'en_vivo' THEN 0 WHEN 'descanso' THEN 1 ELSE 2 END,
                p.actualizado_en DESC
       LIMIT ?`
    )
    .all(limite);
  return filas.map((f) => ({ ...f, segundos: calcularCronometro(f) }));
}

module.exports = {
  TIPOS_ANOTACION,
  getDeportePorCompeticion,
  getClasificacion,
  getEstadisticasJugadores,
  getSanciones,
  getResumenCompeticion,
  recalcularMarcador,
  getPartidoDetalle,
  getEnVivo,
  calcularCronometro
};
