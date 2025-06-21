# Берём официальное Node.js-изображение на Debian
FROM node:18-bullseye

# Устанавливаем Chromium (для Puppeteer)
RUN apt-get update && \
    apt-get install -y chromium && \
    rm -rf /var/lib/apt/lists/*

# Указываем Puppeteer, где искать браузер
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Рабочая директория
WORKDIR /app

# Копируем только манифесты, устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем весь код приложения
COPY . .

# Запуск
CMD ["node", "index.js"]