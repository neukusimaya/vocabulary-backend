// index.js
const express = require("express");
const cors = require("cors");
const Reverso = require("reverso-api");

// Словарь соответствия коротких кодов и полных названий языков
const LANGS = {
  en: "english",
  ru: "russian",
  fr: "french",
  es: "spanish",
  de: "german",
  it: "italian"
};

const app = express();
app.use(cors()); // Разрешаем CORS-запросы

app.get("/api/translate", async (req, res) => {
  const { text, from, to } = req.query;

  // Валидация параметров
  if (!text || !from || !to) {
    return res.status(400).json({ error: "Missing query params" });
  }

  // Преобразование кодов языков
  const fromLang = LANGS[from.toLowerCase()];
  const toLang   = LANGS[to.toLowerCase()];
  if (!fromLang || !toLang) {
    return res.status(400).json({ error: "Unsupported language code" });
  }

  try {
    // Запрашиваем контекстные данные
    const contextData = await new Reverso().getContext(text, fromLang, toLang);
    console.log("getContext →", JSON.stringify(contextData, null, 2));

    // Проверяем, есть ли валидные переводы или примеры
    const hasTranslations =
      Array.isArray(contextData.translations) &&
      contextData.translations.some(t => t && t.trim());

    const hasExamples =
      Array.isArray(contextData.examples) &&
      contextData.examples.some(ex =>
        (ex.source && ex.source.trim()) || (ex.target && ex.target.trim())
      );

    // Если есть хоть переводы, хоть примеры — возвращаем контекст
    if (hasTranslations || hasExamples) {
      return res.json(contextData);
    }

    // Фоллбэк: запрашиваем просто переводы
    let fallbackData;
    try {
      fallbackData = await new Reverso().getTranslation(text, fromLang, toLang);
      console.log("getTranslation →", JSON.stringify(fallbackData, null, 2));
    } catch (fallbackErr) {
      console.error("Fallback getTranslation failed:", fallbackErr);
    }

    // Возвращаем фоллбэк, если он получен, иначе исходные данные
    if (fallbackData && Array.isArray(fallbackData.translations)) {
      return res.json(fallbackData);
    } else {
      return res.json(contextData);
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));