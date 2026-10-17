// The duel example's game: a classic script, with no bundler and no modules. P3P2 comes from the script tag
// before this one, as window.P3P2.
//
// Everything the room knows is in its log: who sits where, a promise about each hidden board, every probe and the
// answer the board's own page gave, and at the end what each board held. Every page builds the same table from the
// same ops, and ignores an op against the rules. What a player hid is never in the log until the end: it stays in
// that player's browser.

;(() => {
  const SIZE = 6
  const HIDE = 5
  const $ = (id) => document.getElementById(id)

  // ---- SHA-256, for the promises: here, since crypto.subtle is missing from a page on plain http ----

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  function sha256(text) {
    const bytes = new TextEncoder().encode(text)
    const length = Math.ceil((bytes.length + 9) / 64) * 64
    const data = new Uint8Array(length)
    data.set(bytes)
    data[bytes.length] = 0x80
    new DataView(data.buffer).setUint32(length - 4, bytes.length * 8)
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const w = new Uint32Array(64)
    const rotr = (x, n) => (x >>> n) | (x << (32 - n))
    for (let at = 0; at < length; at += 64) {
      for (let i = 0; i < 16; i++) w[i] = new DataView(data.buffer).getUint32(at + i * 4)
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = w[i - 16] + s0 + w[i - 7] + s1
      }
      let [a, b, c, d, e, f, g, k] = h
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
        ;[k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0]
      }
      for (const [i, v] of [a, b, c, d, e, f, g, k].entries()) h[i] = (h[i] + v) >>> 0
    }
    return h.map((v) => v.toString(16).padStart(8, '0')).join('')
  }

  /** The promise about a board: what it holds, and a salt that nobody can guess, hashed together. */
  const promise = (squares, salt) => sha256(`${[...squares].sort((a, b) => a - b).join(',')}:${salt}`)

  // ---- the table, as the log builds it ----

  const freshGame = () => ({ promises: [null, null], probes: [[], []], answers: [[], []], reveals: [null, null] })
  const fresh = () => ({ seats: [null, null], names: ['', ''], n: 1, game: freshGame(), history: [] })
  let table = fresh()

  const isSquare = (i) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE
  const ready = () => table.game.promises.every(Boolean)
  /** Hits on seat s's board: its own page's answers that said so. */
  const hitsOn = (s) => table.game.answers[s].filter((a) => a.hit).length
  const over = () => hitsOn(0) === HIDE || hitsOn(1) === HIDE
  const winner = () => (hitsOn(1) === HIDE ? 0 : hitsOn(0) === HIDE ? 1 : -1)
  /** The square of a probe on seat s's board that its page has not answered yet, or -1. */
  const waiting = (s) => {
    const probes = table.game.probes[1 - s]
    const answers = table.game.answers[s]
    return probes.length > answers.length ? probes[answers.length] : -1
  }
  /** Whose probe it is: nobody's before both boards are hidden, or while a probe waits for its answer. */
  function turn() {
    if (!ready() || over() || waiting(0) !== -1 || waiting(1) !== -1) return -1
    // Seat 1 opens the odd games, seat 2 the even ones.
    const first = (table.n + 1) % 2
    const g = table.game
    return g.probes[first].length > g.probes[1 - first].length ? 1 - first : first
  }

  /** Whether what seat s showed at the end is what it promised, and what its page answered all along. */
  function verdict(s) {
    const g = table.game
    const shown = g.reveals[s]
    if (!shown) return 'not shown'
    const squares = new Set(shown.squares)
    const fair =
      shown.squares.length === HIDE &&
      squares.size === HIDE &&
      shown.squares.every(isSquare) &&
      promise(shown.squares, shown.salt) === g.promises[s] &&
      g.answers[s].every((a) => a.hit === squares.has(a.i))
    return fair ? 'kept their word' : 'did not keep their word'
  }

  /** One op, from player `pid`. Anything against the rules changes nothing, on every page alike. */
  function apply(op, pid) {
    const g = table.game
    const seat = table.seats.indexOf(pid)
    if (op?.t === 'seat' && (op.c === 0 || op.c === 1) && !table.seats[op.c] && seat === -1) {
      // The first claim for a seat wins.
      table.seats[op.c] = pid
      table.names[op.c] = String(op.name ?? '').slice(0, 40) || `Seat ${op.c + 1}`
      return
    }
    if (op?.t === 'stand' && seat !== -1 && !ready()) {
      table.seats[seat] = null
      table.names[seat] = ''
      g.promises[seat] = null
      return
    }
    // The rest is about the game in progress.
    if (op?.n !== table.n || seat === -1) return
    if (op.t === 'ready' && !g.promises[seat] && /^[0-9a-f]{64}$/.test(op.promise)) g.promises[seat] = op.promise
    else if (op.t === 'probe' && seat === turn() && isSquare(op.i) && !g.probes[seat].includes(op.i)) g.probes[seat].push(op.i)
    else if (op.t === 'answer' && waiting(seat) === op.i && typeof op.hit === 'boolean') g.answers[seat].push({ i: op.i, hit: op.hit })
    else if (op.t === 'reveal' && over() && !g.reveals[seat] && Array.isArray(op.squares) && typeof op.salt === 'string') {
      g.reveals[seat] = { squares: op.squares.slice(0, HIDE), salt: op.salt.slice(0, 64) }
    } else if (op.t === 'next' && over()) {
      // A line for the game that ended, and the next one, with the same seats.
      table.history.push({ n: table.n, winner: table.names[winner()], probes: g.probes[0].length + g.probes[1].length, word: [verdict(0), verdict(1)] })
      table.n++
      table.game = freshGame()
    }
  }

  // ---- this browser's secrets ----

  /** What this browser hid for a promise: kept here, and nowhere else, until the end of the game. */
  function secret(promise_) {
    try {
      return promise_ ? JSON.parse(localStorage.getItem(`duel-example:${promise_}`) ?? 'null') : null
    } catch {
      return null
    }
  }

  // ---- the page ----

  const p3p2 = new P3P2({ game: { id: 'duel-example', version: '1.0.0' }, ui: { button: false } })
  window.p3p2 = p3p2
  $('friends').onclick = () => p3p2.open()

  let room = null
  let caughtUp = false
  /** Every op this page was given, as the log held it: for a look at what the room knows. */
  let seen = []
  /** What this page has asked of the log and not seen back yet, so that it asks once. */
  const asked = new Set()
  /** Squares picked: on this player's board before Ready, or one on the other board, to be probed. */
  let picked = new Set()
  let target = -1

  const mySeat = () => (room ? table.seats.indexOf(room.self.pid) : -1)
  const mine = () => secret(table.game.promises[mySeat()])

  function submit(op, once) {
    if (!room || (once && asked.has(once))) return
    if (room.log.submit(op) && once) asked.add(once)
  }

  /** What this page does by itself: takes a free seat, answers a probe of its board, shows its board at the end. */
  function act() {
    if (!room || !caughtUp) return
    const seat = mySeat()
    const free = table.seats.indexOf(null)
    if (seat === -1 && free !== -1) return submit({ t: 'seat', c: free, name: room.self.name }, `seat:${free}`)
    if (seat === -1) return
    const s = mine()
    const probed = waiting(seat)
    if (probed !== -1 && s) submit({ t: 'answer', n: table.n, i: probed, hit: s.squares.includes(probed) }, `answer:${table.n}:${table.game.answers[seat].length}`)
    if (over() && !table.game.reveals[seat] && s) submit({ t: 'reveal', n: table.n, squares: s.squares, salt: s.salt }, `reveal:${table.n}`)
  }

  /** Hides the picked squares: the promise goes to the log, the squares and the salt stay here. */
  function hide(squares = [...picked]) {
    const seat = mySeat()
    if (seat === -1 || table.game.promises[seat] || squares.length !== HIDE) return false
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    const p = promise(squares, salt)
    try {
      localStorage.setItem(`duel-example:${p}`, JSON.stringify({ squares, salt }))
    } catch {
      return false
    }
    picked = new Set()
    submit({ t: 'ready', n: table.n, promise: p })
    return true
  }

  function probe(i) {
    if (turn() !== mySeat() || mySeat() === -1 || !isSquare(i)) return false
    target = -1
    submit({ t: 'probe', n: table.n, i })
    return true
  }

  /** A tap on a square: on this player's board before Ready, picks it; on the other's, picks it, and a second tap probes. */
  function tap(board, i) {
    const seat = mySeat()
    if (board === seat && !table.game.promises[seat]) {
      if (picked.has(i)) picked.delete(i)
      else if (picked.size < HIDE) picked.add(i)
    } else if (board === 1 - seat && turn() === seat) {
      if (target === i) probe(i)
      else target = i
    }
    draw()
  }

  function draw() {
    const g = table.game
    const seat = mySeat()
    const name = (s) => table.names[s] || `Seat ${s + 1}`
    const s = mine()
    $('boards').replaceChildren(
      ...[0, 1].map((b) => {
        const shown = g.reveals[b]?.squares ?? (b === seat ? s?.squares : null) ?? []
        const answers = new Map(g.answers[b].map((a) => [a.i, a.hit]))
        const cells = Array.from({ length: SIZE * SIZE }, (_, i) => {
          const cell = document.createElement('button')
          cell.type = 'button'
          cell.setAttribute('aria-label', `${name(b)}, square ${i + 1}`)
          const hit = answers.get(i)
          cell.textContent = hit === undefined ? '' : hit ? '✕' : '·'
          cell.className = [hit === undefined ? '' : hit ? 'hit' : 'miss', shown.includes(i) ? 'hidden' : '', (b === seat && picked.has(i)) || (b !== seat && target === i) ? 'picked' : ''].join(' ')
          cell.onclick = () => tap(b, i)
          return cell
        })
        const part = document.createElement('div')
        const title = document.createElement('h2')
        title.textContent = `${name(b)}${b === seat ? ' (you)' : ''}: ${hitsOn(b)} of ${HIDE} found`
        const grid = document.createElement('div')
        grid.className = 'board'
        grid.setAttribute('aria-label', `${name(b)}'s board`)
        grid.append(...cells)
        part.append(title, grid)
        return part
      }),
    )

    let now
    if (!table.seats[0] || !table.seats[1]) now = 'Waiting for a second player.'
    else if (!g.promises[0] || !g.promises[1]) now = seat !== -1 && !g.promises[seat] ? `Pick ${HIDE} squares on your board to hide, then press Ready.` : 'Waiting for the boards to be hidden.'
    else if (over()) now = `${name(winner())} wins. ${name(0)} ${verdict(0)}; ${name(1)} ${verdict(1)}.`
    else if (turn() === -1) now = `Waiting for ${name(waiting(0) !== -1 ? 0 : 1)}'s page to answer.`
    else now = turn() === seat ? 'Your probe: pick a square on the other board, and pick it again.' : `${name(turn())}'s probe.`
    const who = seat === -1 ? 'watching' : `in seat ${seat + 1}`
    $('state').textContent = room ? `In "${room.name}" as ${room.self.name}, ${who}. Game ${table.n}. ${now}` : 'Playing alone. Press Friends to play with somebody.'
    $('ready').hidden = !(seat !== -1 && !g.promises[seat] && table.seats[1 - seat])
    $('ready').disabled = picked.size !== HIDE
    $('next').hidden = !(over() && seat !== -1)
    $('friends').textContent = room ? `Friends (${room.members.length})` : 'Friends'
    $('history').replaceChildren(
      ...table.history.map((h) => {
        const li = document.createElement('li')
        li.textContent = `Game ${h.n}: ${h.winner} won in ${h.probes} probes.`
        return li
      }),
    )
  }

  $('ready').onclick = () => hide()
  $('next').onclick = () => submit({ t: 'next', n: table.n })

  p3p2.on('room', (r) => {
    room = r
    table = fresh()
    seen = []
    caughtUp = false
    asked.clear()
    picked = new Set()
    for (const event of ['member-join', 'member-leave', 'member-state']) r.on(event, draw)
    // Back after a gap: what was asked may never have arrived. Asking again is safe, since an op that no longer
    // applies changes nothing.
    r.on('status', (status) => {
      if (status !== 'open') return
      asked.clear()
      setTimeout(act)
    })
    r.log
      .open({
        load: (state) => {
          if (state?.game && Array.isArray(state.seats)) table = state
        },
        apply: (op, entry) => {
          seen.push(op)
          apply(op, entry.pid)
          act()
          draw()
        },
        // On the host, when the server asks: the seats, the game in progress, and a line for each game that ended.
        save: () => table,
      })
      .then(() => {
        caughtUp = true
        act()
        draw()
      })
    draw()
  })
  p3p2.on('leave', () => {
    room = null
    table = fresh()
    draw()
  })

  // For the browser tests, and for a look from the console.
  window.example = {
    get inRoom() {
      return room !== null && room.status === 'open' && caughtUp
    },
    get seat() {
      return mySeat()
    },
    get table() {
      return table
    },
    get turn() {
      return turn()
    },
    get over() {
      return over()
    },
    get verdicts() {
      return [verdict(0), verdict(1)]
    },
    /** Every op this page was given since it came into the room. */
    get ops() {
      return seen
    },
    /** What this browser hid in the game in progress, or null. */
    get secret() {
      return room ? mine() : null
    },
    hide,
    probe,
    tap,
    next: () => submit({ t: 'next', n: table.n }),
  }

  draw()
  // After a reload: back into the room. From an invite link: asks, then joins.
  p3p2.start()
})()
