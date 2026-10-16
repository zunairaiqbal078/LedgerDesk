import { Prisma } from "@prisma/client";

function messageLooksLikeDbDown(msg: string): boolean {
  return (
    msg.includes("Can't reach database server") ||
    msg.includes("Connection refused") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("P1001") ||
    msg.includes("PrismaClientInitializationError")
  );
}

/** Walk error.cause — Better Auth / bundlers may wrap Prisma errors. */
export function isPrismaConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (current instanceof Prisma.PrismaClientInitializationError) return true;
    if (
      current instanceof Prisma.PrismaClientKnownRequestError &&
      current.code === "P1001"
    ) {
      return true;
    }
    const msg = current instanceof Error ? current.message : String(current);
    if (messageLooksLikeDbDown(msg)) return true;
    current =
      current instanceof Error && "cause" in current
        ? (current as Error).cause
        : undefined;
  }
  return false;
}
