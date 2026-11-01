import { Logo } from "@/components/layout/logo";

// The sign-in pages (plan 4.2): the logo in the same place in every step,
// and the step's content under it.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh justify-center bg-background px-6 pt-60 pb-12">
      <div className="flex w-full max-w-90 flex-col items-center gap-10">
        <Logo size="large" />
        {children}
      </div>
    </main>
  );
}

/** The line under the logo. */
export function AuthNote({ children }: { children: React.ReactNode }) {
  return <p className="-my-4 text-center text-paragraph-small text-muted-foreground">{children}</p>;
}
