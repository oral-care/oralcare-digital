import { describe, expect, it } from "vitest";

import type { ViewKey } from "@/lib/db/schema/auth";
import type { MarketCode } from "@/lib/markets";
import { viewOfPath } from "@/lib/modules";

import { isGroupEmail, marketForEmail, normalizeEmail } from "./allowed-email";
import { canOpenView, homePath, openMarkets, openViews, type Viewer } from "./permissions";
import { clientIp } from "./throttle";

// Who may sign in, and what they may open (plan 3, 11 and 15.1).

describe("e-mail addresses", () => {
  it("accepts any domain, in lower case", () => {
    expect(normalizeEmail(" Anna.Lind@OralCare.se ")).toBe("anna.lind@oralcare.se");
    expect(normalizeEmail("Kim@Agency.example")).toBe("kim@agency.example");
  });

  it("marks only the group's own domains as the group, not subdomains or lookalikes", () => {
    expect(isGroupEmail("ola@octannklinikker.no")).toBe(true);
    for (const email of ["a@gmail.com", "a@mail.oralcare.se", "a@oralcare.se.evil.com", "a@oralcare.sex"]) {
      expect(isGroupEmail(email), email).toBe(false);
    }
  });

  it("refuses plus signs, quotes, non-ASCII and malformed addresses", () => {
    for (const raw of [
      "a+b@oralcare.se",
      '"a"@oralcare.se',
      "åsa@oralcare.se",
      "a@@oralcare.se",
      "a@oralcare",
      "",
      "a b@oralcare.se",
    ]) {
      expect(normalizeEmail(raw), raw).toBeNull();
    }
  });

  it("suggests the market from the domain", () => {
    expect(marketForEmail("a@oralcare.dk")).toBe("dk");
    expect(marketForEmail("a@agency.example")).toBeNull();
  });
});

const viewer = (views: ViewKey[], markets: MarketCode[], extra: Partial<Viewer> = {}): Viewer => ({
  id: "u1",
  email: "a@oralcare.se",
  firstName: "A",
  lastName: "B",
  role: "viewer",
  views,
  markets,
  ...extra,
});

describe("permissions", () => {
  it("opens only the ticked views, also for an address outside the group", () => {
    expect(canOpenView(viewer(["nps"], ["se"]), "nps")).toBe(true);
    expect(canOpenView(viewer(["nps"], ["se"]), "availability")).toBe(false);
    const agency = viewer(["tracking-framework", "availability"], ["se"], { email: "kim@agency.example" });
    expect(openViews(agency)).toEqual(["availability", "tracking-framework"]);
  });

  it("starts on the first view in menu order, in the chosen market if it is theirs", () => {
    const v = viewer(["nps", "availability"], ["dk", "se"]);
    expect(openMarkets(v)).toEqual(["se", "dk"]);
    expect(homePath(v)).toBe("/se/availability");
    expect(homePath(v, "dk")).toBe("/dk/availability");
    expect(homePath(v, "no")).toBe("/se/availability");
    expect(homePath(viewer(["nps"], ["no"]))).toBe("/no/nps");
  });

  it("sends someone without a view or a market to /no-access", () => {
    expect(homePath(viewer([], ["se"]))).toBe("/no-access");
    expect(homePath(viewer(["nps"], []))).toBe("/no-access");
  });

  it("knows which view a path belongs to", () => {
    expect(viewOfPath("availability/clinics/12")).toBe("availability");
    expect(viewOfPath("admin/users")).toBeNull();
  });
});

describe("clientIp", () => {
  it("takes the first address Vercel put in x-forwarded-for", () => {
    expect(clientIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientIp(null)).toBe("unknown");
  });

  it("counts IPv6 per /64", () => {
    expect(clientIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::/64");
    expect(clientIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});
