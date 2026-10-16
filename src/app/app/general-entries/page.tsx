import { redirect } from "next/navigation";

export default function GeneralEntriesRedirect() {
  redirect("/app?tab=general-entries");
}
