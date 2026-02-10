import { Type } from "@sinclair/typebox";

export const kotaIndexSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Repo root (defaults to detected repo root)" })),
});

export const kotaSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  output: Type.Optional(
    Type.Union([Type.Literal("paths"), Type.Literal("compact"), Type.Literal("snippet")]),
  ),
});

export const kotaDepsSchema = Type.Object({
  file_path: Type.String({ description: "Repo-relative file path" }),
  direction: Type.Optional(
    Type.Union([Type.Literal("dependencies"), Type.Literal("dependents"), Type.Literal("both")]),
  ),
  depth: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
  include_tests: Type.Optional(Type.Boolean()),
});

export const kotaUsagesSchema = Type.Object({
  symbol: Type.String(),
  file: Type.Optional(Type.String()),
  include_tests: Type.Optional(Type.Boolean()),
});

export const kotaImpactSchema = Type.Object({
  change_type: Type.Union([
    Type.Literal("feature"),
    Type.Literal("refactor"),
    Type.Literal("fix"),
    Type.Literal("chore"),
  ]),
  description: Type.String(),
  files_to_modify: Type.Optional(Type.Array(Type.String())),
  files_to_create: Type.Optional(Type.Array(Type.String())),
  files_to_delete: Type.Optional(Type.Array(Type.String())),
});

export const kotaTaskContextSchema = Type.Object({
  files: Type.Array(Type.String()),
  include_tests: Type.Optional(Type.Boolean()),
  include_symbols: Type.Optional(Type.Boolean()),
  max_impacted_files: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});
