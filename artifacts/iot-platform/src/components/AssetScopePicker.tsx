import { useMemo } from "react";
import { useListAssets } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n";

/**
 * "Project or asset" picker shared by AI Advisor and AI Reports.
 *
 * Lists "All assets", every project (root asset), and the assets beneath the
 * project that holds the current choice, indented by depth. Picking a project
 * therefore reveals its assets; picking another project switches to its tree.
 * The value is an asset id, or "all".
 */
interface TreeAsset { id: string; name: string; parentId?: string | null }

export function useAssetTree() {
  const { data } = useListAssets();
  return useMemo(() => {
    const assets = ((data as TreeAsset[] | undefined) ?? []);
    const byId = new Map(assets.map((a) => [a.id, a]));
    const kids = new Map<string, TreeAsset[]>();
    for (const a of assets) if (a.parentId) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
    for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const roots = assets.filter((a) => !a.parentId).sort((a, b) => a.name.localeCompare(b.name));
    /** The project (root) an asset belongs to. */
    const rootOf = (id: string): string | null => {
      let cur = byId.get(id);
      for (let guard = 0; cur?.parentId && guard < 64; guard++) cur = byId.get(cur.parentId);
      return cur?.id ?? null;
    };
    /** The assets beneath a root, depth first, with their depth (1 = direct child). */
    const descendants = (rootId: string): { a: TreeAsset; depth: number }[] => {
      const out: { a: TreeAsset; depth: number }[] = [];
      const walk = (id: string, depth: number) => {
        for (const k of kids.get(id) ?? []) { out.push({ a: k, depth }); if (depth < 32) walk(k.id, depth + 1); }
      };
      walk(rootId, 1);
      return out;
    };
    return { assets, byId, roots, rootOf, descendants };
  }, [data]);
}

export function AssetScopePicker({ value, onChange, allLabel, className, id }: {
  value: string;
  onChange: (v: string) => void;
  /** Text for the "everything" choice. */
  allLabel: string;
  className?: string;
  id?: string;
}) {
  const t = useT();
  const { roots, rootOf, descendants } = useAssetTree();
  const openRoot = value !== "all" ? rootOf(value) : null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className ?? "h-9 text-sm"} aria-label={t("Project or asset")}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {roots.map((r) => [
          <SelectItem key={r.id} value={r.id}>{t("Project")}: {r.name}</SelectItem>,
          ...(r.id === openRoot
            ? descendants(r.id).map(({ a, depth }) => (
                <SelectItem key={a.id} value={a.id}><span style={{ paddingLeft: depth * 12 }}>{a.name}</span></SelectItem>
              ))
            : []),
        ])}
      </SelectContent>
    </Select>
  );
}
