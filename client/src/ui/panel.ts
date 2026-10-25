// <p3p2-panel>: "Join?" for an invite link, the link to pass on, who is here, chat.
// Everything that comes from the server or from other players is written with textContent.

import { NAME_MAX } from '@p3p2/protocol'
import type { Controller } from '../core.ts'
import type { Failure } from '../errors.ts'
import type { Bridge } from '../index.ts'
import { logo } from '../logo.ts'
import { CHAT_MAX, type RoomClient, SYNC } from '../room.ts'
import type { ChatMessage, CloseReason, Invite, Room } from '../types.ts'
import { STYLE } from './style.ts'

const TAG = 'p3p2-panel'

type Props = Record<string, string | boolean | number>

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = String(value)
    else if (typeof value === 'boolean') el.toggleAttribute(key, value)
    else el.setAttribute(key, String(value))
  }
  el.append(...children)
  return el
}

function serverName(server: string): string {
  try {
    return new URL(server).host
  } catch {
    return server
  }
}

/**
 * Characters of an invite code as a player types them, read the way its alphabet reads them: capitals as small
 * letters, o as 0, i and l as 1, without spaces. "K3 F9", read out over the phone, is k3f9.
 */
function readCode(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').replace(/o/g, '0').replace(/[il]/g, '1')
}

/** The server sends every room its round trips every 5 s: two missed, and some, and the room isn't live. */
const LIVE_MS = 12_000

const CLOSED: Record<CloseReason, string> = {
  left: '',
  kicked: 'You were removed from the room.',
  ended: 'The session was ended.',
  replaced: 'This room is now open in another tab.',
  lost: 'The connection was lost.',
}

