/**
 * The generated Supabase schema types, re-exported from the website's
 * copy rather than duplicated.
 *
 * They are generated output (npx supabase gen types ...), so a second
 * copy here would be stale the first time anyone regenerated them —
 * and a stale type against a live schema is worse than no type.
 *
 * Regenerate at the repo root, and this app picks it up:
 *   npx supabase gen types typescript --project-id lfmwrdtzyuveyvkfbsjn \
 *     > src/integrations/supabase/types.ts
 */
export type { Database, Tables, Enums, TablesInsert, TablesUpdate } from "../../../../src/integrations/supabase/types";
