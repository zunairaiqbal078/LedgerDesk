import { handleSignedWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  return handleSignedWebhook(request);
}
