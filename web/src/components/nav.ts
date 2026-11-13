// The views, in the order the sidebar and the phone's tab bar show them, with their tabs.
import { HomeIcon, InboxIcon, KanbanSquareIcon, PlayCircleIcon, WaypointsIcon, ServerIcon, BarChart3Icon, LinkIcon, SettingsIcon, type LucideIcon } from "lucide-react";

export type NavItem = { view: string; label: string; icon: LucideIcon; group: "Work" | "Factory" | "Homelab"; tabs?: { tab: string; label: string }[] };

export const NAV: NavItem[] = [
  { view: "home", label: "Home", icon: HomeIcon, group: "Work" },
  { view: "inbox", label: "Inbox", icon: InboxIcon, group: "Work" },
  { view: "work", label: "Work", icon: KanbanSquareIcon, group: "Work", tabs: [{ tab: "board", label: "Board" }, { tab: "ideas", label: "Ideas" }] },
  { view: "runs", label: "Runs", icon: PlayCircleIcon, group: "Work", tabs: [{ tab: "runs", label: "Runs" }, { tab: "activity", label: "Activity" }, { tab: "logs", label: "Logs" }] },
  { view: "lanes", label: "Lanes", icon: WaypointsIcon, group: "Factory" },
  { view: "insights", label: "Insights", icon: BarChart3Icon, group: "Factory", tabs: [{ tab: "data", label: "Data" }, { tab: "reports", label: "Crash reports" }] },
  { view: "machines", label: "Machines", icon: ServerIcon, group: "Homelab", tabs: [{ tab: "devices", label: "Devices" }, { tab: "systems", label: "Systems" }, { tab: "performance", label: "Performance" }] },
  { view: "links", label: "Links", icon: LinkIcon, group: "Homelab" },
  { view: "settings", label: "Settings", icon: SettingsIcon, group: "Homelab", tabs: [{ tab: "general", label: "General" }, { tab: "limits", label: "Limits" }, { tab: "alerts", label: "Alerts" }, { tab: "builds", label: "Test builds" }, { tab: "games", label: "Game tests" }, { tab: "install", label: "Install" }] },
];

/** The phone's bottom bar; the rest open from More. */
export const MOBILE_MAIN = ["home", "inbox", "work", "runs"];
