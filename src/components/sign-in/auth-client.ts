"use client";

import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The browser's side of the sign-in (plan 11): it only calls the endpoints the
// server lets through, on the app's own address.
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });

/** Where the address waits between the two steps, so it never goes in a URL. */
export const EMAIL_KEY = "oc-sign-in-email";
