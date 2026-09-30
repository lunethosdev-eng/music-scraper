FROM node:22-slim

# Instalar ffmpeg, python3, ca-certificates y curl requeridos por yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Descargar e instalar la versión más reciente de yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Copia todo el código, incluyendo el archivo cookies.txt si está presente en la raíz
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
