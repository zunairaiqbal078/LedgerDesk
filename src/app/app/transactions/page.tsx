import { redirect } from "next/navigation";

export default function TransactionsRedirect() {
  redirect("/app?tab=transactions");
}
