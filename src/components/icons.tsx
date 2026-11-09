import {
  Activity,
  LayoutDashboard,
  ListChecks,
  NotebookText,
  Puzzle,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Icon names a plugin may use in plugin.json. Unknown names fall back to a puzzle piece. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  settings: Settings,
  puzzle: Puzzle,
  notebook: NotebookText,
  activity: Activity,
  server: Server,
  list: ListChecks,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Puzzle;
  return <Icon className={className} aria-hidden />;
}
