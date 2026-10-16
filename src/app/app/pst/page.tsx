import { redirect } from "next/navigation";

export default async function PstRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = new URLSearchParams({ tab: "pst", ...params } as Record<string, string>);
  redirect(`/app?${q.toString()}`);
}
