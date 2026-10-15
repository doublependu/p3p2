// The portal's stylesheet and script. They are served as files (the CSP allows no inline code)
// but kept as strings, so the server stays a single bundle with nothing to copy at build time.

export const PORTAL_CSS: string = `
:root {
  color-scheme: light dark;
  --bg: #f6f5f1; --card: #fff; --ink: #1d1c19; --soft: #6b6860; --line: #dedbd2;
  --accent: #2f6f3e; --accent-ink: #fff; --danger: #a8321f; --ok: #2f6f3e; --field: #fff;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161714; --card: #1f201c; --ink: #ecebe4; --soft: #a3a094; --line: #34352f;
    --accent: #7fc48f; --accent-ink: #0f1a12; --danger: #f08a75; --ok: #7fc48f; --field: #161714;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); }
a { color: var(--accent); }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
header .brand { font-weight: 700; color: var(--ink); text-decoration: none; }
header .where { color: var(--soft); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { max-width: 760px; margin: 0 auto; padding: 16px 16px 64px; }
footer { max-width: 760px; margin: -48px auto 0; padding: 0 16px 24px; color: var(--soft); font-size: .875rem; }
h1 { font-size: 1.5rem; margin: 16px 0 4px; overflow-wrap: anywhere; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
p { margin: 0 0 12px; }
.soft { color: var(--soft); }
.small { font-size: .875rem; }
.hint { margin-top: 8px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 16px 0; }
.card.danger { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
label { display: block; font-weight: 600; font-size: .875rem; margin: 12px 0 4px; }
label .soft { font-weight: 400; }
input, textarea, select, button { font: inherit; color: inherit; }
input[type=text], input[type=password], input[type=number], input[type=url], textarea, select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--field);
}
textarea { min-height: 5em; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875rem; }
input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875rem; }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button, .button {
  display: inline-block; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--card); cursor: pointer; text-decoration: none; color: var(--ink); white-space: nowrap;
}
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
button.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
button.link { border: 0; background: none; padding: 0; color: var(--accent); text-decoration: underline; }
.row { display: flex; gap: 8px; align-items: center; }
.row > input { flex: 1; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.actions form { margin: 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
.error { color: var(--danger); font-weight: 600; }
.badge { display: inline-block; padding: 0 8px; border-radius: 999px; border: 1px solid var(--line); font-size: .75rem; color: var(--soft); }
.badge.on { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list > li { display: flex; gap: 8px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
ul.list > li:first-child { border-top: 0; }
ul.list .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
ul.list a.name { font-weight: 600; text-decoration: none; }
.qr { display: block; width: 220px; max-width: 100%; height: auto; margin-top: 12px; border-radius: 8px; background: #fff; }
.narrow { max-width: 420px; margin: 48px auto; }
`

export const PORTAL_JS: string = `
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-copy]');
  if (!button) return;
  const input = document.getElementById(button.dataset.copy);
  let done = false;
  try { await navigator.clipboard.writeText(input.value); done = true; } catch {}
  if (!done) {
    // Plain http has no Clipboard API: select the text so it can be copied by hand.
    input.focus(); input.select();
    try { done = document.execCommand('copy'); } catch {}
  }
  const label = button.textContent;
  button.textContent = done ? 'Copied' : 'Press Ctrl+C';
  setTimeout(() => { button.textContent = label; }, 1500);
});
document.addEventListener('submit', (e) => {
  const question = e.target.dataset.confirm;
  if (question && !confirm(question)) e.preventDefault();
});
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input[readonly]')) e.target.select();
});
`
