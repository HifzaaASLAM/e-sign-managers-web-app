"use client";

import { useTransition } from "react";
import { switchWorkspaceCompany } from "../../app/dashboard/workspace-actions";

type WorkspaceOption = {
  slug: string;
  name: string;
  role: string;
};

export function WorkspaceSwitcher({
  workspaces,
  activeSlug,
}: {
  workspaces: WorkspaceOption[];
  activeSlug: string;
}) {
  const [pending, startTransition] = useTransition();

  if (workspaces.length <= 1) return null;

  return (
    <label className="flex max-w-[220px] items-center gap-2 text-xs text-slate-600 sm:max-w-xs">
      <span className="hidden shrink-0 font-semibold uppercase tracking-wide text-slate-400 sm:inline">Workspace</span>
      <select
        className="w-full min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-60"
        value={activeSlug}
        disabled={pending}
        onChange={(event) => {
          const slug = event.target.value;
          startTransition(() => switchWorkspaceCompany(slug));
        }}
      >
        {workspaces.map((ws) => (
          <option key={ws.slug} value={ws.slug}>
            {ws.name} ({ws.role.toLowerCase()})
          </option>
        ))}
      </select>
    </label>
  );
}
