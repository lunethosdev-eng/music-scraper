FROM node:20-slim

# 1. Instalar dependencias del sistema y alias para Python
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python-is-python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Descargar ejecutable actualizado de yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /usr/src/app

# 3. Copiar e instalar dependencias de Node
COPY package*.json ./
RUN npm install

# 4. Copiar todo el código fuente del proyecto
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
