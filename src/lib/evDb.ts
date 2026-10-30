/**
 * A typed door onto the ev_* tables.
 *
 * src/integrations/supabase/types.ts is generated from the database
 * schema and has not been regenerated since the EV tables were added,
 * so the client's `from()` overloads do not know ev_settings,
 * ev_chargers, ev_sessions or ev_credit_entries exist. Every query
 * against them is a type error even though it works at runtime.
 *
 * The cast lives here, once, rather than being repeated in each
 * component. The shape below is deliberately narrow — it describes
 * only the calls this module's callers actually make, so a typo in a
 * method name is still caught.
 *
 * It takes the client as an ARGUMENT rather than importing one. The
 * native resident app shares this file through @core and has its own
 * differently configured client (AsyncStorage rather than
 * localStorage); importing the website's would also be a runtime import
 * out of src/lib, which Metro cannot follow.
 *
 * REMOVE THIS once types.ts is regenerated:
 *   npx supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
 * then change `evDb` back to `supabase` and delete this file.
 */

type Row = Record<string, unknown>;
interface Result<T> { data: T | null; error: { message: string } | null }

interface Filter<T> extends PromiseLike<Result<T[]>> {
  eq(col: string, val: unknown): Filter<T>;
  neq(col: string, val: unknown): Filter<T>;
  in(col: string, vals: unknown[]): Filter<T>;
  is(col: string, val: unknown): Filter<T>;
  gte(col: string, val: unknown): Filter<T>;
  lte(col: string, val: unknown): Filter<T>;
  lt(col: string, val: unknown): Filter<T>;
  order(col: string, opts?: { ascending?: boolean }): Filter<T>;
  limit(n: number): Filter<T>;
  maybeSingle(): Promise<Result<T>>;
  single(): Promise<Result<T>>;
}

interface Table {
  select<T = Row>(cols?: string): Filter<T>;
  insert<T = Row>(row: Row | Row[]): Filter<T> & { select(cols?: string): Filter<T> };
  update<T = Row>(patch: Row): Filter<T>;
  delete<T = Row>(): Filter<T>;
}

export interface EvClient {
  from(table:
    | "ev_settings" | "ev_chargers" | "ev_chargers_public"
    | "ev_sessions" | "ev_credit_entries" | "ev_bank_messages"): Table;
  rpc<T = unknown>(fn: string, args?: Row): Promise<Result<T>>;
}

/** Views any Supabase client as one that knows the ev_* tables. */
export function makeEvDb(client: unknown): EvClient {
  return client as EvClient;
}
