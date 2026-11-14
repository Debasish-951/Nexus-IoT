import { Palette, Sun, Moon } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useAppearance, type Skin, type Theme } from "@/lib/appearance";

/**
 * Appearance control: design language × light/dark.
 *
 * Replaces the bare sun/moon icon button. The light theme was always there, but
 * a single unlabelled icon gave no indication that a choice existed at all — so
 * it read as decoration and went unused. A labelled menu makes both axes
 * discoverable, which matters more now that there are two skins to move
 * between.
 *
 * Deliberately not offering "System": the platform is used on shop-floor
 * machines whose OS theme is often nobody's deliberate choice, and an operator
 * finding the dashboard has silently changed appearance overnight is worse than
 * one who has to pick once.
 */

const SKINS: { value: Skin; label: string; hint: string }[] = [
  { value: "slate", label: "Slate", hint: "Quiet precision — hairlines, flat surfaces, teal accent" },
  { value: "classic", label: "Classic", hint: "The original Electric Blue design" },
  { value: "navy", label: "Deep navy", hint: "Navy navigation, blue actions on white" },
  { value: "cool-grey", label: "Cool grey", hint: "Light grey page, white cards, dark left bar" },
  { value: "soft-white", label: "Soft white", hint: "Off-white page, white cards, dark left bar" },
  { value: "pale-blue", label: "Pale blue", hint: "Pale blue page, white cards, dark left bar" },
];

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function AppearanceMenu() {
  const { skin, theme, setSkin, setTheme } = useAppearance();
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={t("Appearance")}
          aria-label={t("Appearance settings")}
          data-testid="appearance-menu"
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
          )}
        >
          <Palette className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {t("Design")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skin} onValueChange={(v) => setSkin(v as Skin)}>
          {SKINS.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value} className="items-start py-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{t(s.label)}</span>
                <span className="text-xs text-muted-foreground leading-snug">{t(s.hint)}</span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          {t("Appearance")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map((th) => (
            <DropdownMenuRadioItem key={th.value} value={th.value}>
              <span className="flex items-center gap-2 text-sm">
                <th.icon className="w-3.5 h-3.5" />
                {t(th.label)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
