/**
 * Shown when a sidebar group header (Asset Hub, Data Studio, ...) is clicked.
 * The header opens its submenu; the main window is left empty until a page in
 * that group is chosen, so the Home project list appears only on Home.
 */
export default function SectionPlaceholder() {
  return <div className="h-full" />;
}
