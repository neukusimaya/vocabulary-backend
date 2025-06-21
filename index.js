const express = require('express');
const Reverso = require('reverso-api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// лог каждого запроса
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

// маппинг ISO-кодов в названия языков для Reverso
const langMap = {
  en: 'english', ru: 'russian',
  fr: 'french',  de: 'german',
  es: 'spanish', it: 'italian',
  pt: 'portuguese'
};

// список User-Agent'ов для ротации
const userAgents = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.110 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.110 Safari/537.36'
];

// вспомогательная задержка с экспоненциальным бэкоффом и джиттером
async function backoff(attempt) {
  const base = 300 * Math.pow(2, attempt); // 300, 600, 1200, …
  const jitter = Math.random() * 500;
  await new Promise(r => setTimeout(r, base + jitter));
}

// один экземпляр Reverso
const reverso = new Reverso();

// "робастный" вызов getContext
async function robustContext(text, from, to) {
  for (let i = 0; i < 5; i++) {
    reverso.setOptions({ userAgent: userAgents[i % userAgents.length] });
    try {
      const ctx = await reverso.getContext(text, from, to);
      const has = (ctx.ok && (ctx.translations?.length > 0 || ctx.examples?.length > 0));
      if (has) return ctx;
    } catch (e) {
      console.warn(`getContext attempt #${i+1} error:`, e.message);
    }
    await backoff(i);
  }
  return { ok: false, translations: [], examples: [] };
}

// "робастный" вызов getTranslation
async function robustTranslation(text, from, to) {
  for (let i = 0; i < 5; i++) {
    reverso.setOptions({ userAgent: userAgents[(i + 1) % userAgents.length] });
    try {
      const tr = await reverso.getTranslation(text, from, to);
      if (Array.isArray(tr.translations) && tr.translations.length > 0) {
        return tr;
      }
    } catch (e) {
      console.warn(`getTranslation attempt #${i+1} error:`, e.message);
    }
    await backoff(i);
  }
  return { translations: [], context: { examples: [] } };
}

app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'ru' } = req.query;
  if (!text) return res.status(400).json({ error: 'Missing "text" query parameter' });

  const sourceLang = langMap[from] || from;
  const targetLang = langMap[to]   || to;

  try {
    // 1) сначала context
    const ctx = await robustContext(text, sourceLang, targetLang);
    let translations = (ctx.ok ? ctx.translations : []).filter(t => t && t.trim());
    let examples     = (ctx.ok ? ctx.examples     : []).filter(e => (e.source||e.target)?.trim());

    // 2) fallback переводов
    if (translations.length === 0) {
      const fall = await robustTranslation(text, sourceLang, targetLang);
      translations = (fall.translations || []).filter(t => t && t.trim());
    }
    // 3) fallback примеров
    if (examples.length === 0) {
      const fallCtx = await robustTranslation(text, sourceLang, targetLang);
      examples = (fallCtx.context?.examples || [])
        .map((e, i) => ({ id: i, source: e.source, target: e.target }))
        .filter(e => (e.source||e.target)?.trim());
    }

    return res.json({ text, source: from, target: to, translations, examples });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
