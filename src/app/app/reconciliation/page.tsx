import { redirect } from "next/navigation";

export default function ReconciliationRedirect() {
  redirect("/app?tab=reconciliation");
}
