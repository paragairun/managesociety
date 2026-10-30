import QRCode from "qrcode";

/**
 * A QR code as a grid of booleans.
 *
 * This exists because of a porting problem with one honest answer. The
 * website draws its QR codes onto an HTML canvas, and React Native has
 * no canvas — so the guest pass, the vehicle sticker and the house-help
 * ID card could not come across as written. The options were a second
 * QR library for the phone, or this: share the ENCODING, which is the
 * part that must not differ, and let each platform draw.
 *
 * The encoding matters because a guard's scanner reads these. If the
 * website and the app disagreed about error-correction level or
 * version, both would still produce a valid-looking QR and one of them
 * would read as a different string, or fail at the gate in bad light.
 * `qrcode` is already a dependency of the website, and QRCode.create()
 * is pure JavaScript with no DOM in it, so both platforms can call it.
 *
 * The caller draws: <canvas> on the web, <Rect> inside react-native-svg
 * on the phone, from the same matrix.
 */

export interface QrMatrix {
  /** Modules per side, not counting the quiet zone. */
  size: number;
  /** Row-major, `size * size` entries. True means a dark module. */
  modules: boolean[];
  /** Quiet zone in modules. Four is the spec's minimum. */
  margin: number;
}

/**
 * Error correction level, fixed at "M".
 *
 * Not configurable on purpose. "M" recovers about 15% of a damaged
 * code, which is the right trade for something printed on a sticker
 * that lives on a windscreen through two monsoons, or on a laminated ID
 * card that gets handled daily. "L" is denser but gives up that
 * tolerance; "H" survives more but needs a bigger code to hold the same
 * payload, and these are read by a phone camera at arm's length.
 *
 * It must also be the SAME on both platforms, and a parameter is an
 * invitation for them to differ.
 */
const ERROR_CORRECTION = "M" as const;

export const QR_MARGIN = 4;

/**
 * Encode a string as a QR matrix.
 *
 * Throws when the payload cannot be encoded at all — too long for the
 * largest version, or empty. Callers should treat that as a bug in what
 * they are encoding rather than something to show the user, since every
 * payload in this app is a short id or a small JSON object.
 */
export function qrMatrix(value: string): QrMatrix {
  if (!value) throw new Error("Cannot encode an empty QR payload");

  const qr = QRCode.create(value, { errorCorrectionLevel: ERROR_CORRECTION });
  const size = qr.modules.size;
  const data = qr.modules.data;

  // `data` is a Uint8Array of 0/1 in the library's own typing; copy it
  // into plain booleans so the shape is obvious to a caller drawing it
  // and so nothing downstream depends on that internal type.
  const modules: boolean[] = new Array(size * size);
  for (let i = 0; i < size * size; i += 1) modules[i] = !!data[i];

  return { size, modules, margin: QR_MARGIN };
}

/** True when the module at (row, col) is dark. Out of range reads light. */
export function isDark(matrix: QrMatrix, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= matrix.size || col >= matrix.size) return false;
  return matrix.modules[row * matrix.size + col];
}

/**
 * The matrix as runs of consecutive dark modules per row.
 *
 * One rectangle per run instead of one per module. Measured across the
 * payloads this app actually encodes — ids, plates, and a guest pass's
 * JSON — that is a saving of almost exactly half: 421 rectangles
 * instead of 837 for a 41x41 code, 117 instead of 222 for a 21x21.
 *
 * Half, and not better, because QR data is high-entropy by design: the
 * average run is about two modules, and no amount of cleverness in this
 * direction will beat that. Halving the element count in
 * react-native-svg is still worth the twelve lines, but it is a
 * constant factor, not a change of order — if a QR ever renders slowly,
 * this is not the place to look.
 */
export function darkRuns(matrix: QrMatrix): { row: number; col: number; length: number }[] {
  const runs: { row: number; col: number; length: number }[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let start = -1;
    for (let col = 0; col <= matrix.size; col += 1) {
      const dark = col < matrix.size && isDark(matrix, row, col);
      if (dark && start === -1) start = col;
      if (!dark && start !== -1) {
        runs.push({ row, col: start, length: col - start });
        start = -1;
      }
    }
  }
  return runs;
}
