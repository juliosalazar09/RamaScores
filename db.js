'use strict';

/**
 * Base de datos SQLite (node:sqlite, incluido en Node 22).
 * Crea las tablas si no existen y carga datos de ejemplo la primera vez.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// La carpeta de datos se puede cambiar con la variable DATA_DIR para usar un
// disco persistente en el hosting (por ejemplo /var/data o /data).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'stats.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS deportes (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo_resultado TEXT NOT NULL,
  puntos_victoria INTEGER NOT NULL,
  puntos_empate INTEGER NOT NULL,
  puntos_derrota INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb'
);

CREATE TABLE IF NOT EXISTS municipios (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS temporadas (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categorias (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS competiciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  deporte_id    INTEGER NOT NULL REFERENCES deportes(id),
  municipio_id  INTEGER REFERENCES municipios(id),
  temporada_id  INTEGER NOT NULL REFERENCES temporadas(id),
  categoria_id  INTEGER REFERENCES categorias(id),
  activa        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS equipos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT NOT NULL,
  competicion_id INTEGER NOT NULL REFERENCES competiciones(id) ON DELETE CASCADE,
  localidad      TEXT
);

CREATE TABLE IF NOT EXISTS jugadores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  dorsal     INTEGER,
  posicion   TEXT,
  equipo_id  INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partidos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  competicion_id   INTEGER NOT NULL REFERENCES competiciones(id) ON DELETE CASCADE,
  jornada          INTEGER NOT NULL,
  fecha            TEXT,
  local_id         INTEGER NOT NULL REFERENCES equipos(id),
  visitante_id     INTEGER NOT NULL REFERENCES equipos(id),
  puntos_local     INTEGER,
  puntos_visitante INTEGER,
  jugado           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS estadisticas_partido (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id  INTEGER NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  jugador_id  INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  minuto      INTEGER,
  valor       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_equipos_comp ON equipos(competicion_id);
CREATE INDEX IF NOT EXISTS idx_jugadores_equipo ON jugadores(equipo_id);
CREATE INDEX IF NOT EXISTS idx_partidos_comp ON partidos(competicion_id);
CREATE INDEX IF NOT EXISTS idx_est_partido ON estadisticas_partido(partido_id);
CREATE INDEX IF NOT EXISTS idx_est_jugador ON estadisticas_partido(jugador_id);
`;

db.exec(SCHEMA);

// ---------------------------------------------------------------------------
// Migraciones (para bases de datos ya existentes)
// ---------------------------------------------------------------------------

(function migrar() {
  const columnas = db.prepare('PRAGMA table_info(partidos)').all().map((c) => c.name);
  const agregar = (nombre, definicion) => {
    if (!columnas.includes(nombre)) {
      db.exec(`ALTER TABLE partidos ADD COLUMN ${nombre} ${definicion}`);
    }
  };
  agregar('estado', "TEXT NOT NULL DEFAULT 'programado'");
  agregar('iniciado_en', 'TEXT');
  agregar('actualizado_en', 'TEXT');
  agregar('periodo', 'TEXT');
  // Cronómetro: momento de referencia y si está en marcha
  agregar('cronometro_inicio', 'TEXT');
  agregar('cronometro_acumulado', 'INTEGER NOT NULL DEFAULT 0');
  agregar('cronometro_activo', 'INTEGER NOT NULL DEFAULT 0');
  // Jugador designado como MVP del partido
  agregar('mvp_jugador_id', 'INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS partido_eventos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      partido_id  INTEGER NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
      equipo_id   INTEGER NOT NULL REFERENCES equipos(id),
      jugador_id  INTEGER REFERENCES jugadores(id),
      tipo        TEXT NOT NULL,
      valor       INTEGER NOT NULL DEFAULT 1,
      minuto      INTEGER,
      periodo     TEXT,
      creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_eventos_partido ON partido_eventos(partido_id);
  `);
})();

// ---------------------------------------------------------------------------
// Datos de ejemplo (solo la primera vez y si no se desactiva)
// ---------------------------------------------------------------------------

const sembrarActivo = process.env.SEED_DB !== 'false';
const yaHayDatos = db.prepare('SELECT COUNT(*) AS n FROM competiciones').get().n > 0;

if (!yaHayDatos && sembrarActivo) {
  sembrar();
  console.log('[db] Datos de ejemplo cargados.');
}

function sembrar() {
  const dep = db.prepare(
    `INSERT INTO deportes (slug, nombre, tipo_resultado, puntos_victoria, puntos_empate, puntos_derrota, color)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  dep.run('futbol-campo', 'Fútbol Campo', 'goles', 3, 1, 0, '#16a34a');
  dep.run('futbol-sala', 'Fútbol Sala', 'goles', 3, 1, 0, '#ea580c');
  dep.run('baloncesto', 'Baloncesto', 'puntos', 2, 0, 1, '#dc2626');
  dep.run('voleybol', 'Vóleybol', 'sets', 3, 0, 1, '#2563eb');

  const mun = db.prepare('INSERT INTO municipios (nombre) VALUES (?)');
  ['Alicante', 'Elche', 'Torrevieja'].forEach((m) => mun.run(m));

  const temp = db.prepare('INSERT INTO temporadas (nombre) VALUES (?)');
  ['2024/2025', '2025/2026'].forEach((t) => temp.run(t));

  const cat = db.prepare('INSERT INTO categorias (nombre) VALUES (?)');
  ['Senior', 'Juvenil', 'Cadete'].forEach((c) => cat.run(c));

  db.exec('BEGIN');
  try {
    // 1) Fútbol Campo Senior - Alicante 2025/2026
    const compFutbol = insertCompeticion('Liga Local Fútbol Campo', 'futbol-campo', 'Alicante', '2025/2026', 'Senior');
    const eqFutbol = insertEquipos(compFutbol, [
      'CD Montemar', 'Atlético San Blas', 'UD Playa Lisa', 'Racing del Puerto',
      'Deportivo Lucentum', 'CF Benalúa', 'Sporting Carolinas', 'Unión Alicantina'
    ]);
    const futJugadores = [
      ['Pablo García', 9, 'Delantero'], ['Marcos Ruiz', 10, 'Medio'],
      ['Javi León', 7, 'Extremo'], ['Sergio Mora', 5, 'Defensa'],
      ['Andrés Vidal', 1, 'Portero'], ['Iván Torres', 11, 'Delantero']
    ];
    generarCalendario(compFutbol, eqFutbol, '2025-09-06', 7);
    simularCompeticion(compFutbol, { eventosPorPartido: (goles) => goles, tipo: 'goles' }, eqFutbol, futJugadores);

    // 2) Fútbol Sala Senior - Elche 2025/2026
    const compFutsal = insertCompeticion('Liga Local Fútbol Sala', 'futbol-sala', 'Elche', '2025/2026', 'Senior');
    const eqFutsal = insertEquipos(compFutsal, [
      'Elche FS', 'CD Ilice', 'Sala Torrellano', 'Atlético Altabix', 'Nuevo Elche FS', 'CD Alted'
    ]);
    generarCalendario(compFutsal, eqFutsal, '2025-10-04', 5);
    simularCompeticion(compFutsal, { eventosPorPartido: (goles) => goles, tipo: 'goles' }, eqFutsal, [
      ['Álvaro Pérez', 8, 'Ala'], ['Rubén Soto', 9, 'Pívot'], ['Nacho Gil', 10, 'Ala']
    ]);

    // 3) Baloncesto Senior - Alicante 2025/2026
    const compBasket = insertCompeticion('Liga Local Baloncesto', 'baloncesto', 'Alicante', '2025/2026', 'Senior');
    const eqBasket = insertEquipos(compBasket, [
      'CB Luceros', 'Basket Torrevieja', 'AD Santa Pola', 'CB Benidorm',
      'Club Baloncesto Elche', 'CB Almoradí'
    ]);
    generarCalendario(compBasket, eqBasket, '2025-10-11', 7);
    simularCompeticion(compBasket, { eventosPorPartido: (pts) => pts, tipo: 'puntos' }, eqBasket, [
      ['Diego Navarro', 4, 'Base'], ['Carlos Roca', 12, 'Ala-Pívot'], ['Mario Sanz', 7, 'Escolta']
    ]);

    // 4) Vóleybol Femenino Senior - Torrevieja 2025/2026
    const compVoley = insertCompeticion('Liga Local Vóleybol', 'voleybol', 'Torrevieja', '2025/2026', 'Senior');
    const eqVoley = insertEquipos(compVoley, [
      'CV Torrevieja', 'CV Costa Blanca', 'AD Volei Elche', 'CV Guardamar', 'CV Salinas'
    ]);
    generarCalendario(compVoley, eqVoley, '2025-10-18', 7);
    simularCompeticion(compVoley, { eventosPorPartido: () => 1, tipo: 'sets' }, eqVoley, [
      ['Lucía Fernández', 6, 'Receptora'], ['Marta Gómez', 11, 'Opuesta'], ['Ana Belén Ruiz', 3, 'Central']
    ]);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function insertCompeticion(nombre, deporteSlug, municipio, temporada, categoria) {
  const dep = db.prepare('SELECT id FROM deportes WHERE slug = ?').get(deporteSlug);
  const mun = db.prepare('SELECT id FROM municipios WHERE nombre = ?').get(municipio);
  const tem = db.prepare('SELECT id FROM temporadas WHERE nombre = ?').get(temporada);
  const cat = db.prepare('SELECT id FROM categorias WHERE nombre = ?').get(categoria);
  const info = db
    .prepare(
      `INSERT INTO competiciones (nombre, deporte_id, municipio_id, temporada_id, categoria_id, activa)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(nombre, dep.id, mun.id, tem.id, cat.id);
  return Number(info.lastInsertRowid);
}

function insertEquipos(competicionId, nombres) {
  const stmt = db.prepare('INSERT INTO equipos (nombre, competicion_id) VALUES (?, ?)');
  return nombres.map((n) => Number(stmt.run(n, competicionId).lastInsertRowid));
}

/** Calendario todos contra todos (round-robin) por jornadas. */
function generarCalendario(competicionId, equipos, fechaInicio, totalJornadas) {
  const lista = [...equipos];
  if (lista.length % 2 !== 0) lista.push(null);
  const n = lista.length;
  const rondas = n - 1;
  const partidos = [];
  for (let r = 0; r < rondas; r++) {
    for (let i = 0; i < n / 2; i++) {
      const local = lista[i];
      const visitante = lista[n - 1 - i];
      if (local !== null && visitante !== null) {
        const a = r % 2 === 0 ? local : visitante;
        const b = r % 2 === 0 ? visitante : local;
        partidos.push([a, b]);
      }
    }
    lista.splice(1, 0, lista.pop());
  }
  const stmt = db.prepare(
    `INSERT INTO partidos (competicion_id, jornada, fecha, local_id, visitante_id)
     VALUES (?, ?, date(?, '+' || ? || ' days'), ?, ?)`
  );
  partidos.forEach((par, idx) => {
    const jornada = Math.floor(idx / (n / 2)) + 1;
    if (totalJornadas && jornada > totalJornadas) return;
    stmt.run(competicionId, jornada, fechaInicio, jornada * 7, par[0], par[1]);
  });
}

