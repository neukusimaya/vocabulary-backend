// index.js
const express = require("express");
const cors = require("cors");
const Reverso = require("reverso-api");

// Сопоставление коротких кодов ISO языков и названий для reverso-api
const LANGS = {
  en: "english",
  ru: "russian",
  fr: "french",
  es: "spanish",
  de: "german",
  it: "italian"
};

const app = express();
app.use(cors()); // разрешаем CORS-запросы

app.get("/api/translate", async (req, res) => {
  const { text, from, to } = req.query;

  // Проверка обязательных параметров
  if (!text || !from || !to) {
    return res.status(400).json({ error: "Missing query params" });
  }

  // Маппинг ISO кодов на полные названия
  const fromLang = LANGS[from.toLowerCase()];
  const toLang = LANGS[to.toLowerCase()];
  if (!fromLang || !toLang) {
    return res.status(400).json({ error: "Unsupported language code" });
  }

  try {
    // Получаем сырые данные контекста
    const raw = await new Reverso().getContext(text, fromLang, toLang);
    console.log("getContext →", JSON.stringify(raw, null, 2));

    // Фильтруем пустые переводы
    const translations = Array.isArray(raw.translations)
      ? raw.translations.filter(t => t && t.trim())
      : [];

    // Фильтруем пустые примеры
    const examples = Array.isArray(raw.examples)
      ? raw.examples.filter(ex => ex.source && ex.source.trim() && ex.target && ex.target.trim())
      : [];

    // Отдаём только отфильтрованные результаты
    return res.json({
      ok: raw.ok,
      text: raw.text,
      source: raw.source,
      target: raw.target,
      translations,
      examples
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));