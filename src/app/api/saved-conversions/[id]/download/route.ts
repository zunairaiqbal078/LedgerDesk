import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { transactionsToCsv } from "@/lib/conversion-export";
import { userCanAccessOrganization } from "@/lib/org-access";
import type { GlobalRole } from "@prisma/client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const globalRole = ((session.user as { globalRole?: string }).globalRole ?? "USER") as GlobalRole;

  const saved = await prisma.savedConversion.findUnique({
    where: { id },
    include: { folder: { include: { organization: true } } },
  });
  if (!saved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const orgId = saved.folder.organizationId;
  const allowed = await userCanAccessOrganization(session.user.id, orgId, globalRole);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const snapshot = saved.snapshot as {
    transactions?: Array<{
      date: string;
      description: string;
      moneyIn: number;
      moneyOut: number;
      accountNumber?: string | null;
      accountName?: string | null;
      province?: string | null;
      taxCodes?: string[];
      provinceTaxCodes?: string[];
      taxMode?: string;
      notes?: string | null;
    }>;
  };

  const csv = transactionsToCsv(snapshot.transactions ?? []);
  const safeName = saved.name.replace(/[^\w\s-]/g, "").trim() || "conversion";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
}
