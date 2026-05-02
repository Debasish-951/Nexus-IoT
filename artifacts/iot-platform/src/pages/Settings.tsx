import { Settings as SettingsIcon, Construction } from "lucide-react";

export default function Settings() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <SettingsIcon className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">Platform configuration and advanced settings</p>
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Construction className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">This section is under construction</p>
        <p className="text-xs mt-1">Coming in the next release</p>
      </div>
    </div>
  );
}
