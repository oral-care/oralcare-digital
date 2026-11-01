import {
  Activity,
  CalendarCheck,
  ChartColumn,
  Funnel,
  GitCompare,
  Hospital,
  Smile,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { IconName } from "@/lib/modules";

// The modules' icons (plan 4.13): src/lib/modules.ts names them, and this is
// the one place that maps the names to Lucide's components.
export const MODULE_ICONS: Record<IconName, LucideIcon> = {
  Activity,
  CalendarCheck,
  ChartColumn,
  Funnel,
  GitCompare,
  Hospital,
  Smile,
  Target,
  Users,
};
