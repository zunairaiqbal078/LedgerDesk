import { normalizeProvince } from "@/lib/canada-provinces";

export type ProvinceTaxProfile = {
  province: string;
  federal: string;
  mealFederal: string;
  provincial: string;
};

const PROFILES: Record<string, Omit<ProvinceTaxProfile, "province">> = {
  AB: { federal: "GST5", mealFederal: "GST2.5", provincial: "" },
  BC: { federal: "GST5", mealFederal: "GST2.5", provincial: "BC PST7" },
  MB: { federal: "GST5", mealFederal: "GST2.5", provincial: "MB RST7" },
  QC: { federal: "GST5", mealFederal: "GST2.5", provincial: "QST9975" },
  SK: { federal: "GST5", mealFederal: "GST2.5", provincial: "SK PST6" },
  NT: { federal: "GST5", mealFederal: "GST2.5", provincial: "" },
  NU: { federal: "GST5", mealFederal: "GST2.5", provincial: "" },
  YT: { federal: "GST5", mealFederal: "GST2.5", provincial: "" },
  ON: { federal: "HST13", mealFederal: "GST2.5", provincial: "" },
  NS: { federal: "HST15", mealFederal: "GST2.5", provincial: "" },
  NB: { federal: "HST15", mealFederal: "GST2.5", provincial: "" },
  NL: { federal: "HST15", mealFederal: "GST2.5", provincial: "" },
  PE: { federal: "HST15", mealFederal: "GST2.5", provincial: "" },
};

export function provinceTaxProfile(province: string | null | undefined): ProvinceTaxProfile {
  const p = normalizeProvince(province ?? "");
  if (!p) {
    return { province: "", federal: "", mealFederal: "", provincial: "" };
  }
  const base = PROFILES[p] ?? { federal: "", mealFederal: "", provincial: "" };
  return { province: p, ...base };
}

export function provinceTaxProfileText(province: string | null | undefined) {
  const profile = provinceTaxProfile(province);
  if (!profile.province) {
    return "Province: Not set — tax defaults stay unchanged.";
  }
  const prov = profile.provincial ? ` + ${profile.provincial}` : "";
  return `${profile.province}: ${profile.federal || "No GST/HST default"}${prov}. Taxability can still be overridden per transaction.`;
}

type TaxCodeLike = { code: string; kind?: string; province?: string | null; rate?: number };

export function resolveProvinceTaxCode(
  province: string | null | undefined,
  taxCodes: TaxCodeLike[],
): string {
  const profile = provinceTaxProfile(province);
  if (profile.provincial && taxCodes.some((t) => t.code === profile.provincial)) {
    return profile.provincial;
  }
  const p = normalizeProvince(province ?? "");
  if (!p) return "";
  const match = taxCodes.find(
    (t) =>
      (t.kind === "PST" || /PST|QST|RST/i.test(t.code)) &&
      normalizeProvince(t.province ?? "") === p &&
      Number(t.rate ?? 0) > 0,
  );
  return match?.code ?? "";
}

export function filingFrequencyFromHtml(value: string): "MONTHLY" | "QUARTERLY" | "YEARLY" {
  const v = value.toLowerCase();
  if (v === "monthly") return "MONTHLY";
  if (v === "yearly") return "YEARLY";
  return "QUARTERLY";
}
