import { Card } from "@/components/ui/card";
import PlantTwinView from "./PlantTwinView";
import { TagTwinView } from "./tagTwin/TagTwinView";
import { MachineStage } from "./tagTwin/MachineStage";
import { ProcessStage } from "./tagTwin/ProcessStage";
import { MACHINE_KEYS, PROCESS_KEYS } from "./tagTwin/tags";
import type { TwinLink } from "./twinLink";

/** `asset`: machines from the library on a free canvas. `machine`: the detailed pump skid. */
export type Twin3DTab = "machine" | "process" | "floor" | "builder" | "asset";

/**
 * The 3D views of Live Twin, in one lazily loaded module so three.js is fetched
 * once, the first time any of them opens.
 */
export default function LiveTwin3D({ tab, onTab, link, onDetailedSkid }: {
  tab: Twin3DTab; onTab: (t: Twin3DTab) => void; link?: TwinLink; onDetailedSkid?: () => void;
}) {
  return (
    <Card className="flex-1 min-h-0 overflow-hidden shadow-sm flex flex-col">
      {tab === "machine" && <TagTwinView key="machine" kind="machine" keys={MACHINE_KEYS} Stage={MachineStage} link={link} />}
      {tab === "process" && <TagTwinView key="process" kind="process" keys={PROCESS_KEYS} Stage={ProcessStage} demoValve link={link} />}
      {tab === "floor" && <PlantTwinView key="floor" variant="floor" onOpenBuilder={() => onTab("builder")} link={link} />}
      {tab === "builder" && <PlantTwinView key="builder" variant="builder" link={link} />}
      {tab === "asset" && <PlantTwinView key="asset" variant="builder" twinKind="asset" link={link} onDetailedSkid={onDetailedSkid} />}
    </Card>
  );
}
