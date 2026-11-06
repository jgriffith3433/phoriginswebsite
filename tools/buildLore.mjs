// Builds the lore site pages from site/lore.json (the long text) and locales/en.json (the lede, shared with the game's
// Level Complete card). Writes lore.html and lore/<slug>.html at the repo root. Run: node tools/buildLore.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = JSON.parse(fs.readFileSync(path.join(root, 'site/lore.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8')).lines;
const line = (id) => lines.find((l) => l.id === id)?.text ?? '';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&rsquo;');

const page = ({ dir, title, description, hero, body, nav }) => {
  const up = dir ? '../' : './';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#05080c" />
    <meta name="description" content="${esc(description)}" />
    <link rel="icon" href="${up}favicon.svg" type="image/svg+xml" />
    <title>${esc(title)} — PH Origins</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="${up}site/marketing.css" />
    <!-- Hawkes Analytics (anonymous, no cookies): the build from the last game build, then the SDK from Hawkes Gen. -->
    <script src="${up}play/hawkes-build.js" defer></script>
    <script src="https://hawkesgen.ai/sdk/analytics@1.js" data-product="phorigins" defer></script>
  </head>
  <body data-page="lore">
    <a class="skip" href="#content">Skip to content</a>

    <header class="nav is-solid">
      <div class="nav-inner">
        <a class="brand" href="${up}index.html">
          <svg viewBox="0 0 256 256" aria-hidden="true">
            <path d="M72 176L128 52l56 124H72zm28-18h60L128 94l-28 64z" fill="#67d2ff" />
            <circle cx="128" cy="86" r="20" fill="#7af0c9" />
          </svg>
          PH Origins
        </a>
        <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="nav-links">
          Menu
        </button>
        <nav class="nav-links" id="nav-links" aria-label="Primary">
          <a href="${up}index.html" data-nav="home">Home</a>
          <a href="${up}about.html" data-nav="about">About</a>
          <a href="${up}characters.html" data-nav="characters">Characters</a>
          <a href="${up}lore.html" data-nav="lore">Lore</a>
        </nav>
        <div class="nav-tools">
          <button type="button" class="music-btn" id="musicBtn" aria-pressed="false" aria-label="Play music">
            <svg class="icon-on" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10v4h3l4 3V7L7 10H4z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18 6a8.5 8.5 0 0 1 0 12" />
            </svg>
            <svg class="icon-off" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10v4h3l4 3V7L7 10H4z" />
              <path d="M16 9l5 6M21 9l-5 6" />
            </svg>
          </button>
          <a class="nav-play" data-play href="${up}play/game.html">Play</a>
        </div>
      </div>
    </header>

    <main id="content">
      <section class="page-hero" style="background-image: url('${up}assets/landing/bg-1.jpg')">
        <div class="wrap">
${hero}
        </div>
      </section>
${body}
    </main>

    <footer>
      <div class="wrap-wide site-footer">
        <span>Hawkes Tower — 58th floor</span>
        <nav aria-label="Footer">
          <a href="${up}index.html">Home</a>
          <a href="${up}lore.html">Lore</a>
          <a href="${up}whatsnew.html">What&rsquo;s new</a>
          <a data-play href="${up}play/game.html">Play</a>
        </nav>
        <a class="footer-version" href="${up}whatsnew.html" data-hawkes-version data-prefix="Version " hidden></a>
        <p class="hawkes-credit">
          <a href="https://hawkesgen.ai" target="_blank" rel="noopener" data-hawkes-credit="gen">Powered by <strong>HAWKES GEN</strong></a>
        </p>
        <p class="site-privacy">This site collects anonymous gameplay statistics to improve the game: no cookies, no personal data, no IP address stored.</p>
      </div>
    </footer>

    <audio id="landingAudio" src="${up}assets/audio/landing-page-song.mp3" loop preload="metadata" playsinline></audio>
    <script src="${up}site/marketing.js" defer></script>
    <script src="${up}site/hawkes-release.js" data-releases="${up}releases.json" defer></script>
  </body>
</html>
`;
};

fs.mkdirSync(path.join(root, 'lore'), { recursive: true });

for (const e of entries) {
  const lede = line(`lore.${e.n}.text`);
  const prev = entries[e.n - 2];
  const next = entries[e.n];
  const html = page({
    dir: 'lore',
    title: `${e.title} — lore`,
    description: lede,
    hero: `          <p class="eyebrow">Chapter ${e.n} · ${esc(e.kicker)}</p>
          <h1 class="page-title">${esc(line(`lore.${e.n}.title`))}</h1>`,
    body: `
      <section class="band band-tight">
        <div class="wrap prose" data-lore="${e.n}">
          <p class="lede">${esc(lede)}</p>
${e.body.map((p) => `          <p>${esc(p)}</p>`).join('\n')}
          <div class="actions">
            <a class="play-btn" data-play data-level="${e.n}" href="../play/game.html?level=${e.n}">Play this level</a>
            <a class="text-link" href="../lore.html">All lore</a>
${prev ? `            <a class="text-link" href="./${prev.slug}.html">&larr; ${esc(prev.title)}</a>\n` : ''}${next ? `            <a class="text-link" href="./${next.slug}.html">${esc(next.title)} &rarr;</a>\n` : ''}          </div>
        </div>
      </section>`,
  });
  fs.writeFileSync(path.join(root, 'lore', `${e.slug}.html`), html);
}

fs.writeFileSync(
  path.join(root, 'lore.html'),
  page({
    dir: '',
    title: 'Lore',
    description: 'The lore of PH Origins, one entry per chapter. Finish a level in the game to unlock its entry.',
    hero: `          <p class="eyebrow">Hawkes Tower</p>
          <h1 class="page-title">Lore</h1>`,
    body: `
      <section class="band band-tight">
        <div class="wrap prose">
          <p>One entry for every level. Finish a chapter in the game and its entry unlocks on the Level Complete card, with a link back here. Every page here sends you back into the level it describes.</p>
        </div>
      </section>
      <section class="band" aria-labelledby="lore-title">
        <div class="wrap-wide">
          <div class="section-head">
            <div>
              <p class="eyebrow">The night</p>
              <h2 class="section-title" id="lore-title">Eight chapters</h2>
            </div>
          </div>
          <div class="levels">
${entries
  .map(
    (e) => `            <article class="level" data-level="${e.n}">
              <p class="kicker">Chapter ${e.n}</p>
              <h3><a href="./lore/${e.slug}.html">${esc(line(`lore.${e.n}.title`))}</a></h3>
              <p>${esc(line(`lore.${e.n}.text`))}</p>
              <a class="text-link" href="./lore/${e.slug}.html">Read the entry</a>
            </article>`,
  )
  .join('\n')}
          </div>
        </div>
      </section>`,
  }),
);
console.log(`lore: ${entries.length} entries written`);
