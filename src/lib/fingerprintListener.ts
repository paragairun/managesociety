/**
 * Always-on fingerprint listener.
 *
 * The gate is an attendance queue, not a one-off scan: staff walk up one
 * after another and touch the reader. The guard should never press
 * anything. So as soon as a reader is detected, this starts an armed
 * capture loop that runs for as long as the guard is signed in, whatever
 * page is on screen, and logs each recognised finger automatically.
 *
 * Deliberately free of React so the behaviour that actually matters —
 * debouncing a finger left on the platen, not double-logging, surviving
 * an unplugged cable — is testable with a mock driver and fake timers.
 * FingerprintProvider is a thin wrapper over this.
 *
 * Loop shape:
 *   disconnected → poll isAvailable() every RECONNECT_MS
 *   connected    → capture(timeout) in a loop
 *                  no finger / timeout → immediate retry (normal, silent)
 *                  capture → identify against the cached gallery
 *                  match   → onAttendance(), then ignore that person for
 *                            COOLDOWN_MS so one touch is one log
 *                  error   → back to disconnected, resume polling
 */

import {
  type FingerprintDriver, type Candidate, type CaptureResult,
  FingerprintError, MATCH_THRESHOLD,
} from "./fingerprint";

export type ListenerStatus =
  | "stopped"        // not running at all
  | "searching"      // no reader found, polling for one
  | "armed"          // reader ready, waiting for a finger
  | "reading"        // a finger is being processed
  | "error";         // last cycle failed; will retry

export interface AttendanceEvent {
  candidate: Candidate;
  score: number;
  deviceModel?: string;
}

export interface ListenerEvents {
  onStatus?: (status: ListenerStatus, detail?: string) => void;
  /** A known finger was recognised. Persisting it is the caller's job. */
  onAttendance?: (event: AttendanceEvent) => void | Promise<void>;
  /** A finger was read but matched nobody. */
  onUnknownFinger?: () => void;
  /** Needed to refresh the gallery; returns the society's enrolled fingers. */
  loadGallery: () => Promise<Candidate[]>;
}

export interface ListenerOptions {
  /** How long to wait for a finger before looping again. */
  captureTimeoutMs?: number;
  /** Ignore the same person for this long after a successful log. */
  cooldownMs?: number;
  /** How often to look for a reader while disconnected. */
  reconnectMs?: number;
  /** Re-pull the gallery this often, so new enrolments appear. */
  galleryTtlMs?: number;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  captureTimeoutMs: 4000,
  cooldownMs: 8000,
  reconnectMs: 5000,
  galleryTtlMs: 120000,
};

export class FingerprintListener {
  private running = false;
  private status: ListenerStatus = "stopped";
  private gallery: Candidate[] = [];
  private galleryLoadedAt = 0;
  private galleryDirty = true;
  private lastSeen = new Map<string, number>();
  private loopPromise: Promise<void> | null = null;

  private readonly opts: Required<Omit<ListenerOptions, "now" | "sleep">> & {
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  };

  constructor(
    private readonly driver: FingerprintDriver,
    private readonly events: ListenerEvents,
    options: ListenerOptions = {},
  ) {
    this.opts = {
      captureTimeoutMs: options.captureTimeoutMs ?? DEFAULTS.captureTimeoutMs,
      cooldownMs: options.cooldownMs ?? DEFAULTS.cooldownMs,
      reconnectMs: options.reconnectMs ?? DEFAULTS.reconnectMs,
      galleryTtlMs: options.galleryTtlMs ?? DEFAULTS.galleryTtlMs,
      now: options.now ?? (() => Date.now()),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  getStatus(): ListenerStatus { return this.status; }
  isRunning(): boolean { return this.running; }
  /** Enrolled fingers currently cached. Exposed for the status panel. */
  getGallerySize(): number { return this.gallery.length; }

  private setStatus(next: ListenerStatus, detail?: string) {
    // Once stop() has been called the loop may still be mid-cycle and
    // would otherwise flip the status back to "armed" after we reported
    // "stopped". Only "stopped" itself may be set while not running.
    if (!this.running && next !== "stopped") return;
    if (this.status === next && !detail) return;
    this.status = next;
    this.events.onStatus?.(next, detail);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.setStatus("searching");
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
    // Set after the loop has drained, so nothing can overwrite it.
    this.status = "stopped";
    this.events.onStatus?.("stopped");
  }

  /** Drop the cached gallery so the next cycle re-reads it. */
  invalidateGallery(): void { this.galleryDirty = true; }

  private async ensureGallery(): Promise<Candidate[]> {
    const age = this.opts.now() - this.galleryLoadedAt;
    // A timestamp sentinel is not enough: with a clock still at zero,
    // "age" is zero too and an invalidation would be silently ignored.
    if (!this.galleryDirty && this.gallery.length > 0 && age < this.opts.galleryTtlMs) {
      return this.gallery;
    }
    this.gallery = await this.events.loadGallery();
    this.galleryLoadedAt = this.opts.now();
    this.galleryDirty = false;
    return this.gallery;
  }

  /**
   * One touch should produce one log. A finger resting on the platen
   * captures repeatedly, so a person is ignored for cooldownMs after
   * being logged.
   */
  private inCooldown(subjectId: string): boolean {
    const last = this.lastSeen.get(subjectId);
    if (last === undefined) return false;
    return this.opts.now() - last < this.opts.cooldownMs;
  }

  private markSeen(subjectId: string): void {
    this.lastSeen.set(subjectId, this.opts.now());
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        if (!(await this.driver.isAvailable())) {
          this.setStatus("searching", "No scanner detected");
          await this.opts.sleep(this.opts.reconnectMs);
          continue;
        }

        const gallery = await this.ensureGallery();
        this.setStatus("armed", gallery.length === 0 ? "No fingerprints enrolled yet" : undefined);

        let capture: CaptureResult;
        try {
          capture = await this.driver.capture({ timeoutMs: this.opts.captureTimeoutMs });
        } catch (err) {
          const fe = err as FingerprintError;
          // No finger within the window is the normal idle case: loop
          // again silently rather than shouting at the guard.
          if (fe.code === "no_finger" || fe.code === "timeout") continue;
          throw err;
        }

        if (!this.running) return;
        this.setStatus("reading");

        if (gallery.length === 0) { await this.opts.sleep(this.opts.reconnectMs); continue; }

        const match = await this.driver.identify(capture, gallery);

        if (!match || match.score < MATCH_THRESHOLD) {
          this.events.onUnknownFinger?.();
          // Pause briefly so an unrecognised finger still on the sensor
          // doesn't spam the guard with failures.
          await this.opts.sleep(this.opts.cooldownMs / 4);
          continue;
        }

        if (this.inCooldown(match.candidate.subjectId)) continue;

        this.markSeen(match.candidate.subjectId);
        await this.events.onAttendance?.({
          candidate: match.candidate,
          score: match.score,
          deviceModel: capture.deviceModel,
        });
      } catch (err) {
        if (!this.running) return;
        this.setStatus("error", (err as Error).message);
        await this.opts.sleep(this.opts.reconnectMs);
      }
    }
  }
}
