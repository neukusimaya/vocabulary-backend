const express   = require('express');
const Reverso   = require('reverso-api');
const puppeteer = require('puppeteer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} query=`, req.query);
  next();
});

const langMap = { en: 'english', ru: 'russian', fr: 'french', de: 'german', es: 'spanish', it: 'italian', pt: 'portuguese' };
const reverso = new Reverso();

async function backoff(attempt) {
  const delay = 300 * 2**attempt + Math.random() * 500;
  return new Promise(r => setTimeout(r, delay));
}

async function robustContext(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const ctx = await reverso.getContext(text, from, to);
      if (ctx.ok && ((ctx.translations.length) || (ctx.examples.length))) return ctx;
    } catch {};
    await backoff(i);
  }
  return { ok: false, translations: [], examples: [] };
}

async function robustTranslation(text, from, to) {
  for (let i = 0; i < 3; i++) {
    try {
      const tr = await reverso.getTranslation(text, from, to);
      if (tr.translations.length) return tr;
    } catch {};
    await backoff(i);
  }
  return { translations: [], context: { examples: [] } };
}

async function puppeteerFallback(text, from, to) {
  const url = `https://context.reverso.net/translation/${from}-${to}/${encodeURIComponent(text)}`;
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const translations = await page.$$eval(
    '.translations-content .translation',
    nodes => nodes.map(n => n.textContent.trim()).filter(t => t)
  );
  const examples = await page.$$eval(
    '.example',
    nodes => nodes.map((n,i) => ({ id:i, source:n.querySelector('.example-source')?.textContent.trim(), target:n.querySelector('.example-target')?.textContent.trim() })).filter(e => e.source && e.target)
  );

  await browser.close();
  return { translations, examples };
}

app.get('/api/translate', async (req, res) => {
  const { text, from='en', to='ru' } = req.query;
  if (!text) return res.status(400).json({ error:'Missing text' });

  const src = langMap[from] || from;
  const tgt = langMap[to]   || to;

  let ctx = await robustContext(text, src, tgt);
  let translations = ctx.ok ? ctx.translations : [];
  let examples     = ctx.ok ? ctx.examples     : [];

  if (!translations.length) {
    const tr = await robustTranslation(text, src, tgt);
    translations = tr.translations;
  }
  if (!examples.length) {
    const tr = await robustTranslation(text, src, tgt);
    examples = tr.context.examples.map((e,i) => ({ id:i, source:e.source, target:e.target }));
  }

  if (!translations.length || !examples.length) {
    console.info('Using Puppeteer fallback for', text);
    const pf = await puppeteerFallback(text, from, to);
    if (!translations.length) translations = pf.translations;
    if (!examples.length)     examples     = pf.examples;
  }

  res.json({ text, source:from, target:to, translations, examples });
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));