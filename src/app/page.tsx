import { redirect } from "next/navigation";

import { homePath } from "@/lib/auth/permissions";
import { getViewer } from "@/lib/auth/session";

// The start page (plan 4.1): the user's first view, or the sign-in.
export default async function Home(): Promise<never> {
  const viewer = await getViewer();
  redirect(viewer ? homePath(viewer) : "/sign-in");
}
