// <p3p2-panel>: paste the room URL, create the invite, share it, see who is here, chat.
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
  /** On the mark's corner: how many chat lines came from the others while the panel was closed. */
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

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.count = h('span')
    this.badge = h('span', { class: 'unread', hidden: true })
    this.pill = h('button', { class: 'pill', type: 'button', 'aria-label': 'Multiplayer', title: 'Multiplayer' }, h('span', { class: 'mark' }, logo(), this.badge), this.count)
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
      this.onKey(e as KeyboardEvent)
      e.stopPropagation()
    })
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

  private setBody(title: string, ...children: Node[]): void {
    this.title_.textContent = title
    this.body.replaceChildren(...children)
    this.say = null
  }

  private nameField(): HTMLInputElement {
    const input = h('input', { type: 'text', maxlength: NAME_MAX, placeholder: 'Player', autocomplete: 'nickname', enterkeyhint: 'done' })
    input.value = this.controller.name
    input.onchange = () => {
      this.controller.name = input.value
    }
    return input
  }

  // ---- not in a room: paste the room URL ----

  private renderSetup(note: string = ''): void {
    const name = this.nameField()
    const url = h('input', {
      type: 'text',
      inputmode: 'url',
      placeholder: 'https://your-server/room/…',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    })
    url.value = this.controller.savedRoomUrl
    const status = h('p', { class: 'status', role: 'status' }, note)
    const create = h('button', { class: 'primary', type: 'button', disabled: true }, 'Create a multiplayer game room for my friends')

    const say = (text: string, kind: '' | 'ok' | 'bad' = '') => {
      status.textContent = text
      status.className = `status ${kind}`
    }

    let turn = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      const mine = ++turn
      create.disabled = true
      const text = url.value.trim()
      if (!text) return say(note)
      say('Checking…')
      try {
        const { ref, details } = await this.controller.checkRoom(text)
        if (mine !== turn) return
        say(`✓ ${details.name} on ${serverName(ref.server)}`, 'ok')
        create.disabled = false
      } catch (err) {
        if (mine === turn) say((err as Error).message, 'bad')
      }
    }
    url.oninput = () => {
      clearTimeout(timer)
      create.disabled = true
      timer = setTimeout(check, 350)
    }
    create.onclick = async () => {
      create.disabled = true
      say('Connecting…')
      try {
        await this.controller.host(url.value, { name: name.value })
      } catch (err) {
        say((err as Error).message, 'bad')
        create.disabled = false
      }
    }

    this.setBody(
      'Multiplayer',
      h('label', {}, 'Your name', name),
      h('label', {}, 'Room URL', url),
      status,
      create,
      h('p', { class: 'soft' }, "Paste a room URL from your p3p2 server's portal. You get a link to send to your friends."),
    )
    if (url.value) void check()
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
    const where = h('p', {}, h('span', { class: 'soft' }, `on ${serverName(room.server)} `), state)
    const members = h('ul', { class: 'members' })
    const log = h('ol', { class: 'log', 'aria-live': 'polite' })
    const say = h('input', { type: 'text', maxlength: CHAT_MAX, placeholder: 'Say something…', autocomplete: 'off', enterkeyhint: 'send' })
    // A button as well as Enter: a phone's keyboard does not always have one, and a thumb finds a button sooner.
    const send = h('button', { type: 'button' }, 'Send')
    const leave = h('button', { type: 'button' }, 'Leave')
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
      state.textContent = room.status === 'reconnecting' ? '· reconnecting…' : ''
      members.replaceChildren(
        ...room.members.map((m) => {
          const li = h('li', {}, h('span', { class: 'name' }, m.name))
          if (m === room.self) li.append(h('span', { class: 'tag' }, 'you'))
          if (m === room.host) li.append(h('span', { class: 'tag host' }, 'host'))
          if (m.rtt !== null) li.append(h('span', { class: 'soft' }, `${m.rtt} ms`))
          if (room.isMod && m !== room.self) {
            const kick = h('button', { type: 'button', title: `Remove ${m.name}`, 'aria-label': `Remove ${m.name}` }, '×')
            kick.onclick = () => room.kick(m.id)
            li.append(kick)
          }
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
    ]

    const row = h('div', { class: 'row' }, h('span', { class: 'grow' }), leave)
    if (room.isMod) {
      const end = h('button', { type: 'button' }, 'End for everyone')
      end.onclick = () => room.end()
      row.prepend(end)
    }
    parts.push(members, log, h('div', { class: 'row' }, say, send), row)
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
    this.setUnread(0)
    this.renderSetup(CLOSED[reason])
    if (CLOSED[reason]) this.expand()
  }

  private inviteSection(url: string): HTMLElement {
    const link = h('input', { type: 'text', readonly: true, 'aria-label': 'Invite link' })
    link.value = url
    link.onfocus = () => link.select()
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
      h('label', {}, 'Send this link to your friends', h('div', { class: 'row' }, link, copy)),
      h('div', { class: 'row' }, share, qrButton),
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
