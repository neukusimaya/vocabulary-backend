// index.js

const express    = require('express');
const Reverso    = require('reverso-api');
const Bottleneck = require('bottleneck');
const NodeCache  = require('node-cache');

const app  = express();
const PORT = process.env.PORT || 3000;

// --- Настройки кеша и лимитера ---
const cache = new NodeCache({ stdTTL: 300 /* сек */, checkperiod: 600 });
const limiter = new Bottleneck({
  reservoir: 30,           // всего 30 запросов за период
  reservoirRefreshAmount: 30,
  reservoirRefreshInterval: 60 * 1000, // сбрасывать каждую минуту
  minTime: 500,            // минимум 500 мс между запросами
  maxConcurrent: 1
});

// Helper: случайная задержка jitter
const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 300));

// Маппинг ISO → названия для Reverso
const langMap = {
  en: 'english', ru: 'russian',
  fr: 'french',  de: 'german',
  es: 'spanish', it: 'italian',
  pt: 'portuguese'
};

// Один экземпляр Reverso
const reverso = new Reverso();

// Обёртки для безопасных вызовов через лимитер + кеш
async function safeContext(text, from, to) {
  const key = `ctx:${from}:${to}:${text}`;
  if (cache.has(key)) return cache.get(key);

  await sleep(0); // jitter перед лимитом
  const result = await limiter.schedule(() => reverso.getContext(text, from, to));
  if (result.ok) cache.set(key, result);
  return result;
}

async function safeTranslation(text, from, to) {
  const key = `trl:${from}:${to}:${text}`;
  if (cache.has(key)) return cache.get(key);

  await sleep(0);
  const result = await limiter.schedule(() => reverso.getTranslation(text, from, to));
  if (result.translations) cache.set(key, result);
  return result;
}

// Лог каждого запроса
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'ru' } = req.query;
  if (!text) return res.status(400).json({ error: 'Missing "text"' });

  const sourceLang = langMap[from] || from;
  const targetLang = langMap[to]   || to;

  try {
    // 1) Первичный context
    const ctx = await safeContext(text, sourceLang, targetLang);
    let translations = (ctx.ok && Array.isArray(ctx.translations))
      ? ctx.translations.filter(t => t && t.trim())
      : [];
    let examples     = (ctx.ok && Array.isArray(ctx.examples))
      ? ctx.examples.filter(e => (e.source||e.target).trim())
      : [];

    // 2) Fallback переводов
    if (translations.length === 0) {
      try {
        const fall = await safeTranslation(text, sourceLang, targetLang);
        translations = (fall.translations||[]).filter(t => t && t.trim());
      } catch (e) {
        console.warn('Fallback translation error:', e.message);
      }
    }

    // 3) Fallback примеров
    if (examples.length === 0) {
      try {
        const fall = await safeTranslation(text, sourceLang, targetLang);
        examples = (fall.context?.examples || [])
          .map((e,i) => ({ id: i, source: e.source, target: e.target }))
          .filter(e => (e.source||e.target).trim());
      } catch (e) {
        console.warn('Fallback examples error:', e.message);
      }
    }

    return res.json({ text, source: from, target: to, translations, examples });

  } catch (error) {
    console.error('API fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
