// The entry module: all a game pays for on a normal visit. Everything else loads on demand.

import { inviteFromUrl } from '@p3p2/protocol/links'
import type { Controller } from './core.ts'
import { logo } from './logo.ts'
import type {
  CloseReason,
  Invite,
  InviteDetails,
  JoinOptions,
  P3P2Events,
  P3P2Options,
  Room,
} from './types.ts'

export type * from './types.ts'

const TAG = 'p3p2-panel'

/** What the lazy part needs from the entry. */
export interface Bridge {
  options: P3P2Options
  param: string
  panel: HTMLElement | null
  started(room: Room): void
  ended(reason: CloseReason): void
}

export class P3P2 {
  /** The invite in the page's address, if there is one. No network involved. */
  static fromUrl(param: string = 'room', href: string = location.href): Invite | null {
    return inviteFromUrl(href, param)
  }

  /** True while the player is typing in the panel. For games that listen to keys in the capture phase. */
  static get isTyping(): boolean {
    return document.activeElement?.localName === TAG
  }

  /**
   * A room of one that runs in the page and talks to no server, for a game that uses the same
   * code alone and with friends: `(await p3p2.start()) ?? (await P3P2.local())`.
   */
  static async local(name?: string): Promise<Room> {
    return (await import('./local.ts')).localRoom(name)
  }

  readonly options: P3P2Options
  /** The room the player is in, or null. */
  room: Room | null = null
  private readonly param: string
  private panel: HTMLElement | null = null
  private core: Promise<Controller> | null = null
  private readonly handlers: { [E in keyof P3P2Events]: Set<P3P2Events[E]> } = {
    room: new Set(),
    leave: new Set(),
  }

  constructor(options: P3P2Options) {
    // Said here, by name: a server answers a hello it cannot read with no more than "bad frame".
    const { id, version } = options.game
    if (!/^[\w.-]{1,64}$/.test(id)) throw new TypeError('game.id: 1 to 64 letters, digits, "_", "." or "-"')
    if (!/^[\x21-\x7e]{1,32}$/.test(version)) throw new TypeError('game.version: 1 to 32 characters, without spaces')
    this.options = options
    this.param = options.urlParam || 'room'
    if (options.ui !== false) this.mount(options.ui?.corner ?? 'top-right', options.ui?.button !== false)
  }

  /** The invite in the page's address, read with this game's parameter name. */
  get invite(): Invite | null {
    return P3P2.fromUrl(this.param)
  }

  /**
   * Call once when the game starts. Comes back to the room after a reload, or offers to join when
   * the page was opened from an invite link. Otherwise resolves to null without loading anything.
   */
  async start(): Promise<Room | null> {
    const room = await this.resume()
    if (room) return room
    const invite = this.invite
    return invite ? this.join(invite) : null
  }

  /**
   * The first half of `start()`, for a game that asks "Join?" in its own words: comes back to the
   * room this tab was in before a reload, without asking. Resolves to null, and loads nothing,
   * when there was none.
   */
  async resume(): Promise<Room | null> {
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem(`p3p2:session:${this.options.game.id}`)
    } catch {
      // Storage is blocked: there is nothing to come back to.
    }
    return saved ? (await this.load()).resume(saved) : null
  }

  /** Joins through an invite. Resolves to null if the player chose to play alone. */
  async join(invite: Invite, options?: JoinOptions): Promise<Room | null> {
    return (await this.load()).join(invite, options)
  }

  /** Looks up an invite without joining, for a game that asks "Join?" in its own words. */
  async peek(invite: Invite): Promise<InviteDetails> {
    return (await this.load()).peek(invite)
  }

  /** Opens the panel. */
  async open(): Promise<void> {
    return (await this.load()).open()
  }

  /** Listens for rooms starting and ending. A room that is already open is reported right away. */
  on<E extends keyof P3P2Events>(event: E, handler: P3P2Events[E]): () => void {
    const set = this.handlers[event] as Set<P3P2Events[E]>
    set.add(handler)
    const room = this.room
    if (event === 'room' && room) queueMicrotask(() => this.room === room && (handler as P3P2Events['room'])(room))
    return () => set.delete(handler)
  }

  private load(): Promise<Controller> {
    this.core ??= import('./core.ts').then((m) => {
      const bridge: Bridge = {
        options: this.options,
        param: this.param,
        panel: this.panel,
        started: (room) => {
          this.room = room
          for (const h of [...this.handlers.room]) h(room)
        },
        ended: (reason) => {
          this.room = null
          for (const h of [...this.handlers.leave]) h(reason)
        },
      }
      return new m.Controller(bridge)
    })
    return this.core
  }

  /** A small button that stands in for the panel until the panel's code is needed. */
  private mount(corner: string, withButton: boolean): void {
    const [v, h] = corner.split('-')
    const el = document.createElement(TAG)
    el.style.cssText = `position:fixed;z-index:2147483000;${v}:12px;${h}:12px`
    this.panel = el
    if (document.body) document.body.append(el)
    else addEventListener('DOMContentLoaded', () => document.body.append(el))
    // The game has a button of its own, and calls open().
    if (!withButton) return
    const button = document.createElement('button')
    button.append(logo())
    button.title = 'Multiplayer'
    // The mark has no words: this is the button's name.
    button.setAttribute('aria-label', 'Multiplayer')
    button.style.cssText =
      'font:16px/1 system-ui;padding:8px 12px;border-radius:99px;border:1px solid #8888;background:#1f201ccc;color:#fff;cursor:pointer'
    button.onclick = () => void this.open()
    // A game that cancels touches page-wide would leave this button dead under a finger: see panel.ts.
    el.ontouchend = (e) => e.stopPropagation()
    el.append(button)
  }
}
