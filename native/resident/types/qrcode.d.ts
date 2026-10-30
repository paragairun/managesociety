/**
 * Types for the one `qrcode` call the shared QR encoder makes.
 *
 * WHY THIS FILE EXISTS, AND NOT A tsconfig PATH
 *
 * <repo>/src/lib/qrMatrix.ts is compiled from where it sits, so its
 * bare `import QRCode from "qrcode"` resolves upward from ../../src/lib
 * and reaches the repo root, where CI never installs node_modules. The
 * obvious fix was a tsconfig `paths` entry — but Expo's bundler reads
 * that same block and turns every entry into a RUNTIME alias. Aimed at
 * @types/qrcode it made tsc happy and broke the release bundle, which
 * only showed up in a Play Store AAB build; aimed at the real package
 * the bundler is right and tsc loses the declarations, because an
 * explicit mapping preempts the automatic @types lookup and does not
 * fall through to a second entry.
 *
 * An ambient declaration separates the two concerns cleanly. The
 * bundler resolves `qrcode` by its own rules — Metro's nodeModulesPaths
 * already points at this app's node_modules, where the real package is
 * a dependency — and the compiler gets its types from here.
 *
 * Deliberately narrow: `create` is the only thing qrMatrix.ts calls,
 * and these signatures are copied from @types/qrcode, which stays
 * installed as the reference. A wider re-export would be a second,
 * drifting copy of a library's whole surface for no benefit.
 */
declare module "qrcode" {
  /** QRCode.modules — the symbol as a square bit grid. */
  export interface BitMatrix {
    /** Modules per side, not counting the quiet zone. */
    size: number;
    /** Row-major, size * size entries, 0 or 1. */
    data: Uint8Array;
  }

  export interface QRCodeSymbol {
    modules: BitMatrix;
  }

  export interface CreateOptions {
    /**
     * Must match the website's, or the two platforms encode the same
     * payload differently and a guard's scanner reads one of them as a
     * different string.
     */
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    version?: number;
  }

  export function create(text: string, options?: CreateOptions): QRCodeSymbol;

  const QRCode: { create: typeof create };
  export default QRCode;
}
