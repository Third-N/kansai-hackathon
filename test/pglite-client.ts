import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Channel, ChangeFilter, Filter, Many, Mutation, One, Row, Scalar, SupabaseLike, Table,
} from "../lib/supabase-like";

/* ============================================================
   SupabaseLike を PGlite（WASM の PostgreSQL）にかぶせたもの。

   これは「Supabase のふりをする作り物」ではなく、
   supabase/migrations の SQL を本物の PostgreSQL に流して、
   本物の RLS と本物の RPC を相手にテストするための土台。
   つまり契約テストは、テーブル定義・権限・関数まで含めて検証している。

   再現できないのは Realtime だけ。だから store 側は必ず
   ポーリングの保険を持たせてあり、テストはそちらの経路を通る。
   ============================================================ */

type Cond = { col: string; op: "eq" | "neq" | "in"; val: Scalar | Scalar[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** JS の値を Postgres のパラメータに落とす。jsonb と text[] だけ明示的に寄せる */
function bind(value: unknown, params: unknown[]): string {
  if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
    params.push(`{${(value as string[]).map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`);
    return `$${params.length}::text[]`;
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    params.push(JSON.stringify(value));
    return `$${params.length}::jsonb`;
  }
  params.push(value);
  return `$${params.length}`;
}

class Q<T> implements Filter<T>, Mutation<T> {
  private conds: Cond[] = [];
  private ord: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;

  constructor(
    private db: PGlite,
    private table: string,
    private kind: "select" | "insert" | "update",
    private payload?: Row | Row[]
  ) {}

  eq(col: string, val: Scalar) { this.conds.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: Scalar) { this.conds.push({ col, op: "neq", val }); return this; }
  in(col: string, vals: Scalar[]) { this.conds.push({ col, op: "in", val: vals }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  /** insert().select() / update().select() のための素通し */
  select(): Filter<T> { return this as unknown as Filter<T>; }

  private where(params: unknown[]): string {
    if (this.conds.length === 0) return "";
    const parts = this.conds.map((c) => {
      if (c.op === "in") {
        const vals = c.val as Scalar[];
        if (vals.length === 0) return "false";
        return `"${c.col}" in (${vals.map((v) => bind(v, params)).join(",")})`;
      }
      return `"${c.col}" ${c.op === "eq" ? "=" : "<>"} ${bind(c.val, params)}`;
    });
    return ` where ${parts.join(" and ")}`;
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    if (this.kind === "select") {
      let sql = `select * from "${this.table}"${this.where(params)}`;
      if (this.ord) sql += ` order by "${this.ord.col}" ${this.ord.asc ? "asc" : "desc"}`;
      if (this.lim !== null) sql += ` limit ${this.lim}`;
      return { sql, params };
    }
    if (this.kind === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[];
      const cols = Object.keys(rows[0]);
      const groups = rows
        .map((r) => `(${cols.map((c) => bind(r[c], params)).join(",")})`)
        .join(",");
      const colList = cols.map((c) => `"${c}"`).join(",");
      return { sql: `insert into "${this.table}" (${colList}) values ${groups} returning *`, params };
    }
    const values = this.payload as Row;
    const sets = Object.keys(values).map((c) => `"${c}" = ${bind(values[c], params)}`).join(", ");
    return { sql: `update "${this.table}" set ${sets}${this.where(params)} returning *`, params };
  }

  private async run(): Promise<Many<T>> {
    const { sql, params } = this.build();
    try {
      const res = await this.db.query<T>(sql, params as never[]);
      return { data: res.rows, error: null };
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { data: null, error: { message: err.message ?? String(e), code: err.code } };
    }
  }

  then<R1 = Many<T>, R2 = never>(
    onOk?: ((v: Many<T>) => R1 | PromiseLike<R1>) | null,
    onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onOk, onErr);
  }

  async maybeSingle(): Promise<One<T>> {
    const r = await this.run();
    if (r.error) return { data: null, error: r.error };
    return { data: r.data?.[0] ?? null, error: null };
  }

  async single(): Promise<One<T>> {
    const r = await this.run();
    if (r.error) return { data: null, error: r.error };
    if (!r.data || r.data.length === 0) {
      return { data: null, error: { message: "行が返らなかった", code: "PGRST116" } };
    }
    return { data: r.data[0], error: null };
  }
}

const noopChannel: Channel = {
  on(_type: "postgres_changes", _f: ChangeFilter, _cb: (p: never) => void) { return noopChannel; },
  subscribe() { return noopChannel; },
};

export interface PgliteBackend extends SupabaseLike {
  /** 直に SQL を打つ。テストの中で「本来クライアントから見えないもの」を確かめるのに使う */
  raw: PGlite;
  close(): Promise<void>;
}

export async function createPgliteBackend(migrationsDir = "supabase/migrations"): Promise<PgliteBackend> {
  const db = await new PGlite();

  // Supabase には既にあるロール。ここでは自分で作る
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
  `);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
  }

  return {
    raw: db,
    from<T = Row>(table: string): Table<T> {
      return {
        select: () => new Q<T>(db, table, "select") as unknown as Filter<T>,
        insert: (rows) => new Q<T>(db, table, "insert", rows) as unknown as Mutation<T>,
        update: (values) => new Q<T>(db, table, "update", values) as unknown as Mutation<T>,
      };
    },
    async rpc<T = unknown>(fn: string, args: Row = {}): Promise<One<T>> {
      const params: unknown[] = [];
      const named = Object.keys(args).map((k) => `${k} => ${bind(args[k], params)}`).join(", ");
      // PostgREST と同じく、合成型でもスカラーでも JSON にして返す
      const sql = `select to_jsonb(${fn}(${named})) as r`;
      try {
        const res = await db.query<{ r: T | null }>(sql, params as never[]);
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) {
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? String(e), code: err.code } };
      }
    },
    channel: () => noopChannel,
    removeChannel: () => {},
    async close() { await db.close(); },
  };
}
