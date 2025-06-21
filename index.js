 
const express = require('express');
const Reverso = require('reverso-api');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Лог каждого запроса
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

// Маппинг ISO → названия языков для Reverso
const langMap = {
  en: 'english', ru: 'russian',
  fr: 'french', de: 'german',
  es: 'spanish', it: 'italian',
  pt: 'portuguese'
};

// One instance of Reverso
const reverso = new Reverso();

// Exponential backoff + jitter helper
async function backoff(attempt) {
  const delay = 300 * Math.pow(2, attempt) + Math.random() * 500;
  await new Promise(r => setTimeout(r, delay));
}

// Robust getContext with retries
async function robustContext(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const ctx = await reverso.getContext(text, from, to);
      if (ctx.ok && ((ctx.translations || []).length || (ctx.examples || []).length)) {
        return ctx;
      }
    } catch (e) {
      console.warn(`getContext try #${i+1} failed:`, e.message);
    }
    await backoff(i);
  }
  return { ok: false, translations: [], examples: [] };
}

// Robust getTranslation with retries
async function robustTranslation(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const tr = await reverso.getTranslation(text, from, to);
      if (Array.isArray(tr.translations) && tr.translations.length) {
        return tr;
      }
    } catch (e) {
      console.warn(`getTranslation try #${i+1} failed:`, e.message);
    }
    await backoff(i);
  }
  return { translations: [], context: { examples: [] } };
}

// Puppeteer fallback for context and translations
async function puppeteerFallback(text, from, to) {
  const url = `https://context.reverso.net/translation/${from}-${to}/${encodeURIComponent(text)}`;
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Extract translations
  const translations = await page.$$eval('.translations-content .translation', nodes =>
    nodes.map(n => n.textContent.trim()).filter(t => t)
  );
  // Extract examples
  const examples = await page.$$eval('.example', nodes =>
    nodes.map((n, i) => {
      const src = n.querySelector('.example-source')?.textContent.trim() || '';
      const tgt = n.querySelector('.example-target')?.textContent.trim() || '';
      return { id: i, source: src, target: tgt };
    }).filter(e => e.source && e.target)
  );

  await browser.close();
  return { translations, examples };
}

app.get('/api/translate', async (req, res) => {
  const { text, from = 'en', to = 'ru' } = req.query;
  if (!text) {
    return res.status(400).json({ error: 'Missing "text" parameter' });
  }

  const srcLang = langMap[from] || from;
  const tgtLang = langMap[to] || to;

  try {
    // 1) Try Reverso API
    const ctx = await robustContext(text, srcLang, tgtLang);
    let translations = (ctx.ok ? ctx.translations : []).filter(t => t && t.trim());
    let examples = (ctx.ok ? ctx.examples : []).filter(e => (e.source && e.source.trim()) && (e.target && e.target.trim()));

    // 2) Fallback translations
    if (!translations.length) {
      const tr = await robustTranslation(text, srcLang, tgtLang);
      translations = (tr.translations || []).filter(t => t && t.trim());
    }

    // 3) Fallback examples via API
    if (!examples.length) {
      const tr = await robustTranslation(text, srcLang, tgtLang);
      const raw = (tr.context?.examples || []);
      examples = raw.map((e, i) => ({ id: i, source: e.source, target: e.target }))
                    .filter(e => e.source && e.target);
    }

    // 4) If still empty, Puppeteer fallback
    if (!translations.length || !examples.length) {
      console.info('Using Puppeteer fallback for', text);
      const pu = await puppeteerFallback(text, from, to);
      translations = translations.length ? translations : pu.translations;
      examples = examples.length ? examples : pu.examples;
    }

    return res.json({ text, source: from, target: to, translations, examples });
  } catch (err) {
    console.error('Fatal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
 
