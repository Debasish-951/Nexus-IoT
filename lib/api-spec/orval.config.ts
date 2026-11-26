import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// zod 4's `z.uuid()` (what Orval emits for `format: uuid`) enforces the RFC 9562
// version and variant bits. Ids the platform already uses do not all have them —
// the seed's fixed ids such as 00000011-0000-0000-0000-000000000001, and any
// row created with them — and zod 3's `.uuid()` accepted any 8-4-4-4-12 hex
// string. For the zod output only, `format: uuid` is therefore turned into the
// same pattern zod 4 uses for `z.guid()`, which keeps the zod 3 behaviour. The
// spec and the react-query client keep `format: uuid`.
const GUID_PATTERN =
  "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$";

const uuidAsGuid = (node: unknown): void => {
  if (Array.isArray(node)) {
    node.forEach(uuidAsGuid);
    return;
  }
  if (!node || typeof node !== "object") return;
  const schema = node as Record<string, unknown>;
  if (schema.format === "uuid" && typeof schema.pattern !== "string") {
    delete schema.format;
    schema.pattern = GUID_PATTERN;
  }
  Object.values(schema).forEach(uuidAsGuid);
};

const zodTransformer: InputTransformerFn = (config) => {
  const copy = structuredClone(titleTransformer(config));
  uuidAsGuid(copy);
  return copy;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        // The workspace uses TanStack Query 5. Orval cannot always detect it and
        // otherwise generates hooks for v4.
        query: { version: 5 },
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: zodTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          // The workspace uses zod 4 (catalog in pnpm-workspace.yaml). Pinned
          // explicitly so the output matches the installed zod, not whatever Orval
          // detects.
          version: 4,
          coerce: {
            // Query params always arrive as strings — a date-time query param (e.g.
            // /telemetry/:assetId?from=&to=) needs `date` coerced here too, or it comes
            // out as `zod.date()`, which rejects every string and 400s the endpoint.
            query: ['boolean', 'number', 'string', 'date'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
