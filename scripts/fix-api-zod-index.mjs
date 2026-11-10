// Orval's split mode rewrites lib/api-zod/src/index.ts to also export
// "./generated/api.schemas", which does not exist for the zod client and breaks
// the build. The file must contain only the single export below (see CLAUDE.md).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../lib/api-zod/src/index.ts", import.meta.url));
writeFileSync(target, 'export * from "./generated/api";\n');