export class PanelElement extends HTMLElement {
  private controller!: Controller
  private chatKey: string | false = 'Enter'
  private bare = false
  private readonly root: ShadowRoot
  private readonly pill: HTMLButtonElement
  private readonly count: HTMLSpanElement
  /** On the button's top-right corner: how many chat lines came from the others while the panel was closed. */
  private readonly badge: HTMLSpanElement
  private unread = 0
  private readonly card: HTMLElement
  private readonly title_: HTMLElement
  private readonly body: HTMLElement
  private room: RoomClient | null = null
  private unsubscribe: (() => void)[] = []
  /** Set while a "Join?" question is on screen; answers it with "no". */
  private decline: (() => void) | null = null
  /** Chat was opened with the chat key: sending or Esc gives the keyboard back to the game. */
  private quick = false
  private say: HTMLInputElement | null = null
  /** The last thing the player did here was with a pointer (mouse, pen, touch), not the keyboard. */
  private pointer = false

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.count = h('span')
    this.badge = h('span', { class: 'unread', hidden: true })
    this.pill = h('button', { class: 'pill', type: 'button', 'aria-label': 'Multiplayer', title: 'Multiplayer' }, h('span', { class: 'mark' }, logo()), this.count, this.badge)
    this.title_ = h('b', {}, 'Multiplayer')
    const close = h('button', { type: 'button', 'aria-label': 'Close', title: 'Close' }, '×')
    this.body = h('div', { class: 'body' })
    this.card = h('section', { class: 'card', hidden: true, role: 'dialog', 'aria-label': 'Multiplayer' }, h('header', {}, this.title_, close), this.body)
    // A constructed sheet works under a page CSP that forbids inline styles; <style> would not.
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(STYLE)
      this.root.adoptedStyleSheets = [sheet]
    } catch {
      this.root.append(h('style', {}, STYLE))
    }
    this.root.append(this.pill, this.card)

    this.pill.onclick = () => this.expand()
    close.onclick = () => (this.decline ? this.decline() : this.collapse())

    // The game must not see what is typed or clicked here. keyup still passes: a key that was
    // held when the panel took focus would otherwise stay "down" in the game for good.
    this.root.addEventListener('keydown', (e) => {
      this.pointer = false
      this.onKey(e as KeyboardEvent)
      e.stopPropagation()
    })
    this.root.addEventListener('pointerdown', () => (this.pointer = true))
    for (const type of ['keypress', 'pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) {
      this.root.addEventListener(type, (e) => e.stopPropagation())
    }
    // The whole of a touch, not only its start. A game may cancel touches for the whole page, to
    // keep a double tap from zooming, and a cancelled touch makes no click: without this a button
    // here can go dead under a finger. It only helps against a listener that is not a capturing one.
    for (const type of ['wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      this.root.addEventListener(type, (e) => e.stopPropagation(), { passive: true })
    }
  }

  bind(controller: Controller, bridge: Bridge): void {
    this.controller = controller
    const ui = bridge.options.ui
    this.chatKey = ui === false ? false : (ui?.chatKey ?? 'Enter')
    // A game with a button of its own: this panel shows none, open or closed.
    this.bare = ui !== false && ui?.button === false
    if (this.bare) this.pill.hidden = true
    addEventListener('keydown', (e) => {
      if (e.key !== this.chatKey || !this.room || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      this.quick = true
      this.expand()
      this.say?.focus()
    })
    if (!this.room) this.renderSetup()
  }

  expand(): void {
    this.card.hidden = false
    this.pill.hidden = true
    this.setUnread(0)
    // A game that holds the pointer would leave the player without a cursor to use the panel.
    if (document.pointerLockElement) document.exitPointerLock()
    const log = this.body.querySelector('.log')
    if (log) log.scrollTop = log.scrollHeight
  }

  collapse(): void {
    this.card.hidden = true
    this.pill.hidden = this.bare
    this.quick = false
    // Hand the keyboard back to the game.
    const active = this.root.activeElement
    if (active instanceof HTMLElement) active.blur()
  }

  /** Teal and pulsing while in a room whose server was heard from lately; gray alone, and while it can't be. */
  private drawMark(): void {
    const room = this.room
    this.pill.classList.toggle('live', !!room && room.status === 'open' && Date.now() - room.heardAt < LIVE_MS)
  }

  private setUnread(n: number): void {
    this.unread = n
    this.badge.textContent = n > 9 ? '9+' : String(n)
    this.badge.hidden = n === 0
    // The badge has no words of its own: they are in the button's name.
    this.pill.setAttribute('aria-label', n ? `Multiplayer, ${n} unread message${n === 1 ? '' : 's'}` : 'Multiplayer')
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !this.decline) {
      e.preventDefault()
      this.collapse()
    }
  }

  private setBody(title: string | Node, ...children: Node[]): void {
    this.title_.replaceChildren(title)
    this.body.replaceChildren(...children)
    this.say = null
  }

  private nameField(): HTMLInputElement {
    const input = h('input', { type: 'text', maxlength: NAME_MAX, placeholder: 'Player', autocomplete: 'nickname', enterkeyhint: 'done' })
    input.value = this.controller.name
    input.onchange = () => {
      this.controller.name = input.value
      // The name as it will be used: without what a name cannot have.
      input.value = this.controller.name
    }
    return input
  }

  // ---- not in a room: the way in is an invite link ----

  private renderSetup(note: string = ''): void {
    // In a tab of its own: the game stays open.
    const site = h('a', { href: 'https://p3p2.me/', target: '_blank', rel: 'noopener' }, 'p3p2.me')
    this.setBody(
      h('span', {}, 'Multiplayer ', h('span', { class: 'tail' }, '– Powered by '), h('span', { class: 'wordmark' }, 'p3p2')),
      ...(note ? [h('p', { class: 'status', role: 'status' }, note)] : []),
      h('p', {}, 'Share one small p3p2 relay server.'),
      h('p', {}, 'Already have one? Open the invite link from the server.'),
      h('p', {}, 'No server yet? ', site, ' says how to get one.'),
    )
  }

  // ---- arriving through an invite: ask first ----

  offer(invite: Invite): Promise<Room | null> {
    return new Promise((resolve) => {
      const where = serverName(invite.server)
      const invited = `You were invited to a room on ${where}.`
      // A link from the server's front page leaves the code's last characters out, a dash for each: the player
      // types them, and the invite is looked up once they are all there.
      const known = invite.code.replace(/-+$/, '')
      const missing = invite.code.length - known.length
      const lead = h('p', {}, missing ? invited : 'Looking up the invite…')
      const detail = h('p', { class: 'soft' })
      const name = this.nameField()
      const status = h('p', { class: 'status bad', role: 'status' })
      const join = h('button', { class: 'primary grow', type: 'button', disabled: true }, 'Join')
      const alone = h('button', { type: 'button' }, 'Play alone')
      /** The invite that was found, to join with. */
      let found: Invite | null = null

      const done = (room: Room | null) => {
        this.decline = null
        resolve(room)
      }
      this.decline = () => {
        this.controller.declineInvite()
        this.collapse()
        this.renderSetup()
        done(null)
      }
      alone.onclick = this.decline
      join.onclick = async () => {
        if (!found) return
        join.disabled = true
        status.textContent = ''
        this.controller.name = name.value
        try {
          const room = await this.controller.enterInvite(found)
          // The player came to play: get out of the way.
          this.collapse()
          done(room)
        } catch (err) {
          status.textContent = (err as Error).message
          join.disabled = false
          // Somebody here has that name: another one is what it takes.
          if ((err as Failure).code === 'name') name.focus()
        }
      }

      let turn = 0
      const look = (whole: Invite) => {
        const mine = ++turn
        this.controller.peek(whole).then(
          (d) => {
            if (mine !== turn) return
            found = whole
            lead.replaceChildren('Join ', h('b', {}, d.roomName), ` on ${where}?`)
            const playing = d.members === 1 ? '1 player' : `${d.members} players`
            detail.textContent = d.hostName ? `Hosted by ${d.hostName} · ${playing}` : 'Nobody is here yet'
            join.disabled = false
            // Not away from the characters, which the player may still be changing.
            if (!missing) join.focus()
          },
          (err: Failure) => {
            if (mine !== turn) return
            lead.textContent = invited
            status.textContent = missing && err.code === 'auth' ? "Those aren't the right characters." : err.message
          },
        )
      }

      const parts: Node[] = [lead, detail]
      const chars = missing ? h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go' }) : null
      if (chars) {
        chars.oninput = () => {
          turn++
          found = null
          join.disabled = true
          lead.textContent = invited
          detail.textContent = ''
          status.textContent = ''
          const typed = readCode(chars.value)
          if (typed.length > missing) status.textContent = `Only the last ${missing}.`
          else if (typed.length === missing) look({ server: invite.server, code: known + typed })
        }
        chars.onkeydown = (e) => {
          if (e.key === 'Enter' && !join.disabled) join.click()
        }
        parts.push(h('label', {}, `The last ${missing} characters`, chars))
      }
      this.setBody('Multiplayer', ...parts, h('label', {}, 'Your name', name), status, h('div', { class: 'row' }, join, alone))
      this.expand()
      if (chars) chars.focus()
      else look(invite)
    })
  }

  // ---- in a room ----

  show(room: RoomClient): void {
    for (const off of this.unsubscribe) off()
    this.room = room
    this.decline = null

    const state = h('span', { class: 'soft' })
    const leave = h('button', { type: 'button' }, 'Leave')
    const where = h('div', { class: 'row' }, h('p', { class: 'grow' }, h('span', { class: 'soft' }, `on ${serverName(room.server)} `), state), leave)
    const members = h('ul', { class: 'members' })
    const log = h('ol', { class: 'log', 'aria-live': 'polite' })
    const say = h('input', { type: 'text', maxlength: CHAT_MAX, placeholder: 'Say something…', autocomplete: 'off', enterkeyhint: 'send' })
    // A button as well as Enter: a phone's keyboard does not always have one, and a thumb finds a button sooner.
    const send = h('button', { type: 'button' }, 'Send')
    const parts: Node[] = [where]

    if (room.inviteUrl) parts.push(this.inviteSection(room.inviteUrl))

    const line = (...children: (Node | string)[]) => {
      const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24
      log.append(h('li', {}, ...children))
      while (log.childElementCount > 200) log.firstElementChild?.remove()
      if (pinned) log.scrollTop = log.scrollHeight
    }
    const chatLine = (m: ChatMessage) => line(h('span', { class: 'who' }, `${m.name}: `), m.text)
    const note = (text: string) => line(h('span', { class: 'note' }, text))

    const drawMembers = () => {
      this.count.textContent = String(room.members.length)
      this.drawMark()
      state.textContent = room.status === 'reconnecting' ? '· reconnecting…' : ''
      members.replaceChildren(
        ...room.members.map((m) => {
          const li = h('li', {}, h('span', { class: 'name' }, m.name))
          if (m === room.self) li.append(h('span', { class: 'tag' }, 'you'))
          if (m === room.host) li.append(h('span', { class: 'tag host' }, 'host'))
          if (m.rtt !== null) li.append(h('span', { class: 'soft' }, `${m.rtt} ms`))
          return li
        }),
      )
    }
    const drawChat = () => {
      log.replaceChildren()
      for (const m of room.chat.messages) chatLine(m)
      log.scrollTop = log.scrollHeight
    }

    const speak = () => {
      const text = say.value.trim()
      if (text) room.chat.send(text)
      say.value = ''
      // Opened with the chat key: one line, then back to the game.
      if (this.quick) this.collapse()
    }
    say.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) speak()
    }
    send.onclick = speak
    leave.onclick = () => room.leave()

    // A server can go quiet without the connection closing: then only the clock says so.
    const beat = setInterval(() => this.drawMark(), 1000)
    this.unsubscribe = [
      room.on('member-join', (m) => {
        note(`${m.name} joined`)
        drawMembers()
      }),
      room.on('member-leave', (m) => {
        note(`${m.name} left`)
        drawMembers()
      }),
      room.on('host-change', drawMembers),
      room.on('latency', drawMembers),
      room.on('status', drawMembers),
      room.on(SYNC, () => {
        drawMembers()
        drawChat()
      }),
      room.chat.on((m) => {
        chatLine(m)
        if (this.card.hidden && !m.self) this.setUnread(this.unread + 1)
      }),
      room.on('close', (reason) => this.hide(reason)),
      () => clearInterval(beat),
    ]

    // Removing a player, and ending the game, are for the room's owner, in the server's portal.
    parts.push(members, log, h('div', { class: 'row' }, say, send))
    this.setBody(room.name, ...parts)
    this.say = say
    drawMembers()
    drawChat()
  }

  private hide(reason: CloseReason): void {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
    this.room = null
    this.count.textContent = ''
    this.drawMark()
    this.setUnread(0)
    this.renderSetup(CLOSED[reason])
    if (CLOSED[reason]) this.expand()
  }

  private inviteSection(url: string): HTMLElement {
    const link = h('input', { type: 'text', readonly: true, 'aria-label': 'Invite link' })
    link.value = url
    // When the link doesn't fit, the whole of it shows under it (style.ts): it is cut.
    const field = h('span', { class: 'link' }, link, h('span', { class: 'whole', 'aria-hidden': 'true' }, url))
    const measure = () => field.classList.toggle('cut', link.scrollWidth > link.clientWidth)
    field.onpointerenter = measure
    link.onfocus = () => {
      // The focus ring is for the keyboard.
      link.toggleAttribute('data-pointer', this.pointer)
      measure()
      link.select()
    }
    const copy = h('button', { type: 'button' }, 'Copy')
    const share = h('button', { type: 'button', hidden: !navigator.share }, 'Share')
    const qrButton = h('button', { type: 'button' }, 'QR code')
    const canvas = h('canvas', { class: 'qr', hidden: true, role: 'img', 'aria-label': 'QR code of the invite link' })

    copy.onclick = async () => {
      let ok = false
      try {
        await navigator.clipboard.writeText(url)
        ok = true
      } catch {
        // No Clipboard API on plain http: select the link, so it can be copied by hand.
        link.focus()
        link.setSelectionRange(0, url.length)
        try {
          ok = document.execCommand('copy')
        } catch {
          // Stays selected.
        }
      }
      copy.textContent = ok ? 'Copied' : 'Selected'
      setTimeout(() => {
        copy.textContent = 'Copy'
      }, 1500)
    }
    share.onclick = () => void navigator.share({ title: document.title, url }).catch(() => {})
    let drawn = false
    qrButton.onclick = async () => {
      canvas.hidden = !canvas.hidden
      if (drawn || canvas.hidden) return
      drawn = true
      ;(await import('./qr.ts')).drawQr(canvas, url)
    }

    return h(
      'div',
      { class: 'group' },
      h('label', {}, 'Send this link to your friends', field),
      h('div', { class: 'row' }, copy, share, qrButton),
      canvas,
    )
  }
}

/** Defines the element and takes over the placeholder the entry module put on the page. */
export function mountPanel(controller: Controller, bridge: Bridge): PanelElement {
  if (!customElements.get(TAG)) customElements.define(TAG, PanelElement)
  let el = bridge.panel as PanelElement | null
  if (!el) {
    el = document.createElement(TAG) as PanelElement
    el.style.cssText = 'top:12px;right:12px'
    document.body.append(el)
  }
  el.bind(controller, bridge)
  if (controller.room) el.show(controller.room)
  return el
}
