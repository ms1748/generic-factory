// The one confirmation dialog: anything that starts a run, stops the factory or changes GitHub asks first.
import * as React from "react";
import { closeAsk, useOverlays } from "@/lib/overlays";
import { Dialog, DialogContent } from "./ui/overlays";
import { Button } from "./ui/button";

export function Confirm() {
  const { ask } = useOverlays();
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={Boolean(ask)} onOpenChange={(o) => !o && closeAsk()}>
      {ask && (
        <DialogContent title={ask.title} description={ask.body}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAsk}>
              Cancel
            </Button>
            <Button
              variant={ask.danger ? "destructive" : "brand"}
              disabled={busy}
              autoFocus
              onClick={async () => {
                setBusy(true);
                try {
                  await ask.action();
                } finally {
                  setBusy(false);
                  closeAsk();
                }
              }}
            >
              {ask.yes}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
