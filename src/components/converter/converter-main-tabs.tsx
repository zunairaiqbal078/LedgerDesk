"use client";

import Link from "next/link";
import { WORKSPACE_TABS, type WorkspaceTabId } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";

export function ConverterMainTabs({ activeTab }: { activeTab: WorkspaceTabId }) {
  return (
    <div className="main-tabs">
      {WORKSPACE_TABS.map((tab) => {
        const href = tab.id === "transactions" ? "/app" : `/app?tab=${tab.id}`;
        const active = activeTab === tab.id;
        return (
          <Link
            key={tab.id}
            href={href}
            className={cn("main-tab", active && "active")}
            prefetch={false}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
