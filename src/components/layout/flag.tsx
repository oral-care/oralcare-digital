import { cn } from "@/lib/utils";

// A market's code in a small green square (plan 4.2 and 4.3).
export function Flag({ code, large = false }: { code: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-md bg-oc-green-200 text-paragraph-nano font-semibold tracking-wide text-oc-green-600",
        large ? "size-8 rounded-lg" : "size-6",
      )}
    >
      {code.toUpperCase()}
    </span>
  );
}
