import { ConverterMainTabs } from "@/components/converter/converter-main-tabs";
import { parseWorkspaceTab, type WorkspaceTabId } from "@/lib/workspace-tabs";
import GeneralEntriesPane from "@/app/app/workspace/panes/general-entries-pane";
import GstPane from "@/app/app/workspace/panes/gst-pane";
import PstPane from "@/app/app/workspace/panes/pst-pane";
import ReconciliationPane from "@/app/app/workspace/panes/reconciliation-pane";
import TransactionsPane from "@/app/app/workspace/panes/transactions-pane";
import TransfersPane from "@/app/app/workspace/panes/transfers-pane";

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
        {tab === "transactions" ? (
          <TransactionsPane loadedConversionId={params.loadedConversion} />
        ) : null}
        {tab === "general-entries" ? <GeneralEntriesPane /> : null}
        {tab === "transfers" ? <TransfersPane windowDays={windowDays} /> : null}
        {tab === "reconciliation" ? <ReconciliationPane /> : null}
        {tab === "gst" ? <GstPane searchParams={Promise.resolve(params)} /> : null}
        {tab === "pst" ? <PstPane searchParams={Promise.resolve(params)} /> : null}
      </section>
    </>
  );
}
