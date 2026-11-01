import { VIEW_KEYS, type ViewKey } from "@/lib/db/schema/auth";

// The modules: name, key, icon, address and place in the menu (plan 3.3, 4.3
// and 4.13). The menu, the views and the permissions all read this list. Icons
// are Lucide names; src/components/layout maps them to the components. Pure.

export type IconName =
  | "CalendarCheck"
  | "Hospital"
  | "GitCompare"
  | "ChartColumn"
  | "Smile"
  | "Funnel"
  | "Target"
  | "Activity"
  | "Users";

export type MenuItem = { name: string; icon: IconName; path: string };

export type Module = {
  key: ViewKey;
  name: string;
  icon: IconName;
  /** The view's start page, after /{market}. */
  path: string;
  group: "availability" | "coming-soon";
  /** The menu's links. A Coming soon module has one, its own page. */
  pages: MenuItem[];
};

export const MODULES: readonly Module[] = [
  {
    key: "availability",
    name: "Availability",
    icon: "CalendarCheck",
    path: "availability",
    group: "availability",
    pages: [
      { name: "What patients see", icon: "CalendarCheck", path: "availability" },
      { name: "Clinics", icon: "Hospital", path: "availability/clinics" },
      { name: "Patient vs Muntra", icon: "GitCompare", path: "availability/patient-vs-muntra" },
    ],
  },
  ...(
    [
      ["booking-statistics", "Booking statistics", "ChartColumn"],
      ["nps", "NPS", "Smile"],
      ["funnel", "Funnel", "Funnel"],
      ["tracking-framework", "Tracking Framework", "Target"],
      ["monitoring", "Monitoring", "Activity"],
    ] as const
  ).map(([key, name, icon]) => ({
    key,
    name,
    icon,
    path: key,
    group: "coming-soon" as const,
    pages: [{ name, icon, path: key }],
  })),
];

export const USERS_PAGE: MenuItem = { name: "Users", icon: "Users", path: "admin/users" };

export function moduleByKey(key: ViewKey): Module {
  const found = MODULES.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown module ${key}`);
  return found;
}

export function isViewKey(value: string): value is ViewKey {
  return (VIEW_KEYS as readonly string[]).includes(value);
}

/** The view a path after /{market} belongs to, or null for Users and unknown paths. */
export function viewOfPath(path: string): ViewKey | null {
  const first = path.split("/").filter(Boolean)[0] ?? "";
  return isViewKey(first) ? first : null;
}
