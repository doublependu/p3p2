// Server-rendered portal pages. `html` escapes every interpolated value, except the mark, a constant.

import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { LiveInfo } from '../core/hub.ts'
import { FRONT_HIDDEN, type InviteRecord, type RoomRecord, type VersionPolicy } from '../core/types.ts'
import { VERSION } from '../version.ts'
import { MARK } from './assets.ts'
import { PASSWORD_MIN } from './password.ts'

export type Page = HtmlEscapedString | Promise<HtmlEscapedString>

/** What every page says about this server: its name, and where its source code is. */
export interface Server {
  name: string
  source: string
}

interface Frame {
  title: string
  server: Server
  owner: boolean
}

function layout(f: Frame, body: Page): Page {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${f.title} · p3p2</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/portal.css">
<script src="/assets/portal.js" defer></script>
</head>
<body>
<header>
  <a class="brand" href="/">${raw(MARK)}p3p2</a>
  <span class="where">${f.server.name}</span>
  ${f.owner ? html`<form method="post" action="/logout"><button class="link" type="submit">Log out</button></form>` : ''}
</header>
<main>${body}</main>
<footer>p3p2 ${VERSION} · <a href="${f.server.source}">Source code</a></footer>
</body>
</html>`
}

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function setupPage(server: Server, token: string, error: string = ''): Page {
  return layout(
    { title: 'Set up', server, owner: false },
    html`<div class="card narrow">
  <h1>Set up this server</h1>
  <p class="soft">Choose the owner password. It protects this portal, where rooms are created.</p>
  ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
  <form method="post" action="/setup">
    <input type="hidden" name="token" value="${token}">
    <label for="password">Password <span class="soft">(at least ${PASSWORD_MIN} characters)</span></label>
    <input id="password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required autofocus>
    <label for="confirm">Password again</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required>
    <div class="actions"><button class="primary" type="submit">Save password</button></div>
  </form>
</div>`,
  )
}

export function setupNeededPage(server: Server): Page {
  return layout(
    { title: 'Set up', server, owner: false },
    html`<div class="card narrow">
  <h1>This server is not set up yet</h1>
  <p>Open the setup link the server printed when it started. With Docker:</p>
  <p><code>docker compose logs p3p2</code></p>
  <p class="soft small">The link works once. Restarting the server prints a new one.</p>
</div>`,
  )
}

export function loginPage(server: Server, error: string = ''): Page {
  return layout(
    { title: 'Log in', server, owner: false },
    html`<div class="card narrow">
  <h1>Owner log in</h1>
  ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
  <form method="post" action="/login">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <div class="actions"><button class="primary" type="submit">Log in</button></div>
  </form>
</div>`,
  )
}

export interface RoomSummary {
  room: RoomRecord
  online: number
  invited: boolean
}

export interface NewRoomForm {
  game: string
  name: string
  maxMembers: string
  origins: string
  error: string
}

export function dashboardPage(server: Server, rooms: RoomSummary[], form: NewRoomForm, defaultMax: number, cap: number): Page {
  return layout(
    { title: 'Rooms', server, owner: true },
    html`<h1>Rooms</h1>
<p class="soft">A room belongs to one game. Paste its URL into that game's multiplayer menu to host.</p>
<div class="card">
  ${
    rooms.length
      ? html`<ul class="list">${rooms.map(
          (r) => html`<li>
    <span class="grow"><a class="name" href="/room/${r.room.key}">${r.room.name}</a><br><span class="soft small">${host(r.room.gameUrl)}</span></span>
    ${r.room.front !== null ? html`<span class="badge">on the front page</span>` : ''}
    ${r.invited ? html`<span class="badge">invite open</span>` : ''}
    <span class="badge ${r.online ? 'on' : ''}">${r.online} online</span>
  </li>`,
        )}</ul>
  ${
    rooms.some((r) => r.room.front !== null)
      ? html`<p class="soft small hint">The rooms on the front page are listed at this server's address, for anyone who isn't logged in, while their invite is open.</p>`
      : ''
  }`
      : html`<p class="soft">No rooms yet.</p>`
  }
</div>
<div class="card">
  <h2>New room</h2>
  ${form.error ? html`<p class="error" role="alert">${form.error}</p>` : ''}
  <form method="post" action="/rooms">
    <label for="game">Game URL</label>
    <input id="game" name="game" type="text" inputmode="url" placeholder="game.example.com" value="${form.game}" required>
    <div class="grid">
      <div>
        <label for="name">Room name <span class="soft">(optional)</span></label>
        <input id="name" name="name" type="text" maxlength="60" placeholder="Friday night" value="${form.name}">
      </div>
      <div>
        <label for="max">Most players</label>
        <input id="max" name="max" type="number" min="1" max="${cap}" value="${form.maxMembers || defaultMax}">
      </div>
    </div>
    <label for="origins">Other sites that may use this room <span class="soft">(optional, one per line)</span></label>
    <textarea id="origins" name="origins" placeholder="http://192.168.1.118:5173">${form.origins}</textarea>
    <p class="soft small">The room only works from the game's own site. Add the address of a local dev server here to test from it.</p>
    <div class="actions"><button class="primary" type="submit">Create room</button></div>
  </form>
</div>`,
  )
}

const VERSION_CHOICES: [VersionPolicy, string][] = [
  ['exact', 'Keep them apart: everyone has exactly the same version'],
  ['major', 'Let them play together if the first number matches (1.2 with 1.5)'],
  ['off', 'Let everyone play together'],
]

const FRONT_CHOICES: [string, string][] = [
  ['off', 'Not shown'],
  ['0', 'Shown, with the whole invite link'],
  ...FRONT_HIDDEN.filter((n) => n > 0).map((n): [string, string] => [String(n), `Shown, without the link's last ${n} characters`]),
]

