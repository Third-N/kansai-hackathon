/* ============================================================
   Supabase クライアントのうち、この app が実際に使う部分だけを型にしたもの。

   本物の SupabaseClient をそのまま使わずに一枚挟んでいるのは、
   テストで差し替えられるようにするため。テスト側では PGlite（WASM の
   PostgreSQL）に同じ形をかぶせて、本物の SQL を走らせている。
   ここに無いメソッドは使っていない、という宣言でもある。
   ============================================================ */

export type Row = Record<string, unknown>;

export interface PgError {
  message: string;
  code?: string;
}

export interface One<T> {
  data: T | null;
  error: PgError | null;
}

export interface Many<T> {
  data: T[] | null;
  error: PgError | null;
}

export type Scalar = string | number | boolean;

export interface Filter<T> extends PromiseLike<Many<T>> {
  eq(column: string, value: Scalar): Filter<T>;
  neq(column: string, value: Scalar): Filter<T>;
  in(column: string, values: Scalar[]): Filter<T>;
  order(column: string, opts?: { ascending?: boolean }): Filter<T>;
  limit(n: number): Filter<T>;
  maybeSingle(): PromiseLike<One<T>>;
  single(): PromiseLike<One<T>>;
}

export interface Mutation<T> extends PromiseLike<Many<T>> {
  eq(column: string, value: Scalar): Mutation<T>;
  select(columns?: string): Filter<T>;
}

export interface Table<T> {
  select(columns?: string): Filter<T>;
  insert(rows: Row | Row[]): Mutation<T>;
  update(values: Row): Mutation<T>;
}

export interface ChangePayload {
  new: Row | null;
  old: Row | null;
}

export interface ChangeFilter {
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  schema: string;
  table: string;
  filter?: string;
}

export interface Channel {
  on(type: "postgres_changes", filter: ChangeFilter, cb: (payload: ChangePayload) => void): Channel;
  subscribe(cb?: (status: string) => void): Channel;
}

export interface SupabaseLike {
  /**
   * この端末のセッションを用意し、その ID を返す。
   * Supabase の匿名ログインが有効なら auth のユーザーID、
   * 無効（またはテスト）なら null。null のときは端末が自分で作った ID を使う。
   */
  ensureSession(): Promise<string | null>;
  from<T = Row>(table: string): Table<T>;
  rpc<T = unknown>(fn: string, args?: Row): PromiseLike<One<T>>;
  channel(name: string): Channel;
  removeChannel(channel: Channel): void;
}

/** unique 制約違反。あいことばの取り直しに使う */
export const UNIQUE_VIOLATION = "23505";
