import Link from "next/link";

export const DASHBOARD_NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/documents/new", label: "Send New" },
  { href: "/dashboard/applications", label: "Applications" },
  { href: "/dashboard/inspections", label: "Inspection" },
  { href: "/dashboard/profiles", label: "Profiles" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/data", label: "Data" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardNav({ active }: { active?: string }) {
  return (
    <nav className="flex items-center gap-5 whitespace-nowrap text-sm sm:gap-6">
      {DASHBOARD_NAV_LINKS.map((link) => {
        const isActive =
          active === link.href
          || (link.href !== "/dashboard" && Boolean(active?.startsWith(link.href)));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={isActive ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
