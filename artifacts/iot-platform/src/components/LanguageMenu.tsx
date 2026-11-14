import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { LANGS, setLang, useLang, useT, type Lang } from "@/i18n";

/**
 * Language switch in the top bar, left of Appearance. English is the default.
 * The choice is remembered per browser. Data (project, asset and attribute
 * names, values) is never translated.
 */
export default function LanguageMenu() {
  const lang = useLang();
  const t = useT();
  const short = { en: "EN", ja: "日本", hi: "हि", te: "తె" }[lang];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={t("Language")}
          aria-label={t("Language")}
          data-testid="language-menu"
          className={cn(
            "flex items-center justify-center gap-1 h-8 px-2 rounded-md text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors",
          )}
        >
          <Languages className="w-4 h-4" />
          <span className="text-xs font-medium">{short}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">{t("Language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
          {LANGS.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code}>
              <span className="text-sm">{l.label}</span>
              {l.code !== "en" && <span className="ml-auto text-xs text-muted-foreground">{l.english}</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
