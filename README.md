# Estadísticas Deportivas Locales

Web para gestionar y consultar las **estadísticas de ligas locales** de cuatro deportes:

- ⚽ Fútbol Campo
- 🥅 Fútbol Sala
- 🏀 Baloncesto
- 🏐 Vóleybol

Incluye **clasificaciones**, **calendario y resultados**, **estadísticas de jugadores**,
**panel de administración** y soporte para **varias temporadas, municipios y categorías**.

---

## 🚀 Puesta en marcha

No requiere instalar dependencias: usa `node:sqlite`, incluido en Node.js 22.5 o superior.

```bash
node --version          # debe ser >= 22.5
npm start               # arranca el servidor
```

Abre en el navegador:

- Web pública: <http://localhost:3000>
- Panel de administración: <http://localhost:3000/admin.html>
  - Usuario: `admin`
  - Contraseña: `admin123`

Para desarrollo con recarga automática del servidor:

```bash
npm run dev
```

Si quieres empezar de cero (borra la base de datos y vuelve a cargar los ejemplos):

```bash
npm run reset-db && npm start
```

---

## 🌍 Publicar en internet

El proyecto es un servidor Node normal, así que funciona en cualquier hosting que soporte Node.
**Importante:** necesita **Node 22.5+** y un **disco/almacenamiento persistente** para que la base de
datos SQLite no se borre en cada despliegue.

La base de datos se guarda por defecto en `data/stats.db`, pero puedes cambiar la carpeta con la
variable `DATA_DIR` (o la ruta exacta con `DB_PATH`) para apuntar al disco persistente del hosting.

### Opción 1 — Render (recomendada, la más sencilla)

1. Sube el proyecto a un repositorio de GitHub (ver más abajo).
2. Entra en <https://render.com> → **New → Blueprint** y elige tu repositorio.
3. Render leerá el archivo `render.yaml` incluido: crea el servicio, configura Node 22, un disco
   persistente en `/var/data` y la variable `DATA_DIR`.
4. Te pedirá el valor de `ADMIN_PASS`: escribe la contraseña que quieras para el panel.
5. Pulsa **Apply**. En unos minutos tendrás una URL tipo `https://tu-app.onrender.com`.

> El plan *starter* es de pago (unos pocos dólares/mes) porque el disco persistente no está en el
> plan gratuito. Si usas el plan gratuito, la base de datos se reinicia al dormir el servicio.

### Opción 2 — Railway

1. Sube el proyecto a GitHub.
2. Entra en <https://railway.app> → **New Project → Deploy from GitHub repo**.
3. Railway detecta Node automáticamente (gracias a `railway.json`).
4. Añade un **Volume** montado en `/var/data` y la variable de entorno `DATA_DIR=/var/data`.
5. Define `ADMIN_USER` y `ADMIN_PASS` en **Variables**.
6. En **Settings → Networking**, pulsa **Generate Domain** para obtener tu URL pública.

### Opción 3 — VPS propio (DigitalOcean, Hetzner, un ordenador…)

```bash
# En el servidor (Ubuntu/Debian), instala Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Copia el proyecto y arráncalo
cd /opt/estadisticas
ADMIN_PASS="tu-contrasena" PORT=3000 DATA_DIR=/opt/estadisticas/data node server.js
```

Para que siga funcionando siempre, usa **PM2** y **Nginx**:

```bash
sudo npm install -g pm2
pm2 start server.js --name estadisticas
pm2 save && pm2 startup
```

Nginx como proxy inverso (con certificado HTTPS gratuito vía `certbot`):

```nginx
server {
  server_name tudominio.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
  }
}
```

> El `proxy_buffering off` y las cabeceras de conexión son importantes para que funcionen los
> **Server-Sent Events** (el marcador en vivo).

### Opción 4 — Docker (cualquier plataforma)

El proyecto incluye `Dockerfile`:

