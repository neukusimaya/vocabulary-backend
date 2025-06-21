
const express = require('express');
const Reverso = require('reverso-api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Лог каждого запроса
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

// Маппинг ISO-кодов в названия языков для Reverso
const langMap = {
  en: 'english', ru: 'russian',
  fr: 'french', de: 'german',
  es: 'spanish', it: 'italian',
  pt: 'portuguese'
};

// Эмуляция задержки с экспоненциальным бэкоффом и джиттером
async function backoff(attempt) {
  const base = 300 * Math.pow(2, attempt); // 300, 600, 1200, ...
  const jitter = Math.random() * 500;
  await new Promise(r => setTimeout(r, base + jitter));
}

// Один экземпляр Reverso
const reverso = new Reverso();

// Робастный вызов getContext: до 5 попыток
async function robustContext(text, from, to) {
  for (let i = 0; i < 5; i++) {
    try {
      const ctx = await reverso.getContext(text, from, to);
      if (ctx.ok && ((ctx.translations || []).length || (ctx.examples || []).length)) {
        return ctx;
      }
    } catch (e) {
      console.warn(`getContext attempt #${i + 1} error:`, e.message);
    }
    await backoff(i);
  }
  return { ok: false, translations: [], examples: [] };
}

// Робастный вызов getTranslation: до 5 попыток
async function robustTranslation(text, from, to) {
  for (let i = 0; i < 5; i++) {
    try {
      const tr = await reverso.getTranslation(text, from, to);
      if (Array.isArray(tr.translations) && tr.translations.length) {
        return tr;
      }
    } catch (e) {
      console.warn(`getTranslation attempt #${i + 1} error:`, e.message);
    }
    await backoff(i);
  }
  return { translations: [], context: { examples: [] } };
}

app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'ru' } = req.query;
  if (!text) {
    return res.status(400).json({ error: 'Missing "text" query parameter' });
  }

  const sourceLang = langMap[from] || from;
  const targetLang = langMap[to] || to;

  try {
    // Попытка через getContext
    const ctx = await robustContext(text, sourceLang, targetLang);
    let translations = (ctx.ok ? ctx.translations : []).filter(t => t && t.trim());
    let examples = (ctx.ok ? ctx.examples : []).filter(e => (e.source || e.target) && (e.source || e.target).trim());

    // Fallback для переводов
    if (!translations.length) {
      const fallTr = await robustTranslation(text, sourceLang, targetLang);
      translations = (fallTr.translations || []).filter(t => t && t.trim());
    }

    // Fallback для примеров
    if (!examples.length) {
      const fallCtx = await robustTranslation(text, sourceLang, targetLang);
      const rawExamples = (fallCtx.context && fallCtx.context.examples) || [];
      examples = rawExamples
        .map((e, i) => ({ id: i, source: e.source, target: e.target }))
        .filter(e => (e.source || e.target) && (e.source || e.target).trim());
    }

    return res.json({ text, source: from, target: to, translations, examples });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
