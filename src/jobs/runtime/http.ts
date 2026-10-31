// Polite HTTP for the sources (plan 6.6): a cap on concurrent calls and on the
// rate per source, a timeout per call, at most two retries with backoff, a
// budget, an emergency stop after 5 failures in a row, and no new calls after
// the run's deadline. Every call names the collector in its User-Agent.

export const USER_AGENT = "OralCareDigital/1.0 (+digital@oralcaregroup.com)";

export type SourceLimits = {
  name: string;
  concurrency: number;
  minIntervalMs: number;
  timeoutMs: number;
  budget: number;
};

export class StopError extends Error {
  constructor(readonly reason: "deadline" | "budget" | "failures") {
    super(`Collection stopped: ${reason}`);
    this.name = "StopError";
  }
}

/** A request that gave no usable answer. The code is http_<status>, timeout, network or page_cap. */
export class SourceRequestError extends Error {
  constructor(
    readonly source: string,
    readonly code: string,
  ) {
    super(`${source}: ${code}`);
    this.name = "SourceRequestError";
  }
}

const RETRY_DELAYS_MS = [1_000, 3_000];

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Shared across sources: the deadline and the failure counter belong to the run. */
export class RunGuard {
  failuresInARow = 0;
  stopped: StopError | null = null;

  constructor(
    readonly deadlineAt: number,
    readonly clock: Clock = realClock,
  ) {}

  check(): void {
    if (this.stopped) throw this.stopped;
    if (this.clock.now() >= this.deadlineAt) throw new StopError("deadline");
  }

  recordFailure(): void {
    this.failuresInARow++;
    if (this.failuresInARow >= 5) this.stopped = new StopError("failures");
  }
}

export class SourceClient {
  requests = 0;
  errorCodes = new Set<string>();
  private active = 0;
  private queue: (() => void)[] = [];
  private nextStartAt = 0;

  constructor(
    readonly limits: SourceLimits,
    readonly guard: RunGuard,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /** GET with retries. 404 and 400 are answers, not failures, and are not retried. */
  async get(url: string, accept: "json" | "html"): Promise<{ status: number; body: string }> {
    for (let attempt = 0; ; attempt++) {
      this.guard.check();
      if (this.requests >= this.limits.budget) throw new StopError("budget");
      const result = await this.once(url, accept).catch((error: unknown) => ({ error }));
      if ("status" in result && result.status < 500 && result.status !== 429) {
        this.guard.failuresInARow = 0;
        return result;
      }
      const code =
        "status" in result ? `http_${result.status}` : errorCode((result as { error: unknown }).error);
      this.errorCodes.add(`${this.limits.name}:${code}`);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        this.guard.recordFailure();
        throw new SourceRequestError(this.limits.name, code);
      }
      await this.guard.clock.sleep(delay + Math.floor(Math.random() * 500));
    }
  }

  private async once(url: string, accept: "json" | "html") {
    await this.acquire();
    try {
      this.requests++;
      const response = await this.fetcher(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept === "json" ? "application/json" : "text/html",
        },
        signal: AbortSignal.timeout(this.limits.timeoutMs),
        cache: "no-store",
      });
      return { status: response.status, body: await response.text() };
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.limits.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    const now = this.guard.clock.now();
    const wait = Math.max(0, this.nextStartAt - now);
    this.nextStartAt = Math.max(now, this.nextStartAt) + this.limits.minIntervalMs;
    if (wait > 0) await this.guard.clock.sleep(wait);
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return "timeout";
  return "network";
}
