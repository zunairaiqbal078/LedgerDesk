import { redirect } from "next/navigation";

export default async function GstRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = new URLSearchParams({ tab: "gst", ...params } as Record<string, string>);
  redirect(`/app?${q.toString()}`);
}
