import * as React from "react";
import { Toaster } from "sonner";
import { load, useStore } from "@/lib/api";
import { useRoute } from "@/lib/router";
import { Shell } from "@/components/Shell";
import { DetailSheet } from "@/components/DetailSheet";
import { Confirm } from "@/components/Confirm";
import { Palette } from "@/components/Palette";
import { TooltipProvider, Skeleton } from "@/components/ui/primitives";
import { HomeView } from "@/views/HomeView";
import { InboxView } from "@/views/InboxView";
import { WorkView } from "@/views/WorkView";
import { RunsView } from "@/views/RunsView";
import { LanesView } from "@/views/LanesView";
import { MachinesView } from "@/views/MachinesView";
import { InsightsView } from "@/views/InsightsView";
import { LinksView } from "@/views/LinksView";
import { SettingsView } from "@/views/SettingsView";

const VIEWS: Record<string, React.ComponentType<{ d: import("@/lib/api").State; tab: string; arg: string }>> = {
  home: HomeView,
  inbox: InboxView,
  work: WorkView,
  runs: RunsView,
  lanes: LanesView,
  machines: MachinesView,
  insights: InsightsView,
  links: LinksView,
  settings: SettingsView,
};

/** One view failing to render shows a note there, not a blank page. */
class ViewBoundary extends React.Component<{ children: React.ReactNode; route: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  componentDidUpdate(prev: { route: string }) {
    // Another tab or item of the same view gets a fresh try.
    if (this.state.error && prev.route !== this.props.route) this.setState({ error: null });
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-bad/30 bg-bad/5 p-5 text-sm">
        <div className="font-medium text-bad">This page hit an error</div>
        <p className="mt-1 text-muted-foreground">The rest of the dashboard still works. Reload to try again.</p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-2 text-xs">{this.state.error.message}</pre>
      </div>
    );
  }
}

export function App() {
  const { data: d, error } = useStore();
  const r = useRoute();
  React.useEffect(() => {
    load();
  }, []);
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [r.view]);
  const View = VIEWS[r.view] ?? HomeView;
  return (
    <TooltipProvider>
      <Shell>
        {d ? (
          <ViewBoundary key={r.view} route={`${r.tab}/${r.arg}`}>
            <View d={d} tab={r.tab} arg={r.arg} />
          </ViewBoundary>
        ) : error ? (
          <div className="grid min-h-[60vh] place-items-center text-sm text-bad">Can't reach the dispatcher: {error}</div>
        ) : (
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        )}
      </Shell>
      <DetailSheet />
      <Confirm />
      <Palette />
      <Toaster position="bottom-center" theme="system" richColors closeButton offset={{ bottom: 88 }} toastOptions={{ className: "!rounded-xl" }} />
    </TooltipProvider>
  );
}
