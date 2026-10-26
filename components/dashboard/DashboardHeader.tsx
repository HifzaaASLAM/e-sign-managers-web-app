import Link from "next/link";
import { getDashboardWorkspaceHeaderProps } from "../../lib/dashboard/workspace-header";
import { DashboardNav } from "./DashboardNav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export async function DashboardHeader({ active }: { active?: string }) {
  const workspace = await getDashboardWorkspaceHeaderProps();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex h-10 items-center justify-between gap-4">
          <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-slate-900">
            SHM Documents
          </Link>
          <div className="min-w-0 overflow-x-auto">
            <DashboardNav active={active} />
          </div>
        </div>
        {workspace?.workspaceName ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <p className="text-xs text-slate-600">
              <span className="font-semibold uppercase tracking-wide text-slate-400">Workspace</span>{" "}
              <span className="font-medium text-slate-800">{workspace.workspaceName}</span>
              {workspace.workspaces.length <= 1 ? (
                <span className="text-slate-400"> · documents are scoped to this workspace</span>
              ) : null}
            </p>
            <WorkspaceSwitcher workspaces={workspace.workspaces} activeSlug={workspace.activeSlug} />
          </div>
        ) : null}
      </div>
    </header>
  );
}
