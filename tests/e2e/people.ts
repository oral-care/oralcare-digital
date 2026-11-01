// The made-up people the end-to-end tests sign in as (plan 15.3). Example
// addresses only; tests/e2e/server.ts invites them.

export const PEOPLE = {
  admin: {
    email: "e2e-admin@oralcare.se",
    first: "Ada",
    last: "Admin",
    role: "admin",
    views: "all",
    markets: ["se", "no", "dk", "nl"],
  },
  viewer: {
    email: "e2e-viewer@oralcare.se",
    first: "Vera",
    last: "Viewer",
    role: "viewer",
    views: ["availability", "nps"],
    markets: ["se"],
  },
  agency: {
    email: "e2e@agency.example",
    first: "Kim",
    last: "Agency",
    role: "viewer",
    views: ["tracking-framework"],
    markets: ["se"],
  },
  noViews: {
    email: "e2e-none@oralcare.dk",
    first: "Nils",
    last: "None",
    role: "viewer",
    views: [],
    markets: ["dk"],
  },
  wrongCode: {
    email: "e2e-wrong@oralcare.se",
    first: "Wille",
    last: "Wrong",
    role: "viewer",
    views: ["nps"],
    markets: ["se"],
  },
} as const;

export type Person = keyof typeof PEOPLE;