/** Under the invite link: how the front page shows it, and the characters it leaves out, which the host passes on. */
function frontNote(room: RoomRecord, invite: InviteRecord): Page | '' {
  if (room.front === null) return ''
  if (room.front === 0) return html`<p class="soft small">The front page shows this link whole.</p>`
  return html`<p class="small">On the front page the link is shown without its last ${room.front} characters: <b class="mono">${invite.code.slice(-room.front)}</b>. Friends who come that way type them. They change with every new invite.</p>`
}

export interface RoomView {
  room: RoomRecord
  roomUrl: string
  invite: InviteRecord | null
  inviteLink: string
  expiry: string
  live: LiveInfo | null
  error: string
  cap: number
}

export function roomPage(server: Server, v: RoomView): Page {
  const { room, live } = v
  const base = `/room/${room.key}`
  const members = live?.members ?? []
  return layout(
    { title: room.name, server, owner: true },
    html`<p class="small"><a href="/">← Rooms</a></p>
<h1>${room.name}</h1>
<p class="soft">A room for <a href="${room.gameUrl}" rel="noreferrer" target="_blank">${host(room.gameUrl)}</a></p>
${v.error ? html`<p class="error" role="alert">${v.error}</p>` : ''}

<div class="card">
  <h2>Room URL</h2>
  <div class="row">
    <input class="mono" id="room-url" type="text" readonly value="${v.roomUrl}" aria-label="Room URL">
    <button type="button" data-copy="room-url">Copy</button>
  </div>
  <p class="soft small hint">Paste it into the game's multiplayer menu. Anyone who has this URL can host in this room, so keep it to yourself.</p>
</div>

<div class="card">
  <h2>Invite link</h2>
  ${
    v.invite
      ? html`<div class="row">
    <input class="mono" id="invite-url" type="text" readonly value="${v.inviteLink}" aria-label="Invite link">
    <button type="button" data-copy="invite-url">Copy</button>
    <a class="button" href="${v.inviteLink}" target="_blank" rel="noreferrer" title="Open the game in a new tab">Open</a>
  </div>
  <p class="soft small hint">${v.expiry} Friends who open it join this room.</p>
  ${frontNote(room, v.invite)}
  <img class="qr" src="${base}/qr.svg?c=${v.invite.code.slice(0, 4)}" width="220" height="220" alt="QR code of the invite link">
  <div class="actions">
    <form method="post" action="${base}/invite" data-confirm="Make a new invite link? The current one stops working for new players.">
      <button type="submit">Renew invite</button>
    </form>
  </div>`
      : html`<p class="soft">No invite is open. The game makes one when you host; you can also make one here.</p>
  <div class="actions"><form method="post" action="${base}/invite"><button type="submit">Create invite</button></form></div>`
  }
</div>

<div class="card">
  <h2>Players online <span class="badge ${members.length ? 'on' : ''}">${members.length}</span></h2>
  ${
    members.length
      ? html`<ul class="list">${members.map(
          (m) => html`<li>
    <span class="grow">${m.name}
      ${m.id === live?.host ? html`<span class="badge on">host</span>` : ''}
      ${m.mod ? html`<span class="badge">has the room URL</span>` : ''}
      ${m.connected ? '' : html`<span class="badge">reconnecting</span>`}
      ${m.connected && m.away ? html`<span class="badge">in the background</span>` : ''}
      ${m.connected && m.state === 'lost' ? html`<span class="badge">not heard from</span>` : ''}
      ${m.rtt >= 0 ? html`<span class="soft small">${Math.round(m.rtt)} ms</span>` : ''}
    </span>
    <form method="post" action="${base}/kick"><input type="hidden" name="member" value="${m.id}"><button type="submit">Kick</button></form>
  </li>`,
        )}</ul>
  <div class="actions">
    <form method="post" action="${base}/end" data-confirm="End the session? Everyone is disconnected and the invite link stops working.">
      <button type="submit">End session</button>
    </form>
    <a class="button" href="${base}">Refresh</a>
  </div>`
      : html`<p class="soft">Nobody is here right now. <a href="${base}">Refresh</a></p>`
  }
</div>

<div class="card">
  <h2>Settings</h2>
  <form method="post" action="${base}/settings">
    <div class="grid">
      <div>
        <label for="name">Room name</label>
        <input id="name" name="name" type="text" maxlength="60" value="${room.name}" required>
      </div>
      <div>
        <label for="max">Most players</label>
        <input id="max" name="max" type="number" min="1" max="${v.cap}" value="${room.maxMembers}" required>
      </div>
    </div>
    <label for="origins">Sites that may use this room <span class="soft">(one per line)</span></label>
    <textarea id="origins" name="origins">${room.origins.join('\n')}</textarea>
    <p class="soft small">The game's own site is always allowed.</p>
    <label for="versions">Players on different versions of the game</label>
    <select id="versions" name="versions">${VERSION_CHOICES.map(
      ([value, text]) => html`<option value="${value}" ${value === room.versionPolicy ? 'selected' : ''}>${text}</option>`,
    )}</select>
    <p class="soft small">The room's version is that of the players already in it. A player who is refused has to reload the game.</p>
    <label for="front">On this server's front page</label>
    <select id="front" name="front">${FRONT_CHOICES.map(
      ([value, text]) => html`<option value="${value}" ${value === String(room.front ?? 'off') ? 'selected' : ''}>${text}</option>`,
    )}</select>
    <p class="soft small">The front page is this server's address, for anyone who isn't logged in. Hiding more of the link, or taking the room off, makes a new invite. Only games on p3p2 0.2 or later ask for the characters left out.</p>
    <div class="actions"><button type="submit">Save</button></div>
  </form>
  <h3>The game</h3>
  ${
    room.gameId
      ? html`<p>This room is for <code>${room.gameId}</code>, the game first played in it. Another game on the same site is refused: it would read what this one saved.</p>
  <form method="post" action="${base}/game" data-confirm="Let another game into this room? The next game to come in is the one it is for; what this one saved stays.">
    <button type="submit">Let another game in</button>
  </form>`
      : html`<p class="soft">No game has played in this room yet. The first that does is the one it is for.</p>`
  }
</div>

<div class="card danger">
  <h2>Danger zone</h2>
  <div class="actions">
    <form method="post" action="${base}/clear" data-confirm="Delete everything the game saved in this room? Players online are disconnected.">
      <button class="danger" type="submit">Clear saved data</button>
    </form>
    <form method="post" action="${base}/rotate" data-confirm="Replace the room URL with a new one? The old URL stops working and the session ends.">
      <button class="danger" type="submit">Rotate key</button>
    </form>
    <form method="post" action="${base}/delete" data-confirm="Delete this room and everything saved in it?">
      <button class="danger" type="submit">Delete room</button>
    </form>
  </div>
</div>`,
  )
}

