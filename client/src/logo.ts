// The p3p2 mark: three players, me in front, player 2 and player 3 behind. Drawn in the text's
// colour, with the two behind fainter and cut where they pass behind me. The same shapes are
// p3p2.me's favicon and the portal's.
// Built node by node: innerHTML would throw on a page that enforces Trusted Types.

const NS = 'http://www.w3.org/2000/svg'
const ME = 'M5.4 7.7a2.6 2.6 0 0 0 5.2 0a2.6 2.6 0 0 0-5.2 0M3.4 16a4.6 4.6 0 0 1 9.2 0z'
const THEM =
  'M.6 7.2a1.9 1.9 0 0 0 3.8 0a1.9 1.9 0 0 0-3.8 0M11.6 7.2a1.9 1.9 0 0 0 3.8 0a1.9 1.9 0 0 0-3.8 0' +
  'M-.8 13.2A3.3 3.3 0 0 1 5.12 11.2A5.6 5.6 0 0 0 3.15 13.2zM16.8 13.2A3.3 3.3 0 0 0 10.88 11.2A5.6 5.6 0 0 1 12.85 13.2z'

/** The mark, 16 px square. */
export function logo(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'currentColor')
  // Sized here, not in a stylesheet: the button that stands in for the panel lives under the game's CSS.
  svg.style.cssText = 'display:block;width:16px;height:16px'
  for (const [d, opacity] of [
    [THEM, '.55'],
    [ME, '1'],
  ] as const) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('opacity', opacity)
    svg.append(path)
  }
  return svg
}
