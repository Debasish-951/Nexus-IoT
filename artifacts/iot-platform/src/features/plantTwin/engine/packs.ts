// Industry templates for 3D plant twins: Industry → process area → sub-process →
// machines. Data only; the layout is computed when a template is loaded.

/** [model, name, settings?, { feeds: area ids a utility supplies, med: what it carries }?] */
export type PackItem = [string, string, Record<string, any>?, { feeds: string[]; med: string }?];
export interface PackDef {
  name: string;
  areas: { id: string; name: string; out?: string; med?: string; util?: boolean; subs: { name: string; items: PackItem[] }[] }[];
  /** Material flow between areas; defaults to process order. */
  flows?: [string, string, string][];
}

export const PACKS: Record<string, PackDef> = {
  textile: { name: "Textile mill", areas: [
    { id: "spin", name: "Spinning", out: "Yarn", subs: [
      { name: "Blow room", items: [["blowroom", "BR-1"]] },
      { name: "Carding", items: [["carding", "CD-01"], ["carding", "CD-02"], ["carding", "CD-03"]] },
      { name: "Draw frame", items: [["drawframe", "DF-01"], ["drawframe", "DF-02"]] },
      { name: "Combing", items: [["comber", "CM-01"]] },
      { name: "Speed frame", items: [["speedframe", "SF-01"]] },
      { name: "Ring spinning", items: [["ringframe", "RF-01"], ["ringframe", "RF-02"]] },
      { name: "Winding", items: [["winder", "AC-01"]] }] },
    { id: "weave", name: "Weaving", out: "Grey fabric", subs: [
      { name: "Warping", items: [["warping", "WP-01"]] },
      { name: "Sizing", items: [["sizing", "SZ-01"]] },
      { name: "Weaving", items: [["loom", "LM-01"], ["loom", "LM-02"], ["loom", "LM-03"], ["loom", "LM-04"]] }] },
    { id: "wet", name: "Wet processing", out: "Finished fabric", subs: [
      { name: "Desize & bleach", items: [["sizing", "PT-01 Bleach range", { cylinders: 4 }]] },
      { name: "Dyeing", items: [["jetdyer", "JD-01"], ["jetdyer", "JD-02"]] },
      { name: "Printing", items: [["printer", "RP-01"]] },
      { name: "Finishing", items: [["stenter", "ST-01", { length: 14 }]] }] },
    { id: "garment", name: "Garmenting", out: "Garments", subs: [
      { name: "Cutting", items: [["cutting", "CT-01"]] },
      { name: "Sewing", items: [["sewing", "SL-01"], ["sewing", "SL-02"]] },
      { name: "Packing", items: [["conveyor", "PK-01", { length: 6, item: "Box" }]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Steam", items: [["boiler", "B-1", {}, { feeds: ["wet", "weave"], med: "steam" }]] },
      { name: "Compressed air", items: [["compressor", "AC-1", {}, { feeds: ["weave"], med: "air" }]] },
      { name: "Humidification", items: [["ahu", "AHU-1", { length: 5 }, { feeds: ["spin"], med: "water" }]] },
      { name: "Effluent treatment", items: [["aeration", "ETP-1", { length: 10, width: 5 }], ["clarifier", "CL-1", { dia: 8 }]] },
      { name: "Power", items: [["transformer", "TR-1", {}, { feeds: ["spin", "garment"], med: "power" }]] }] }] },
  steel: { name: "Integrated steel plant", areas: [
    { id: "raw", name: "Raw materials", out: "Ore, coal, flux", subs: [
      { name: "Stockyard", items: [["conveyor", "BC-01", { length: 10, item: "Bulk", width: 1.2 }]] },
      { name: "Crushing", items: [["crusher", "CR-01"]] }] },
    { id: "iron", name: "Ironmaking", out: "Hot metal", subs: [
      { name: "Coke making", items: [["cokeoven", "CO-1", { ovens: 32 }]] },
      { name: "Sintering", items: [["sinter", "SP-1", { length: 16 }]] },
      { name: "Hot blast", items: [["stove", "HS-1"]] },
      { name: "Blast furnace", items: [["blastfurnace", "BF-1"]] }] },
    { id: "steel", name: "Steelmaking", out: "Liquid steel", subs: [
      { name: "Converter", items: [["converter", "BOF-1"]] },
      { name: "Electric arc", items: [["eaf", "EAF-1"]] },
      { name: "Secondary metallurgy", items: [["ladlefurnace", "LF-1"]] }] },
    { id: "cast", name: "Continuous casting", out: "Slabs", subs: [
      { name: "Caster", items: [["caster", "CC-1"]] }] },
    { id: "roll", name: "Hot rolling", out: "Hot-rolled coils", subs: [
      { name: "Reheating", items: [["zoned", "RF-1", { kind: "Reheat furnace", length: 12, zones: 5, width: 3 }]] },
      { name: "Roughing", items: [["rollstand", "RM-1", { stands: 2 }]] },
      { name: "Finishing", items: [["rollstand", "FM-1", { stands: 6 }]] },
      { name: "Coiling", items: [["coiler", "DC-1"]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Oxygen plant", items: [["column", "ASU-1", { height: 22, dia: 2.2, trays: 30 }, { feeds: ["steel"], med: "gas" }]] },
      { name: "Cooling water", items: [["coolingtower", "CT-1", { cells: 3 }, { feeds: ["cast", "roll"], med: "water" }]] },
      { name: "Power", items: [["transformer", "TR-1", { rating: "5 MVA" }, { feeds: ["steel"], med: "power" }]] },
      { name: "Water treatment", items: [["clarifier", "CL-1", { dia: 12 }]] }] }] },
  oilgas: { name: "Oil & gas (upstream)", areas: [
    { id: "wells", name: "Wells & gathering", out: "Well fluid", med: "oil", subs: [
      { name: "Wellheads", items: [["wellhead", "WH-1"], ["wellhead", "WH-2"], ["wellhead", "WH-3"], ["wellhead", "WH-4"]] },
      { name: "Production manifold", items: [["manifold", "MF-1", { inlets: 4 }]] }] },
    { id: "sep", name: "Separation", out: "Oil, gas, water", med: "oil", subs: [
      { name: "Three-phase separator", items: [["htank", "V-100 Separator", { length: 8, dia: 2.4, boot: "Boot", product: "Oil" }]] },
      { name: "Heater treater", items: [["heater", "H-100", { size: 0.8 }]] }] },
    { id: "gas", name: "Gas processing", out: "Sales gas", med: "gas", subs: [
      { name: "Compression", items: [["compressor", "K-100", { size: 1.3 }], ["compressor", "K-101", { size: 1.3 }]] },
      { name: "Dehydration", items: [["column", "C-200 Glycol contactor", { height: 10, dia: 1.2, trays: 10 }]] },
      { name: "Flare", items: [["flare", "FL-1"]] }] },
    { id: "water", name: "Produced water", out: "Treated water", med: "water", subs: [
      { name: "Skimming", items: [["htank", "V-300 Skimmer", { length: 5, dia: 1.8, product: "Water" }]] },
      { name: "Injection", items: [["pump", "P-300"]] }] },
    { id: "export", name: "Storage & export", out: "Crude to pipeline", med: "oil", subs: [
      { name: "Storage", items: [["vtank", "T-100", { height: 7, dia: 6, roof: "Floating", product: "Oil" }], ["vtank", "T-101", { height: 7, dia: 6, roof: "Floating", product: "Oil" }]] },
      { name: "Export pumps", items: [["pump", "P-100"], ["pump", "P-101"]] },
      { name: "Fiscal metering", items: [["meter", "FM-100"]] },
      { name: "Pipeline", items: [["pipeline", "PL-1"]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Power", items: [["genset", "DG-1", {}, { feeds: ["gas", "export"], med: "power" }]] },
      { name: "Instrument air", items: [["compressor", "IA-1", { size: 0.8 }, { feeds: ["sep"], med: "air" }]] }] }],
    flows: [["wells", "sep", "Well fluid"], ["sep", "gas", "Gas"], ["sep", "water", "Water"], ["sep", "export", "Oil"]] },
  refinery: { name: "Refinery", areas: [
    { id: "crude", name: "Crude unit", out: "Straight-run cuts", med: "oil", subs: [
      { name: "Desalting", items: [["htank", "D-101 Desalter", { length: 8, dia: 2.6, product: "Oil" }]] },
      { name: "Crude heater", items: [["heater", "H-101"]] },
      { name: "Atmospheric distillation", items: [["column", "C-101 CDU", { height: 26, dia: 2.6, trays: 36 }]] }] },
    { id: "vac", name: "Vacuum unit", out: "Gas oil, residue", med: "oil", subs: [
      { name: "Vacuum heater", items: [["heater", "H-201", { size: 0.9 }]] },
      { name: "Vacuum distillation", items: [["column", "C-201 VDU", { height: 18, dia: 3.2, trays: 16 }]] }] },
    { id: "conv", name: "Conversion", out: "Gasoline, diesel", med: "oil", subs: [
      { name: "Hydrotreating", items: [["heater", "H-301", { size: 0.8 }], ["reactor", "R-301", { size: 2, product: "Oil" }]] },
      { name: "Catalytic cracking", items: [["reactor", "R-401 Riser", { size: 2.4, product: "Oil" }], ["vtank", "V-401 Regenerator", { height: 9, dia: 5, roof: "Dome", product: "Product" }]] },
      { name: "Reforming", items: [["heater", "H-501", { size: 0.8 }], ["reactor", "R-501", { size: 1.8, product: "Oil" }]] }] },
    { id: "blend", name: "Blending & storage", out: "Fuels", med: "oil", subs: [
      { name: "Blending", items: [["manifold", "BL-1", { inlets: 6 }]] },
      { name: "Product tanks", items: [["vtank", "TK-1", { height: 7, dia: 5, product: "Oil" }], ["vtank", "TK-2", { height: 7, dia: 5, roof: "Floating", product: "Oil" }], ["sphere", "SP-1 LPG", { dia: 7 }]] },
      { name: "Truck loading", items: [["meter", "LM-1"]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Steam", items: [["boiler", "B-1", {}, { feeds: ["crude", "conv"], med: "steam" }]] },
      { name: "Cooling water", items: [["coolingtower", "CT-1", { cells: 4 }, { feeds: ["crude", "vac"], med: "water" }]] },
      { name: "Flare", items: [["flare", "FL-1", { height: 30 }]] },
      { name: "Effluent", items: [["aeration", "ETP-1"]] }] }] },
  cement: { name: "Cement plant", areas: [
    { id: "crush", name: "Crushing", out: "Crushed limestone", subs: [
      { name: "Crusher", items: [["crusher", "CR-1"]] },
      { name: "Belt conveyor", items: [["conveyor", "BC-1", { length: 8, item: "Bulk" }]] }] },
    { id: "raw", name: "Raw milling", out: "Raw meal", subs: [
      { name: "Raw mill", items: [["mill", "RM-1", { length: 6, dia: 3.6 }]] },
      { name: "Elevator", items: [["bucket", "BE-1", { height: 16 }]] },
      { name: "Homogenising silo", items: [["silo", "SL-1", { height: 12, dia: 5 }]] }] },
    { id: "pyro", name: "Pyroprocessing", out: "Clinker", subs: [
      { name: "Preheater", items: [["preheater", "PH-1"]] },
      { name: "Rotary kiln", items: [["kiln", "KL-1", { length: 16 }]] },
      { name: "Clinker cooler", items: [["zoned", "CL-1 Grate cooler", { kind: "Cooler", length: 6, zones: 3, width: 2.4 }]] }] },
    { id: "grind", name: "Cement grinding", out: "Cement", subs: [
      { name: "Cement mill", items: [["mill", "CM-1", { length: 7 }]] },
      { name: "Cement silo", items: [["silo", "SL-2", { height: 14, dia: 5 }]] }] },
    { id: "pack", name: "Packing & dispatch", out: "Bags", subs: [
      { name: "Packing", items: [["packer", "PK-1"]] },
      { name: "Truck loading", items: [["conveyor", "BC-2", { length: 6, item: "Bag" }]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Coal mill", items: [["mill", "CM-2 Coal mill", { length: 4, dia: 2.6 }, { feeds: ["pyro"], med: "product" }]] },
      { name: "Power", items: [["transformer", "TR-1", { rating: "5 MVA" }, { feeds: ["raw", "grind"], med: "power" }]] },
      { name: "Compressed air", items: [["compressor", "AC-1", {}, { feeds: ["pack"], med: "air" }]] }] }] },
  chemical: { name: "Chemical plant", areas: [
    { id: "feed", name: "Raw material storage", out: "Feedstock", subs: [
      { name: "Tanks", items: [["vtank", "T-101", { height: 6, dia: 3, product: "Chemical" }], ["vtank", "T-102", { height: 5, dia: 2.5, roof: "Dome", product: "Water" }]] },
      { name: "Transfer", items: [["pump", "P-101"]] }] },
    { id: "react", name: "Reaction", out: "Crude product", subs: [
      { name: "Reactors", items: [["reactor", "R-101", { size: 1.6 }], ["reactor", "R-102", { size: 1.6 }]] },
      { name: "Heat removal", items: [["hx", "E-101"]] }] },
    { id: "sep", name: "Separation", out: "Pure product", subs: [
      { name: "Distillation", items: [["column", "C-201"]] },
      { name: "Bottoms pump", items: [["pump", "P-201"]] }] },
    { id: "store", name: "Product storage", out: "Product", subs: [
      { name: "Tanks", items: [["vtank", "T-201", { height: 5, dia: 3, product: "Chemical" }], ["vtank", "T-202", { height: 5, dia: 3, product: "Chemical" }]] },
      { name: "Loading", items: [["meter", "LM-1", { runs: 1 }]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Steam", items: [["boiler", "B-1", {}, { feeds: ["react"], med: "steam" }]] },
      { name: "Cooling water", items: [["coolingtower", "CT-1", {}, { feeds: ["react", "sep"], med: "water" }]] },
      { name: "Effluent treatment", items: [["aeration", "AT-1", { length: 10, width: 5 }], ["clarifier", "CL-1", { dia: 8 }]] }] }] },
  pharma: { name: "Pharma (oral solid dose)", areas: [
    { id: "disp", name: "Dispensing", out: "Weighed materials", subs: [
      { name: "Dispensing booth", items: [["generic", "DB-1 Dispensing booth", { width: 3, height: 2.5, depth: 2 }]] }] },
    { id: "gran", name: "Granulation", out: "Dried granules", subs: [
      { name: "Wet granulation", items: [["granulator", "HSG-1"]] },
      { name: "Drying", items: [["fbd", "FBD-1"]] },
      { name: "Blending", items: [["generic", "BL-1 Bin blender", { width: 1.5, height: 2, depth: 1.5 }]] }] },
    { id: "comp", name: "Compression", out: "Tablets", subs: [
      { name: "Tablet presses", items: [["tabletpress", "TP-1"], ["tabletpress", "TP-2"]] }] },
    { id: "coat", name: "Coating", out: "Coated tablets", subs: [
      { name: "Coating", items: [["coater", "CO-1"]] }] },
    { id: "pack", name: "Packing", out: "Cartons", subs: [
      { name: "Blister packing", items: [["blister", "BP-1"]] },
      { name: "Cartoning", items: [["conveyor", "CN-1", { length: 5, item: "Box" }]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Purified water", items: [["vtank", "PW-1", { height: 4, dia: 2, roof: "Dome", product: "Water" }, { feeds: ["gran"], med: "water" }]] },
      { name: "Clean-room HVAC", items: [["ahu", "AHU-1", { length: 6 }, { feeds: ["comp", "coat"], med: "air" }]] },
      { name: "Steam", items: [["boiler", "B-1", { size: 0.8 }, { feeds: ["coat"], med: "steam" }]] },
      { name: "Cold store", items: [["coldroom", "CS-1", { mode: "Chilled 4 °C", width: 5, depth: 4 }]] }] }] },
  cold: { name: "Cold chain", areas: [
    { id: "recv", name: "Receiving", out: "Pallets", subs: [{ name: "Inbound dock", items: [["conveyor", "BC-1", { length: 6, item: "Box" }]] }] },
    { id: "freeze", name: "Freezing", out: "Frozen product", subs: [{ name: "Blast freezer", items: [["coldroom", "BF-1", { width: 5, depth: 5 }]] }] },
    { id: "store", name: "Storage", out: "Stored product", subs: [
      { name: "Frozen stores", items: [["coldroom", "CS-1", { width: 7, depth: 6 }], ["coldroom", "CS-2", { width: 7, depth: 6 }]] },
      { name: "Chilled store", items: [["coldroom", "CS-3", { width: 6, depth: 6, mode: "Chilled 4 °C" }]] }] },
    { id: "disp", name: "Dispatch", out: "Orders", subs: [{ name: "Outbound dock", items: [["conveyor", "BC-2", { length: 6, item: "Box" }]] }] },
    { id: "util", name: "Refrigeration plant", util: true, subs: [
      { name: "Compressors", items: [["compressor", "K-1", {}, { feeds: ["freeze", "store"], med: "refrigerant" }], ["compressor", "K-2"]] },
      { name: "Receiver", items: [["htank", "V-1 NH₃ receiver", { length: 5, dia: 1.4 }]] },
      { name: "Condenser", items: [["coolingtower", "EC-1", { cells: 2 }]] },
      { name: "Standby power", items: [["genset", "DG-1", { rating: "500 kVA" }]] }] }] },
  energy: { name: "Power & energy", areas: [
    { id: "gen", name: "Generation", out: "Power", med: "power", subs: [
      { name: "Solar", items: [["solar", "PV-1", { rows: 4, panels: 10 }]] },
      { name: "Gensets", items: [["genset", "DG-1"], ["genset", "DG-2"], ["genset", "DG-3"]] }] },
    { id: "trans", name: "Transformation", out: "11 kV / 415 V", med: "power", subs: [{ name: "Transformers", items: [["transformer", "TR-1"], ["transformer", "TR-2"]] }] },
    { id: "dist", name: "Distribution", out: "Feeders", med: "power", subs: [
      { name: "HT switchgear", items: [["panel", "HT-1", { cabinets: 5 }]] },
      { name: "LT switchgear", items: [["panel", "LT-1", { cabinets: 8 }]] },
      { name: "Motor control", items: [["panel", "MCC-1", { cabinets: 6, kind: "MCC" }]] }] },
    { id: "store", name: "Energy storage", out: "Backup power", med: "power", subs: [{ name: "Battery / UPS", items: [["battery", "UPS-1", { racks: 4 }], ["battery", "BESS-1", { racks: 6 }]] }] }],
    flows: [["gen", "trans", "Power"], ["trans", "dist", "11 kV / 415 V"], ["store", "dist", "Backup"]] },
  datacenter: { name: "Data center", areas: [
    { id: "power", name: "Power path", out: "Clean power", med: "power", subs: [
      { name: "Utility intake", items: [["transformer", "TR-1"]] },
      { name: "Backup generation", items: [["genset", "DG-1", { rating: "2000 kVA" }], ["genset", "DG-2", { rating: "2000 kVA" }]] },
      { name: "Switchgear", items: [["panel", "SWG-1", { cabinets: 6 }]] },
      { name: "UPS", items: [["battery", "UPS-1", { racks: 4 }]] }] },
    { id: "white", name: "White space", out: "IT load", med: "power", subs: [
      { name: "Rack rows", items: [["panel", "Row A", { cabinets: 10, kind: "Server racks" }], ["panel", "Row B", { cabinets: 10, kind: "Server racks" }], ["panel", "Row C", { cabinets: 10, kind: "Server racks" }]] },
      { name: "Precision cooling", items: [["ahu", "CRAH-1", { length: 4 }], ["ahu", "CRAH-2", { length: 4 }]] }] },
    { id: "cool", name: "Cooling plant", out: "Chilled water", med: "water", subs: [
      { name: "Chillers", items: [["chiller", "CH-1", { fans: 5 }], ["chiller", "CH-2", { fans: 5 }]] },
      { name: "Cooling towers", items: [["coolingtower", "CT-1", { cells: 3 }]] }] }],
    flows: [["power", "white", "Clean power"], ["cool", "white", "Chilled water"]] },
  glass: { name: "Glass & plastics", areas: [
    { id: "batch", name: "Batch house", out: "Batch", subs: [
      { name: "Raw material silos", items: [["silo", "SL-1 Sand", { height: 10, dia: 3, material: "Grain" }], ["silo", "SL-2 Soda ash", { height: 10, dia: 3, material: "Plastic pellets" }]] },
      { name: "Batch conveyor", items: [["conveyor", "BC-1", { length: 8, item: "Bulk" }]] }] },
    { id: "melt", name: "Melting", out: "Molten glass", subs: [{ name: "Furnace", items: [["zoned", "F-1 Melting furnace", { kind: "Furnace", length: 6, zones: 3, width: 3 }]] }] },
    { id: "form", name: "Forming & annealing", out: "Bottles", subs: [
      { name: "IS machine", items: [["generic", "IS-1 Forming machine", { width: 3, height: 2.5, depth: 2, colour: "Blue" }]] },
      { name: "Annealing lehr", items: [["zoned", "LH-1", { kind: "Annealing lehr", length: 14, zones: 7, width: 2 }]] },
      { name: "Inspection", items: [["conveyor", "BC-2", { length: 6, item: "Bottle" }]] }] },
    { id: "plast", name: "Plastics extrusion", out: "Pipes & profiles", subs: [{ name: "Extruders", items: [["extruder", "EX-1"], ["extruder", "EX-2", { zones: 4, length: 4 }]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Process cooling", items: [["chiller", "CH-1", {}, { feeds: ["plast"], med: "water" }], ["coolingtower", "CT-1", { cells: 1 }]] },
      { name: "Compressed air", items: [["compressor", "AC-1", {}, { feeds: ["form"], med: "air" }]] }] }],
    flows: [["batch", "melt", "Batch"], ["melt", "form", "Molten glass"]] },
  tankfarm: { name: "Tank farm & terminal", areas: [
    { id: "receipt", name: "Receipt", out: "Crude & products", med: "oil", subs: [
      { name: "Incoming pipeline", items: [["pipeline", "PL-1", { length: 12 }]] },
      { name: "Receipt metering", items: [["meter", "FM-1"]] }] },
    { id: "store", name: "Storage", out: "Stored product", med: "oil", subs: [
      { name: "Floating-roof tanks", items: [["vtank", "TK-101", { height: 7, dia: 6, roof: "Floating", product: "Oil" }], ["vtank", "TK-102", { height: 7, dia: 6, roof: "Floating", product: "Oil" }]] },
      { name: "Fixed-roof tanks", items: [["vtank", "TK-201", { height: 6, dia: 4, product: "Chemical" }], ["vtank", "TK-202", { height: 6, dia: 4, product: "Chemical" }]] },
      { name: "LPG spheres", items: [["sphere", "SP-1", { dia: 7 }], ["sphere", "SP-2", { dia: 7 }]] }] },
    { id: "transfer", name: "Transfer", out: "Product to loading", med: "oil", subs: [
      { name: "Transfer manifold", items: [["manifold", "MF-1", { inlets: 6 }]] },
      { name: "Transfer pumps", items: [["pump", "P-101"], ["pump", "P-102"], ["pump", "P-103"]] }] },
    { id: "load", name: "Loading", out: "Trucks & ships", med: "oil", subs: [{ name: "Loading meters", items: [["meter", "LM-1"], ["meter", "LM-2"]] }] },
    { id: "util", name: "Utilities", util: true, subs: [
      { name: "Fire water", items: [["vtank", "FWT-1 Fire water", { height: 6, dia: 5, roof: "Dome", product: "Water" }], ["pump", "FWP-1", {}, { feeds: ["store"], med: "water" }]] },
      { name: "Vapour recovery", items: [["compressor", "VRU-1", {}, { feeds: ["load"], med: "gas" }]] }] }] },
  water: { name: "Water & effluent treatment", areas: [
    { id: "intake", name: "Intake & screening", out: "Raw water", med: "water", subs: [
      { name: "Intake pumps", items: [["pump", "P-101"], ["pump", "P-102"]] },
      { name: "Screening", items: [["generic", "SC-1 Screen", { width: 2, height: 1.5, depth: 3 }]] }] },
    { id: "primary", name: "Primary treatment", out: "Settled water", med: "water", subs: [
      { name: "Equalisation", items: [["vtank", "EQ-1", { height: 4, dia: 6, roof: "Dome", product: "Water" }]] },
      { name: "Primary clarifier", items: [["clarifier", "CL-1", { dia: 12 }]] }] },
    { id: "bio", name: "Biological treatment", out: "Treated water", med: "water", subs: [
      { name: "Aeration", items: [["aeration", "AT-1"], ["aeration", "AT-2"]] },
      { name: "Secondary clarifier", items: [["clarifier", "CL-2", { dia: 12 }]] }] },
    { id: "tert", name: "Tertiary & reuse", out: "Reuse water", med: "water", subs: [
      { name: "Filtration", items: [["vtank", "SF-1 Sand filter", { height: 3, dia: 2.5, roof: "Dome", product: "Water" }], ["vtank", "SF-2 Sand filter", { height: 3, dia: 2.5, roof: "Dome", product: "Water" }]] },
      { name: "Treated water", items: [["vtank", "TW-1", { height: 5, dia: 5, product: "Water" }]] }] },
    { id: "util", name: "Sludge & utilities", util: true, subs: [
      { name: "Blowers", items: [["compressor", "BL-1 Air blower", {}, { feeds: ["bio"], med: "air" }]] },
      { name: "Sludge dewatering", items: [["generic", "FP-1 Filter press", { width: 4, height: 2, depth: 1.6, colour: "Blue" }]] }] }] },
};
export const MED: Record<string, { c: number; n: string }> = { product: { c: 0x38bdf8, n: "Product" }, water: { c: 0x60a5fa, n: "Water" }, steam: { c: 0xe2e8f0, n: "Steam" }, oil: { c: 0xf59e0b, n: "Oil" }, gas: { c: 0xa3e635, n: "Gas" }, refrigerant: { c: 0x67e8f9, n: "Refrigerant" }, air: { c: 0xc4b5fd, n: "Compressed air" }, power: { c: 0xfacc15, n: "Power cable" } };
export const AREA_COL = [0x3b82f6, 0x22c55e, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16, 0xf97316];
export const UTIL_COL = 0x94a3b8;
