import { createAuthClient } from "better-auth/react";

function authBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: authBaseUrl(),
});
