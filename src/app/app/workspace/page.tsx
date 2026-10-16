import { redirect } from "next/navigation";

export default async function WorkspaceRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? "transactions";
  const q = new URLSearchParams(params as Record<string, string>);
  q.set("tab", tab);
  redirect(`/app?${q.toString()}`);
}
