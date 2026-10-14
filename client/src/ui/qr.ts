import { generate } from 'lean-qr/nano'

/** Draws a QR code. One canvas pixel per module; CSS scales it up, pixelated. */
export function drawQr(canvas: HTMLCanvasElement, text: string): void {
  generate(text).toCanvas(canvas)
}
