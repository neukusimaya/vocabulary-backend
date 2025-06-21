# 1) Берём официальное Node.js-изображение на Debian
FROM node:18-bullseye

# 2) Устанавливаем Chromium
RUN apt-get update && \
    apt-get install -y chromium && \
    rm -rf /var/lib/apt/lists/*

# 3) Говорим Puppeteer, где искать браузер
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4) Рабочая директория
WORKDIR /app

# 5) Копируем package.json и ставим npm-зависимости
COPY package*.json ./
RUN npm install

# 6) Копируем весь код
COPY . .

# 7) Запуск приложения
CMD ["node", "index.js"]
