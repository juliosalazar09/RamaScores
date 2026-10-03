# Imagen de Node 22 (necesaria por node:sqlite)
FROM node:22-slim

WORKDIR /app

# No hay dependencias externas, pero copiamos el manifiesto por claridad
COPY package.json ./

# Código de la aplicación
COPY server.js db.js stats.js ./
COPY public ./public

# La base de datos vive en /data (debe montarse como volumen persistente)
ENV DATA_DIR=/data
ENV PORT=3000
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "server.js"]
