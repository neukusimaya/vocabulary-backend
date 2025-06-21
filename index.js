const express = require("express");
const cors = require("cors");
const Reverso = require("reverso-api");

// Словарь соответствия коротких кодов и названий языков для reverso-api
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
  if (!text || !from || !to) {
    return res.status(400).json({ error: "Missing query params" });
  }

  const fromLang = LANGS[from.toLowerCase()];
  const toLang = LANGS[to.toLowerCase()];
  if (!fromLang || !toLang) {
    return res.status(400).json({ error: "Unsupported language code" });
  }

  try {
    // Пробуем получить контекстные примеры
    const contextData = await new Reverso().getContext(text, fromLang, toLang);
    console.log("getContext →", JSON.stringify(contextData, null, 2));

    // Если нет переводов или они пустые, делаем fallback на getTranslation
    const hasValidTranslations = Array.isArray(contextData.translations) &&
      contextData.translations.some(t => t && t.trim());
    if (!hasValidTranslations) {
      const pureData = await new Reverso().getTranslation(text, fromLang, toLang);
      console.log("getTranslation →", JSON.stringify(pureData, null, 2));
      return res.json(pureData);
    }

    // Возвращаем контекстные данные
    res.json(contextData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
