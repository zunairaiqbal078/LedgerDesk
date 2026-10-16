import { ConverterWorkspace } from "@/components/converter/converter-workspace";

export default function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <ConverterWorkspace searchParams={searchParams} />;
}
