// Links: bookmarks, grouped, as tiles. Edit adds and removes them (saved on the factory, so every browser
// sees the same list).
import * as React from "react";
import { LinkIcon, PencilIcon, CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { confirm } from "@/lib/overlays";
import { PageHeader, Empty } from "@/components/patterns";
import { Card, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Link = { id: number; title: string; url: string; grp: string };

const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function LinksView({ d }: { d: State; tab: string; arg: string }) {
  const links: Link[] = d.links ?? [];
  const [editing, setEditing] = React.useState(false);
  const groups = [...new Set(links.map((l) => l.grp))];

  return (
    <>
      <PageHeader
        title="Links"
        description={`${links.length} link${links.length === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing(!editing)}>
            {editing ? <CheckIcon /> : <PencilIcon />} {editing ? "Done" : "Edit"}
          </Button>
        }
      />
      <div className="flex flex-col gap-6">
        {editing && <AddLink groups={groups} />}
        {!links.length && (
          <Empty icon={LinkIcon} title="No links yet">
            {editing ? "Add one above." : "Press Edit to add one."}
          </Empty>
        )}
        {groups.map((g) => (
          <section key={g} className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g}</h2>
            <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {links
                .filter((l) => l.grp === g)
                .map((l) => (
                  <Tile key={l.id} l={l} editing={editing} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Tile({ l, editing }: { l: Link; editing: boolean }) {
  return (
    <div className="group relative">
      <a href={l.url} target="_blank" rel="noopener" title={l.url} className={`flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition hover:border-foreground/15 hover:bg-accent/40 ${editing ? "pr-11" : ""}`}>
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-sm font-semibold text-brand">
          {l.title.slice(0, 1).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{l.title || host(l.url)}</span>
          <span className="block truncate text-xs text-muted-foreground">{host(l.url)}</span>
        </span>
      </a>
      {editing && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${l.title}`}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:bg-bad/10 hover:text-bad"
          onClick={() => confirm({ title: `Remove ${l.title || host(l.url)}?`, yes: "Remove", danger: true, action: () => control(`links/${l.id}/remove`) })}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

function AddLink({ groups }: { groups: string[] }) {
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [group, setGroup] = React.useState("");
  const listId = React.useId();
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    if (await control("links", { title, url, group: group || "Other" })) {
      setTitle("");
      setUrl("");
    }
  }
  return (
    <Card className="p-3">
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
        <Input placeholder="Name" aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input placeholder="https://…" aria-label="Address" required value={url} onChange={(e) => setUrl(e.target.value)} />
        <Input placeholder="Group" aria-label="Group" list={listId} value={group} onChange={(e) => setGroup(e.target.value)} />
        <datalist id={listId}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Button type="submit" size="default" variant="brand">
          <PlusIcon /> Add
        </Button>
      </form>
    </Card>
  );
}
