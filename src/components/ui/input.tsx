// Copied from oralcare.se src/components/ui/input.tsx at commit 79625c8 (plan 4.14).
// The line height and the disabled placeholder colour use tokens instead of fixed values.

import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex w-full min-w-0 rounded-lg bg-white p-4 text-base leading-4.5 inset-ring-1 inset-ring-border outline-none transition-[box-shadow,background-color] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:bg-secondary disabled:placeholder:text-border-4 aria-invalid:inset-ring-2 aria-invalid:inset-ring-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
