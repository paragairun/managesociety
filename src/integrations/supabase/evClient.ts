import { supabase } from "@/integrations/supabase/client";
import { makeEvDb } from "@/lib/evDb";

/**
 * The website's EV client.
 *
 * makeEvDb moved to taking its client as an argument so the native
 * resident app can share src/lib/evDb.ts through @core with its own
 * differently configured client. The website's binding lives here,
 * outside src/lib, where a runtime import of the browser client is
 * fine.
 */
export const evDb = makeEvDb(supabase);
