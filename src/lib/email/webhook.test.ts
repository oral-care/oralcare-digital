import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { suppressionFrom, verifySignature } from "./webhook";

// Resend's Svix signature and which events stop e-mail to an address (plan 11).

const secret = `whsec_${Buffer.from("a test secret of thirty-two bytes").toString("base64")}`;
const now = new Date("2026-11-01T10:00:00Z");
const timestamp = String(now.getTime() / 1000);
const body = JSON.stringify({
  type: "email.bounced",
  data: { to: ["Someone@Example.com"], bounce: { type: "Permanent" } },
});

function sign(content: string, key = secret) {
  const raw = Buffer.from(key.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", raw).update(content).digest("base64")}`;
}
const headers = (signature: string, at = timestamp) => ({ id: "msg_1", timestamp: at, signature });

describe("verifySignature", () => {
  it("accepts a correct signature, also among several", () => {
    const good = sign(`msg_1.${timestamp}.${body}`);
    expect(verifySignature(secret, headers(good), body, now)).toBe(true);
    expect(verifySignature(secret, headers(`v1,AAAA ${good}`), body, now)).toBe(true);
  });

  it("refuses a changed body", () => {
    const good = sign(`msg_1.${timestamp}.${body}`);
    expect(verifySignature(secret, headers(good), body.replace("Permanent", "Transient"), now)).toBe(false);
  });

  it("refuses a timestamp more than 5 minutes off", () => {
    const old = String(now.getTime() / 1000 - 301);
    expect(verifySignature(secret, headers(sign(`msg_1.${old}.${body}`), old), body, now)).toBe(false);
  });

  it("refuses another secret and missing headers", () => {
    const other = `whsec_${Buffer.from("another secret, thirty-two bytes").toString("base64")}`;
    expect(verifySignature(secret, headers(sign(`msg_1.${timestamp}.${body}`, other)), body, now)).toBe(
      false,
    );
    expect(verifySignature(secret, { id: null, timestamp, signature: "v1,x" }, body, now)).toBe(false);
  });
});

describe("suppressionFrom", () => {
  it("stops e-mail after a permanent bounce or a complaint, in lower case", () => {
    expect(suppressionFrom(JSON.parse(body))).toEqual({ emails: ["someone@example.com"], reason: "bounce" });
    expect(suppressionFrom({ type: "email.complained", data: { to: ["a@example.com"] } })).toEqual({
      emails: ["a@example.com"],
      reason: "complaint",
    });
  });

  it("ignores a temporary bounce and every other event", () => {
    expect(
      suppressionFrom({
        type: "email.bounced",
        data: { to: ["a@example.com"], bounce: { type: "Transient" } },
      }),
    ).toBeNull();
    expect(suppressionFrom({ type: "email.delivered", data: { to: ["a@example.com"] } })).toBeNull();
  });

  it("fails on a format it doesn't know", () => {
    expect(() => suppressionFrom({ data: [] })).toThrow();
  });
});