/** A room on the front page. `link` leaves out the last `hidden` characters of the code, a dash in place of each. */
export interface FrontRoom {
  name: string
  game: string
  members: number
  maxMembers: number
  link: string
  hidden: number
}

/** The server's address, for anyone who isn't logged in, once its owner has put a room on it. */
export function frontPage(server: Server, rooms: FrontRoom[]): Page {
  return layout(
    { title: 'Rooms', server, owner: false },
    html`<h1>Rooms</h1>
<p class="soft">Rooms on this server that friends can join. <b>Play</b> opens the game, which asks whether to join.</p>
${
  rooms.length
    ? rooms.map(
        (r) => html`<div class="card">
  <h2>${r.name}</h2>
  <p class="soft small">${host(r.game)} · ${r.members >= r.maxMembers ? 'full' : `${r.members} of ${r.maxMembers} playing`}</p>
  <div class="row">
    <input class="mono" type="text" readonly value="${r.link}" aria-label="Invite link to ${r.name}">
    <a class="button primary" href="${r.link}">Play</a>
  </div>
  ${
    r.hidden
      ? html`<p class="soft small hint">The game asks for the last ${r.hidden} characters. Whoever invited you has them. If the game doesn't ask, ask them for the whole link.</p>`
      : ''
  }
</div>`,
      )
    : html`<div class="card"><p class="soft">No room is open right now.</p></div>`
}
<p class="soft small"><a href="/login">Owner log in</a></p>`,
  )
}

export function publicRoomPage(server: Server, room: RoomRecord): Page {
  return layout(
    { title: room.name, server, owner: false },
    html`<div class="card narrow">
  <h1>${room.name}</h1>
  <p>This is a p3p2 room for <a href="${room.gameUrl}" rel="noreferrer">${host(room.gameUrl)}</a>.</p>
  <p>To host a game in it, copy this page's address and paste it into the game's multiplayer menu.</p>
  <p class="soft small"><a href="/login">Owner log in</a></p>
</div>`,
  )
}

export function messagePage(server: Server, owner: boolean, title: string, text: string): Page {
  return layout(
    { title, server, owner },
    html`<div class="card narrow">
  <h1>${title}</h1>
  <p>${text}</p>
  <p class="small"><a href="/">Back to the portal</a></p>
</div>`,
  )
}
