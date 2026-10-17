import { Suspense } from "react";
import { ConverterMainTabs } from "@/components/converter/converter-main-tabs";
import { parseWorkspaceTab, type WorkspaceTabId } from "@/lib/workspace-tabs";

function PaneFallback() {
  return (
    <div className="animate-pulse space-y-3 p-2">
      <div className="h-9 w-64 rounded-lg bg-slate-200/80" />
      <div className="h-24 rounded-xl bg-slate-100" />
      <div className="h-48 rounded-xl bg-slate-100" />
    </div>
  );
}

export async function ConverterWorkspace({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const tab: WorkspaceTabId = parseWorkspaceTab(params.tab);
  const windowDays = Number(params.window ?? 7) || 7;

  return (
    <>
      <ConverterMainTabs activeTab={tab} />
      <section className="panel tab-pane">
        <Suspense key={tab} fallback={<PaneFallback />}>
          <ActivePane tab={tab} params={params} windowDays={windowDays} />
        </Suspense>
      </section>
    </>
  );
}

/** Dynamic import per tab so unused pane client bundles stay out of the critical path. */
async function ActivePane({
  tab,
  params,
  windowDays,
}: {
  tab: WorkspaceTabId;
  params: Record<string, string | undefined>;
  windowDays: number;
}) {
  switch (tab) {
    case "general-entries": {
      const { default: Pane } = await import("@/app/app/workspace/panes/general-entries-pane");
      return <Pane />;
    }
    case "transfers": {
      const { default: Pane } = await import("@/app/app/workspace/panes/transfers-pane");
      return <Pane windowDays={windowDays} />;
    }
    case "reconciliation": {
      const { default: Pane } = await import("@/app/app/workspace/panes/reconciliation-pane");
      return <Pane />;
    }
    case "gst": {
      const { default: Pane } = await import("@/app/app/workspace/panes/gst-pane");
      return <Pane searchParams={Promise.resolve(params)} />;
    }
    case "pst": {
      const { default: Pane } = await import("@/app/app/workspace/panes/pst-pane");
      return <Pane searchParams={Promise.resolve(params)} />;
    }
    case "transactions":
    default: {
      const { default: Pane } = await import("@/app/app/workspace/panes/transactions-pane");
      return <Pane loadedConversionId={params.loadedConversion} />;
    }
  }
}