```bash
docker build -t estadisticas .
docker run -d -p 3000:3000 \
  -e ADMIN_PASS="tu-contrasena" \
  -v estadisticas-datos:/data \
  --name estadisticas estadisticas
```

El volumen `-v ...:/data` mantiene la base de datos aunque recrees el contenedor.

### Subir el proyecto a GitHub

Como aún no es un repositorio, créalo así:

```bash
cd "Proyecto predeterminado"
git init
git add .
git commit -m "Web de estadísticas deportivas"
git branch -M main
# Crea un repositorio vacío en github.com y copia su URL:
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

El archivo `.gitignore` ya excluye `data/*.db`, `.env` y otros archivos que no deben subirse.

### Variables de entorno disponibles

| Variable     | Descripción                                        | Por defecto            |
|--------------|----------------------------------------------------|------------------------|
| `PORT`       | Puerto del servidor                                | `3000`                 |
| `ADMIN_USER` | Usuario del panel                                  | `admin`                |
| `ADMIN_PASS` | Contraseña del panel                               | `admin123`             |
| `DATA_DIR`   | Carpeta donde se guarda la base de datos           | `./data`               |
| `DB_PATH`    | Ruta exacta de la base de datos (tiene prioridad)  | `DATA_DIR/stats.db`    |
| `SEED_DB`    | `false` para arrancar sin datos de ejemplo         | `true`                 |

Copia `.env.example` a `.env` para tenerlas todas a mano.

### Checklist antes de publicar

- [ ] Cambiar `ADMIN_PASS` por una contraseña fuerte.
- [ ] Verificar que el hosting usa **Node 22.5+**.
- [ ] Configurar un **disco persistente** y apuntar `DATA_DIR` a él.
- [ ] Activar **HTTPS** (Render/Railway ya lo hacen; en VPS, con `certbot`).
- [ ] Comprobar que el servidor proxy **no almacena en búfer** las respuestas SSE.

---

## 🧱 Tecnología

| Capa        | Tecnología                                                        |
|-------------|-------------------------------------------------------------------|
| Frontend    | HTML + CSS + JavaScript puro (sin frameworks)                     |
| Backend     | Node.js, módulo `http` (sin dependencias externas)                |
| Base datos  | SQLite mediante `node:sqlite` (incluido en Node 22)               |
| Autenticación | Token de sesión en memoria + `localStorage` en el navegador     |

Todo el proyecto es JavaScript, así que no necesitas aprender ningún lenguaje adicional.

---

## 📁 Estructura

```
.
├── server.js          Servidor HTTP + API REST
├── db.js              Esquema SQLite y datos de ejemplo
├── stats.js           Cálculo de clasificaciones y estadísticas
├── package.json
├── data/
│   └── stats.db       Base de datos (se crea sola)
└── public/
    ├── index.html     Página pública
    ├── styles.css     Estilos
    ├── app.js         Lógica del sitio público
    ├── admin.html     Panel de administración
    └── admin.js       Lógica del panel
```

---

## 🗄️ Modelo de datos

- **deportes**: configuración de puntuación por deporte (`puntos_victoria`, `puntos_empate`, `puntos_derrota`).
- **municipios**, **temporadas**, **categorias**: catálogos.
- **competiciones**: une deporte + municipio + temporada + categoría.
- **equipos**: pertenecen a una competición.
- **jugadores**: pertenecen a un equipo.
- **partidos**: jornada, fecha, local, visitante y resultado.
- **estadisticas_partido**: eventos por jugador (goles, puntos, etc.).

La clasificación **no se guarda**: se calcula en el vuelo a partir de los partidos jugados.

---

## 🔌 API REST

### Públicas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/deportes` | Lista de deportes |
| GET | `/api/municipios` | Lista de municipios (con nº de competiciones) |
| GET | `/api/temporadas` | Lista de temporadas |
| GET | `/api/categorias` | Lista de categorías |
| GET | `/api/competiciones?deporte=&municipio=&temporada=&categoria=` | Competiciones filtradas |
| GET | `/api/competiciones/:id` | Resumen de una competición |
| GET | `/api/competiciones/:id/clasificacion` | Tabla de posiciones |
| GET | `/api/competiciones/:id/partidos?jornada=` | Calendario y resultados por jornada |
| GET | `/api/competiciones/:id/jugadores?limite=` | Ranking de jugadores |
| GET | `/api/equipos?competicion_id=` | Equipos de una competición |
| GET | `/api/equipos/:id` | Un equipo |
| GET | `/api/jugadores/:equipoId` | Jugadores de un equipo |
| GET | `/api/competiciones/:id/sanciones` | Tabla de tarjetas (amarillas/rojas) |
| GET | `/api/envivo` | Partidos en directo, descanso o finalizados hoy |
| GET | `/api/envivo/stream` | Canal **SSE** de actualizaciones en tiempo real |
| GET | `/api/partidos/:id/detalle` | Detalle del partido, cronómetro y estadísticas |

### Protegidas (cambian datos)

Requieren la cabecera `Authorization: Bearer <token>` obtenido en `/api/login`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/login` | Iniciar sesión |
| POST | `/api/logout` | Cerrar sesión |
| POST | `/api/municipios` | Crear municipio |
| DELETE | `/api/municipios/:id` | Borrar municipio (si no tiene competiciones) |
| POST | `/api/temporadas` | Crear temporada |
| POST | `/api/categorias` | Crear categoría |
| POST | `/api/competiciones` | Crear competición |
| DELETE | `/api/competiciones/:id` | Borrar competición |
| POST | `/api/equipos` | Crear equipo |
| PUT | `/api/equipos/:id` | Editar equipo |
| DELETE | `/api/equipos/:id` | Borrar equipo |
| POST | `/api/jugadores` | Crear jugador |
| POST | `/api/jugadores/importar` | Importación masiva de jugadores (CSV/lista) |
| POST | `/api/competiciones/:id/generar-plantillas` | Generar plantillas de ejemplo para los equipos |
| PUT | `/api/jugadores/:id` | Editar jugador |
| DELETE | `/api/jugadores/:id` | Borrar jugador |
| POST | `/api/partidos` | Crear partido |
| PUT | `/api/partidos/:id` | Editar partido |
| DELETE | `/api/partidos/:id` | Borrar partido |
| POST | `/api/competiciones/:id/generar-calendario` | Generar calendario aleatorio (round-robin) |
| POST | `/api/partidos/:id/iniciar` | Poner el partido en directo (arranca el cronómetro) |
| POST | `/api/partidos/:id/evento` | Registrar gol/punto/set/asistencia/tarjeta en vivo |
| DELETE | `/api/partidos/:id/evento/:eventoId` | Deshacer un evento en vivo |
| POST | `/api/partidos/:id/estado` | Cambiar estado (descanso/reanudar/finalizar) |
| POST | `/api/partidos/:id/cronometro` | Pausar / reanudar / reiniciar / ajustar el reloj |
| POST | `/api/partidos/:id/mvp` | Designar el MVP del partido |
| POST | `/api/resultados` | Guardar resultado + estadísticas (goles, asistencias, tarjetas) |

## ⚙️ Configuración

Puedes cambiar el puerto y las credenciales con variables de entorno:

```bash
PORT=8080 ADMIN_USER=miusuario ADMIN_PASS=micontrasena npm start
```

> ⚠️ **Importante**: cambia la contraseña por defecto antes de publicar la web en internet.

---

## 🧮 Cómo se calculan las puntuaciones

Cada deporte define sus reglas en la tabla `deportes`:

| Deporte | Victoria | Empate | Derrota |
|---------|----------|--------|---------|
| Fútbol Campo / Sala | 3 | 1 | 0 |
| Baloncesto | 2 | 0 | 1 |
| Vóleybol | 3 | 0 | 1 |

La clasificación ordena por puntos, luego por diferencia y luego por tantos a favor.

---

## 🔴 Partido en vivo y calendario aleatorio

### Calendario aleatorio

En el panel, pestaña **Calendario**: elige una competición (con al menos 2 equipos) y pulsa
**Generar calendario**. Se sortean los equipos y la localía de cada jornada (algoritmo del
círculo), con opción de **solo ida** o **ida y vuelta** y de borrar los partidos previos.

### Partido en vivo

En el panel, pestaña **Partido en vivo**:

1. Selecciona la competición y el partido.
2. Pulsa **▶️ Iniciar partido** (el cronómetro arranca solo).
3. Registra los eventos con los botones **+ Gol / + Punto / + Set**, **🅰️ Asistencia**,
   **🟨 Amarilla** y **🟥 Roja**, opcionalmente eligiendo jugador y minuto.
4. Controla el reloj con **⏸️ Pausar reloj**, **▶️ Reanudar reloj** y **🔄 Reiniciar**.
5. Usa **⏸️ Descanso** (pausa el reloj), **▶️ Reanudar** y **🏁 Finalizar**. Al finalizar, los eventos
   de anotación se vuelcan a las estadísticas de jugador y el resultado cuenta para la clasificación.
6. Marca el **MVP** del partido con el botón **Elegir** de la tabla de estadísticas.
7. Puedes **deshacer** cualquier evento con la ✕ del registro.

### Estadísticas ampliadas

La pestaña **Jugadores** de la web pública tiene tres vistas:

- **Goles / Puntos**: ranking de anotación con partidos, media y tarjetas.
- **⭐ MVP**: clasificación por *valoración* = anotaciones + partidos jugados − amarillas − 3 × rojas.
- **Tarjetas**: tabla de sanciones.

### Registrar resultado con estadísticas

En el panel, pestaña **Registrar resultado**:

1. Elige la competición y luego el **partido** en el desplegable.
2. Al seleccionarlo, se **cargan automáticamente sus estadísticas**: marcador, cronómetro,
   registro de eventos y una tabla editable por jugador con **goles/puntos, asistencias y tarjetas**.
3. Al cambiar los goles, el **marcador se recalcula solo**.
4. Pulsa **💾 Guardar y finalizar** (cuenta para la clasificación) o **Guardar sin finalizar** para
   dejarlo como borrador.

Las estadísticas se guardan como eventos, de modo que aparecen igualmente en las pestañas
**MVP** y **Tarjetas**, y en la consola de partido en vivo.

### Carga masiva de jugadores

En el panel, pestaña **Equipos y jugadores**, apartado **Carga masiva de jugadores**:

- **✨ Generar plantillas de ejemplo**: crea automáticamente jugadores para todos los equipos de la
  competición (indicas cuántos por equipo). Respeta las plantillas existentes salvo que marques
  *Reemplazar plantillas existentes*.
- **Importar desde CSV / lista de texto**: pega líneas con el formato
  `Equipo, Nombre, Dorsal, Posición` o carga un archivo `.csv`. Los jugadores se asignan a los
  equipos por su nombre. Se informa de las filas con errores (equipo inexistente, nombre vacío…).

La web pública tiene una sección **🔴 En vivo** que se actualiza sola mediante
**Server-Sent Events (SSE)**: cualquier gol, tarjeta o cambio de estado aparece al instante en todos
los navegadores conectados, con el **reloj corriendo en pantalla**, sin recargar y sin librerías.

---

## 🛣️ Próximos pasos sugeridos

- Varias fases: liga regular + playoff.
- Gráficas de evolución y comparador de equipos.
- Gestión de periodos (cuartos, sets) con marcador parcial por periodo.
- Despliegue en un servidor (por ejemplo, un VPS o un hosting con Node.js).
