import { redirect } from "next/navigation";

export default async function TransfersRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = new URLSearchParams({ tab: "transfers", ...params } as Record<string, string>);
  redirect(`/app?${q.toString()}`);
}
