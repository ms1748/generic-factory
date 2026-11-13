// Sheets (side panels; a bottom sheet on phones), dialogs and menus, on Radix.
import * as React from "react";
import { Dialog as DialogP, DropdownMenu as MenuP } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogP.Root;
export const SheetTrigger = DialogP.Trigger;
export const SheetClose = DialogP.Close;

/** A panel from the right on wide screens, from the bottom on phones. */
export function SheetContent({ className, children, title, description, wide, ...p }: Omit<React.ComponentProps<typeof DialogP.Content>, "title"> & { title: React.ReactNode; description?: React.ReactNode; wide?: boolean }) {
  return (
    <DialogP.Portal>
      <DialogP.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogP.Content
        className={cn(
          "fixed z-50 flex flex-col bg-background shadow-2xl outline-none transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          "md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:h-full md:max-h-none md:rounded-none md:border-t-0 md:border-l md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right",
          wide ? "md:w-[min(820px,92vw)]" : "md:w-[min(620px,92vw)]",
          className,
        )}
        {...p}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted md:hidden" />
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogP.Title className="text-base font-semibold leading-snug">{title}</DialogP.Title>
            {description ? <DialogP.Description asChild><div className="mt-1 text-xs text-muted-foreground">{description}</div></DialogP.Description> : <DialogP.Description className="sr-only">Details</DialogP.Description>}
          </div>
          <DialogP.Close className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogP.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </DialogP.Content>
    </DialogP.Portal>
  );
}

export const Dialog = DialogP.Root;
export function DialogContent({ className, children, title, description, ...p }: Omit<React.ComponentProps<typeof DialogP.Content>, "title"> & { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <DialogP.Portal>
      <DialogP.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogP.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-5 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...p}
      >
        <div>
          <DialogP.Title className="text-base font-semibold">{title}</DialogP.Title>
          {description ? <DialogP.Description asChild><div className="mt-1.5 text-sm text-muted-foreground">{description}</div></DialogP.Description> : <DialogP.Description className="sr-only">Dialog</DialogP.Description>}
        </div>
        {children}
      </DialogP.Content>
    </DialogP.Portal>
  );
}
export const DialogClose = DialogP.Close;

export const Menu = MenuP.Root;
export const MenuTrigger = MenuP.Trigger;
export function MenuContent({ className, align = "end", ...p }: React.ComponentProps<typeof MenuP.Content>) {
  return (
    <MenuP.Portal>
      <MenuP.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)}
        {...p}
      />
    </MenuP.Portal>
  );
}
export function MenuItem({ className, destructive, ...p }: React.ComponentProps<typeof MenuP.Item> & { destructive?: boolean }) {
  return (
    <MenuP.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-bad data-[highlighted]:bg-bad/10 [&_svg]:text-bad",
        className,
      )}
      {...p}
    />
  );
}
export function MenuLabel({ className, ...p }: React.ComponentProps<typeof MenuP.Label>) {
  return <MenuP.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...p} />;
}
export function MenuSeparator({ className, ...p }: React.ComponentProps<typeof MenuP.Separator>) {
  return <MenuP.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
}
