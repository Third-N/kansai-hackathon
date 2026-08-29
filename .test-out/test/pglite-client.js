import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}
/** JS の値を Postgres のパラメータに落とす。jsonb と text[] だけ明示的に寄せる */
function bind(value, params) {
    if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
        params.push(`{${value.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")}}`);
        return `$${params.length}::text[]`;
    }
    if (Array.isArray(value) || isPlainObject(value)) {
        params.push(JSON.stringify(value));
        return `$${params.length}::jsonb`;
    }
    params.push(value);
    return `$${params.length}`;
}
class Q {
    db;
    table;
    kind;
    payload;
    conds = [];
    ord = null;
    lim = null;
    constructor(db, table, kind, payload) {
        this.db = db;
        this.table = table;
        this.kind = kind;
        this.payload = payload;
    }
    eq(col, val) { this.conds.push({ col, op: "eq", val }); return this; }
    neq(col, val) { this.conds.push({ col, op: "neq", val }); return this; }
    in(col, vals) { this.conds.push({ col, op: "in", val: vals }); return this; }
    order(col, o) { this.ord = { col, asc: o?.ascending !== false }; return this; }
    limit(n) { this.lim = n; return this; }
    /** insert().select() / update().select() のための素通し */
    select() { return this; }
    where(params) {
        if (this.conds.length === 0)
            return "";
        const parts = this.conds.map((c) => {
            if (c.op === "in") {
                const vals = c.val;
                if (vals.length === 0)
                    return "false";
                return `"${c.col}" in (${vals.map((v) => bind(v, params)).join(",")})`;
            }
            return `"${c.col}" ${c.op === "eq" ? "=" : "<>"} ${bind(c.val, params)}`;
        });
        return ` where ${parts.join(" and ")}`;
    }
    build() {
        const params = [];
        if (this.kind === "select") {
            let sql = `select * from "${this.table}"${this.where(params)}`;
            if (this.ord)
                sql += ` order by "${this.ord.col}" ${this.ord.asc ? "asc" : "desc"}`;
            if (this.lim !== null)
                sql += ` limit ${this.lim}`;
            return { sql, params };
        }
        if (this.kind === "insert") {
            const rows = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]);
            const cols = Object.keys(rows[0]);
            const groups = rows
                .map((r) => `(${cols.map((c) => bind(r[c], params)).join(",")})`)
                .join(",");
            const colList = cols.map((c) => `"${c}"`).join(",");
            return { sql: `insert into "${this.table}" (${colList}) values ${groups} returning *`, params };
        }
        const values = this.payload;
        const sets = Object.keys(values).map((c) => `"${c}" = ${bind(values[c], params)}`).join(", ");
        return { sql: `update "${this.table}" set ${sets}${this.where(params)} returning *`, params };
    }
    async run() {
        const { sql, params } = this.build();
        try {
            const res = await this.db.query(sql, params);
            return { data: res.rows, error: null };
        }
        catch (e) {
            const err = e;
            return { data: null, error: { message: err.message ?? String(e), code: err.code } };
        }
    }
    then(onOk, onErr) {
        return this.run().then(onOk, onErr);
    }
    async maybeSingle() {
        const r = await this.run();
        if (r.error)
            return { data: null, error: r.error };
        return { data: r.data?.[0] ?? null, error: null };
    }
    async single() {
        const r = await this.run();
        if (r.error)
            return { data: null, error: r.error };
        if (!r.data || r.data.length === 0) {
            return { data: null, error: { message: "行が返らなかった", code: "PGRST116" } };
        }
        return { data: r.data[0], error: null };
    }
}
const noopChannel = {
    on(_type, _f, _cb) { return noopChannel; },
    subscribe() { return noopChannel; },
};
export async function createPgliteBackend(migrationsDir = "supabase/migrations") {
    const db = await new PGlite();
    // Supabase には既にあるもの。ここでは自分で作る。
    // auth.uid() は本物では JWT から来るが、テストでは GUC から読む。
    // これで「匿名ログインを有効にした構成」と「していない構成」の両方を試せる
    await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('app.member_id', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
    // Supabase は public スキーマの新しいテーブルに既定の GRANT を付ける。
    // それが無い状態でテストすると「権限を与えていないから安全」に見えてしまい、
    // 実プロジェクトとずれる。同じ既定をここでも作っておく
    await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
        await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
    }
    let acting = null;
    return {
        raw: db,
        async actAs(memberId) {
            acting = memberId;
            await db.query("select set_config('app.member_id', $1, false)", [memberId ?? ""]);
        },
        async ensureSession() {
            return acting;
        },
        from(table) {
            return {
                select: () => new Q(db, table, "select"),
                insert: (rows) => new Q(db, table, "insert", rows),
                update: (values) => new Q(db, table, "update", values),
            };
        },
        async rpc(fn, args = {}) {
            const params = [];
            const named = Object.keys(args).map((k) => `${k} => ${bind(args[k], params)}`).join(", ");
            // PostgREST と同じく、合成型でもスカラーでも JSON にして返す
            const sql = `select to_jsonb(${fn}(${named})) as r`;
            try {
                const res = await db.query(sql, params);
                return { data: res.rows[0]?.r ?? null, error: null };
            }
            catch (e) {
                const err = e;
                return { data: null, error: { message: err.message ?? String(e), code: err.code } };
            }
        },
        channel: () => noopChannel,
        removeChannel: () => { },
        async close() { await db.close(); },
    };
}
