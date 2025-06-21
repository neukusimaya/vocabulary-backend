const express    = require('express');
const Reverso    = require('reverso-api');
const puppeteer  = require('puppeteer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Лог входящих запросов
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

// Маппинг ISO-кодов в названия языков для Reverso
const langMap = {
  en: 'english', ru: 'russian',
  fr: 'french',   de: 'german',
  es: 'spanish',  it: 'italian',
  pt: 'portuguese'
};

// Экземпляр библиотеки Reverso
const reverso = new Reverso();

// Задержка с экспоненциальным бэкоффом и джиттером
async function backoff(attempt) {
  const base   = 300 * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  await new Promise(r => setTimeout(r, base + jitter));
}

// Робастный вызов getContext (3 попытки)
async function robustContext(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const ctx = await reverso.getContext(text, from, to);
      if (ctx.ok && ((ctx.translations || []).length || (ctx.examples || []).length)) {
        return ctx;
      }
    } catch (err) {
      console.warn(`getContext try #${i+1} failed:`, err.message);
    }
    await backoff(i);
  }
  return { ok: false, translations: [], examples: [] };
}

// Робастный вызов getTranslation (3 попытки)
async function robustTranslation(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const tr = await reverso.getTranslation(text, from, to);
      if (Array.isArray(tr.translations) && tr.translations.length) {
        return tr;
      }
    } catch (err) {
      console.warn(`getTranslation try #${i+1} failed:`, err.message);
    }
    await backoff(i);
  }
  return { translations: [], context: { examples: [] } };
}

// Puppeteer-фоллбэк: парсим сайт напрямую
async function puppeteerFallback(text, from, to) {
  const url = `https://context.reverso.net/translation/${from}-${to}/${encodeURIComponent(text)}`;
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const translations = await page.$$eval(
    '.translations-content .translation',
    nodes => nodes.map(n => n.textContent.trim()).filter(t => t)
  );

  const examples = await page.$$eval(
    '.example',
    nodes => nodes.map((n, i) => {
      const src = n.querySelector('.example-source')?.textContent.trim() || '';
      const tgt = n.querySelector('.example-target')?.textContent.trim() || '';
      return { id: i, source: src, target: tgt };
    }).filter(e => e.source && e.target)
  );

  await browser.close();
  return { translations, examples };
}

// Основной маршрут перевода
app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'ru' } = req.query;
  if (!text) {
    return res.status(400).json({ error: 'Missing "text" parameter' });
  }

  const src = langMap[from] || from;
  const tgt = langMap[to]   || to;

  try {
    // 1) Стандартный API getContext
    const ctx = await robustContext(text, src, tgt);
    let translations = (ctx.ok ? ctx.translations : []).filter(t => t && t.trim());
    let examples     = (ctx.ok ? ctx.examples     : []).filter(e => e.source && e.target);

    // 2) Fallback переводов через getTranslation
    if (!translations.length) {
      const tr = await robustTranslation(text, src, tgt);
      translations = (tr.translations || []).filter(t => t && t.trim());
    }

    // 3) Fallback примеров через getTranslation
    if (!examples.length) {
      const tr = await robustTranslation(text, src, tgt);
      examples = (tr.context?.examples || []).map((e, i) => ({ id: i, source: e.source, target: e.target }));
    }

    // 4) Если всё ещё пусто — Puppeteer-фоллбэк
    if (!translations.length || !examples.length) {
      console.info('Using Puppeteer fallback for', text);
      const pf = await puppeteerFallback(text, from, to);
      if (!translations.length) translations = pf.translations;
      if (!examples.length)     examples     = pf.examples;
    }

    return res.json({ text, source: from, target: to, translations, examples });
  } catch (err) {
    console.error('Fatal error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
