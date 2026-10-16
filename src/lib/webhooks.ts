import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const inboundSchema = z.object({
  provider: z.string().min(1),
  eventType: z.string().min(1),
  externalId: z.string().optional(),
  organizationId: z.string().optional(),
  payload: z.unknown(),
});

export async function handleSignedWebhook(request: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret is not configured" },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get("x-ledgerdesk-signature") ??
    request.headers.get("x-webhook-signature");

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inboundSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const event = await prisma.webhookEvent.create({
    data: {
      provider: parsed.data.provider,
      eventType: parsed.data.eventType,
      externalId: parsed.data.externalId,
      organizationId: parsed.data.organizationId,
      payload: parsed.data.payload as object,
      status: "RECEIVED",
    },
  });

  // Provider-specific processing hooks land here (Plaid, billing, etc.)
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, eventId: event.id });
}
