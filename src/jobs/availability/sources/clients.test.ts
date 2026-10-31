import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { measurementWindow } from "@/lib/availability/window";

import {
  RunGuard,
  SourceClient,
  SourceRequestError,
  StopError,
  USER_AGENT,
  type Fetcher,
} from "../../runtime/http";
import { Muntra } from "./epr/muntra";
import { OralcareSe } from "./web/oralcare-se";

// The source clients against a fake fetch: what they ask for, how they treat
// answers, and the limits every call goes through (plan 6.2 and 6.6).

const fixture = (...parts: string[]) => readFileSync(path.join("tests/fixtures", ...parts), "utf8");
const now = new Date("2026-11-06T09:00:00Z");
const clock = { now: () => now.getTime(), sleep: async () => undefined };
const limits = { name: "test", concurrency: 2, minIntervalMs: 0, timeoutMs: 1_000, budget: 50 };

function fake(answer: (url: URL) => { status: number; body: string }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const { status, body } = answer(new URL(url));
    return new Response(body, { status });
  };
  return { calls, client: new SourceClient(limits, new RunGuard(now.getTime() + 60_000, clock), fetcher) };
}

describe("OralcareSe", () => {
  it("asks for one clinic and treatment like the booking flow, and keeps that clinic's slots", async () => {
    const { calls, client } = fake(() => ({ status: 200, body: fixture("oralcare-se", "get-slots.json") }));
    const result = await new OralcareSe(client).readSlots(
      "2528",
      "muntra-checkup-1",
      now,
      new Date("2026-12-06T09:00:00Z"),
    );
    const url = calls[0]!.url;
    expect(url.pathname).toBe("/api/bookings/getSlots");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-11-06T09:00:00.000Z",
      to: "2026-12-06T09:00:00.000Z",
      treatmentWebKey: "muntra-checkup-1",
      clinicIds: "2528",
    });
    expect(new Headers(calls[0]!.init.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(result.kind === "slots" && result.slots.length).toBe(66);
  });

  it("reads 404 as an answer and 400 as a fault, without retrying either", async () => {
    const notFound = fake(() => ({ status: 404, body: "" }));
    expect(await new OralcareSe(notFound.client).readSlots("1", "k", now, now)).toEqual({
      kind: "not-found",
    });
    const rejected = fake(() => ({ status: 400, body: "" }));
    await expect(new OralcareSe(rejected.client).readSlots("1", "k", now, now)).rejects.toMatchObject({
      code: "http_400",
    });
    expect(notFound.calls).toHaveLength(1);
    expect(rejected.calls).toHaveLength(1);
  });
});

describe("Muntra", () => {
  const window = measurementWindow(now, 20, 90);

  it("asks with the same parameters as oralcare.se, in UTC without a zone", async () => {
    const { calls, client } = fake(() => ({ status: 200, body: fixture("muntra", "slots.json") }));
    const slots = await new Muntra(client).readSlots("2528", "1", window);
    const params = Object.fromEntries(calls[0]!.url.searchParams);
    expect(params).toMatchObject({
      clinic_id: "2528",
      procedure_ids: "1",
      new_patient: "true",
      dtstart: "2026-11-06T09:30:00",
      dtend: "2026-12-06T09:30:00",
      per_page: "100",
      page: "1",
    });
    expect(slots).toHaveLength(66);
    expect(slots.every((s) => s.procedureId === "1")).toBe(true);
  });

  it("fails a read that reaches the page cap instead of cutting it short", async () => {
    const page = JSON.parse(fixture("muntra", "slots.json")) as {
      meta: { pagination: { total_pages: number } };
    };
    page.meta.pagination.total_pages = 20;
    const { client } = fake(() => ({ status: 200, body: JSON.stringify(page) }));
    await expect(new Muntra(client).readSlots("2528", "1", window)).rejects.toMatchObject({
      code: "page_cap",
    });
  });
});

describe("SourceClient", () => {
  it("retries 5xx twice, then fails with the status as code", async () => {
    const { calls, client } = fake(() => ({ status: 503, body: "" }));
    await expect(client.get("https://example.test/", "json")).rejects.toEqual(
      new SourceRequestError("test", "http_503"),
    );
    expect(calls).toHaveLength(3);
    expect([...client.errorCodes]).toEqual(["test:http_503"]);
  });

  it("stops at the budget and after 5 failures in a row", async () => {
    const budget = new SourceClient(
      { ...limits, budget: 1 },
      new RunGuard(now.getTime() + 60_000, clock),
      async () => new Response("{}"),
    );
    await budget.get("https://example.test/", "json");
    await expect(budget.get("https://example.test/", "json")).rejects.toEqual(new StopError("budget"));

    const { client } = fake(() => ({ status: 500, body: "" }));
    for (let i = 0; i < 5; i++) await client.get("https://example.test/", "json").catch(() => undefined);
    await expect(client.get("https://example.test/", "json")).rejects.toEqual(new StopError("failures"));
  });

  it("starts no request after the run's deadline", async () => {
    const late = new SourceClient(limits, new RunGuard(now.getTime(), clock), async () => new Response("{}"));
    await expect(late.get("https://example.test/", "json")).rejects.toEqual(new StopError("deadline"));
    expect(late.requests).toBe(0);
  });
});
