// Copied from oralcare.se src/lib/utils.ts at commit 79625c8 (plan 4.14).
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register our custom typography utilities (defined as --text-* in globals.css)
// with tailwind-merge so it doesn't mistake them for color classes and drop
// them when both are present (e.g. `text-paragraph-small text-foreground`).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "paragraph-large",
            "paragraph-regular",
            "paragraph-small",
            "paragraph-xs",
            "paragraph-mini",
            "paragraph-nano",
            "caption",
            "mono",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
