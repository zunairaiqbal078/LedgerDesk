"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { loadSavedConversionClientAction } from "@/app/actions/saves";
import { Button } from "@/components/ui";
import { writeLoadedConversionContext } from "@/lib/conversion-export";

export function LoadSavedConversionButton({
  organizationId,
  conversionId,
  replace = true,
  size = "sm",
  children = "Load",
}: {
  organizationId: string;
  conversionId: string;
  replace?: boolean;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size={size}
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set("id", conversionId);
        formData.set("replace", replace ? "true" : "false");
        startTransition(async () => {
          const result = await loadSavedConversionClientAction(formData);
          if (!result.ok) {
            toast.error(result.error ?? "Could not load save");
            return;
          }
          if (result.loadedConversion) {
            writeLoadedConversionContext({
              organizationId,
              conversionId: result.loadedConversion.conversionId,
              conversionName: result.loadedConversion.conversionName,
              folderId: result.loadedConversion.folderId,
              folderName: result.loadedConversion.folderName,
            });
          }
          toast.success(result.message);
          router.push("/app?tab=transactions");
          router.refresh();
        });
      }}
    >
      {pending ? "Loading…" : children}
    </Button>
  );
}
