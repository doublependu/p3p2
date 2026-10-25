export const STYLE: string = `
:host {
  all: initial; display: block; position: fixed; z-index: 2147483000;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
  color-scheme: light dark; -webkit-tap-highlight-color: transparent;
  --bg: #fff; --ink: #1d1c19; --soft: #6b6860; --line: #d9d6cc; --field: #fff; --fixed: #f0eee8;
  --accent: #0b6e61; --accent-ink: #fff; --ok: #2f6f3e; --danger: #a8321f; --pill: #1f201ccc; --pill-ink: #fff;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1f201c; --ink: #ecebe4; --soft: #a3a094; --line: #3a3b35; --field: #161714; --fixed: #2b2c27;
    --accent: #2cc7b1; --accent-ink: #04201c; --ok: #7fc48f; --danger: #f08a75;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input { font: inherit; color: inherit; }
button { cursor: pointer; border: 1px solid var(--line); border-radius: 8px; background: transparent; padding: 6px 10px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
/* The ring is for the keyboard: the link, clicked or tapped, shows none. */
input[data-pointer]:focus-visible { outline: none; }
input { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); }
a { color: var(--accent); }
@media (pointer: coarse) { input { font-size: 16px; } button { padding: 8px 12px; } }

.pill {
  position: relative; display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 99px;
  line-height: 1; font-size: 16px; border: 1px solid #8888; background: var(--pill); color: var(--pill-ink);
}
/* Gray alone; teal, pulsing, while the room's server is heard from. Not the theme's: the button is dark in both. */
.mark { color: #a3a094; }
.live .mark { color: #2cc7b1; animation: beat 2s ease-in-out infinite; }
@keyframes beat { 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .live .mark { animation: none; } }
/* On the button's top-right corner, clear of the count. */
.unread {
  position: absolute; top: -8px; right: -8px; min-width: 16px; padding: 0 4px; border-radius: 8px;
  background: #e5484d; color: #fff; font: 700 10px/16px system-ui; text-align: center; box-shadow: 0 0 0 2px #1f201c;
}

.card {
  width: 300px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 6px 24px #0005;
}
header { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--line); }
header b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header .tail { font-weight: 400; font-size: 12px; color: var(--soft); }
/* The name, as the portal sets it. */
.wordmark { font: 700 16px/1 "Iowan Old Style", "Palatino Linotype", Palatino, P052, Georgia, serif; }
header button { border: 0; font-size: 18px; line-height: 1; padding: 4px 8px; }
.body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
/* A tall panel scrolls; its parts keep their size. */
.body > * { flex-shrink: 0; }
.group { display: flex; flex-direction: column; gap: 6px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--soft); }
label input, label button, .whole { font-size: 14px; font-weight: 400; color: var(--ink); }
p { margin: 0; overflow-wrap: anywhere; }
.soft { color: var(--soft); font-size: 12px; }
.status { font-size: 12px; min-height: 1.4em; }
.status.bad { color: var(--danger); }
.row { display: flex; gap: 6px; align-items: center; }
.row > input { flex: 1; }
.row > .grow { flex: 1; }
/* Always dark on white, whatever the theme: a scanner needs the contrast and the white margin. */
.qr { display: block; width: 200px; max-width: 100%; height: auto; margin: 0 auto; padding: 8px; background: #fff; border-radius: 6px; image-rendering: pixelated; }

ul, ol { list-style: none; margin: 0; padding: 0; }
.members li { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.members .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 11px; color: var(--soft); border: 1px solid var(--line); border-radius: 99px; padding: 0 6px; }
.tag.host { color: var(--ok); border-color: var(--ok); }
.log { height: 120px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; background: var(--field); overflow-wrap: anywhere; }
/* What nobody types in looks it: tinted, without the field's edge. */
input[readonly], .log { background: var(--fixed); border-color: transparent; text-overflow: ellipsis; }
/* The whole link, when it doesn't fit: while pointed at, or on the keyboard's focus. */
.link { position: relative; }
.whole {
  display: none; position: absolute; z-index: 1; top: 100%; left: 0; right: 0; margin-top: 4px; padding: 6px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 16px #0004;
  overflow-wrap: anywhere; pointer-events: none;
}
.cut:hover > .whole { display: block; }
/* Apart, for browsers without :has(). */
.cut:has(> :focus-visible:not([data-pointer])) > .whole { display: block; }
/* A phone on its side: little height, and the keyboard takes half of it. */
@media (max-height: 480px) { .log { height: 60px; } }
.log li { padding: 1px 0; }
.log .who { font-weight: 600; }
.log .note { color: var(--soft); font-size: 12px; }
`