function simularCompeticion(competicionId, opciones, equipos, jugadores) {
  const partidos = db
    .prepare('SELECT id FROM partidos WHERE competicion_id = ? ORDER BY jornada, id')
    .all(competicionId);

  // Crea los jugadores de ejemplo y repártelos entre los equipos.
  const jugadoresPorEquipo = new Map();
  equipos.forEach((equipoId, i) => {
    const lista = [];
    jugadores.forEach((j, k) => {
      if ((k + i) % Math.max(1, Math.floor(jugadores.length / 2) || 1) === 0 || lista.length < 2) {
        if (lista.length < 2) {
          const info = db
            .prepare('INSERT INTO jugadores (nombre, dorsal, posicion, equipo_id) VALUES (?, ?, ?, ?)')
            .run(`${j[0]}`, j[1], j[2], equipoId);
          lista.push(Number(info.lastInsertRowid));
        }
      }
    });
    // Rellena hasta 2 jugadores por equipo como mínimo
    while (lista.length < 2) {
      const base = jugadores[(lista.length + i) % jugadores.length];
      const info = db
        .prepare('INSERT INTO jugadores (nombre, dorsal, posicion, equipo_id) VALUES (?, ?, ?, ?)')
        .run(base[0], base[1], base[2], equipoId);
      lista.push(Number(info.lastInsertRowid));
    }
    jugadoresPorEquipo.set(equipoId, lista);
  });

  const updPartido = db.prepare(
    'UPDATE partidos SET puntos_local = ?, puntos_visitante = ?, jugado = 1 WHERE id = ?'
  );
  const insEvento = db.prepare(
    'INSERT INTO estadisticas_partido (partido_id, jugador_id, minuto, valor) VALUES (?, ?, ?, ?)'
  );

  let jugados = 0;
  for (const p of partidos) {
    const detalle = db.prepare('SELECT local_id, visitante_id FROM partidos WHERE id = ?').get(p.id);
    const rangoBase = opciones.tipo === 'sets' ? 3 : opciones.tipo === 'puntos' ? 40 : 4;
    const gL = rango(rangoBase);
    const gV = rango(rangoBase);
    updPartido.run(gL, gV, p.id);

    // Reparte los eventos entre los jugadores de cada equipo
    const reparto = (equipoId, cantidad) => {
      const lista = jugadoresPorEquipo.get(equipoId) || [];
      if (!lista.length) return;
      for (let e = 0; e < cantidad; e++) {
        const jugador = lista[Math.floor(Math.random() * lista.length)];
        const minuto = Math.floor(Math.random() * 90) + 1;
        insEvento.run(p.id, jugador, minuto, 1);
      }
    };
    reparto(detalle.local_id, opciones.eventosPorPartido(gL));
    reparto(detalle.visitante_id, opciones.eventosPorPartido(gV));
    jugados++;
  }
  return jugados;
}

function rango(max) {
  return Math.floor(Math.random() * (max + 1));
}

module.exports = { db, DB_PATH };
