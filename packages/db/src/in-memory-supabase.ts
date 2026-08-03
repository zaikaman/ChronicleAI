/**
 * In-memory Supabase client for tests.
 *
 * Mirrors the subset of the PostgREST chain used by @chronicleai/db repositories
 * so API contract tests can boot the real Express app without touching a remote
 * database. All state lives in process memory and is discarded when the process exits.
 */

type Row = Record<string, unknown>;

interface Filter {
  column: string;
  op: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "is" | "not" | "or";
  value: unknown;
  /** For op === "not": the inner PostgREST operator (e.g. "is", "eq"). */
  notOp?: string;
  orClause?: string;
}

interface QueryState {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  filters: Filter[];
  orderBy?: { column: string; ascending: boolean };
  limitCount?: number;
  rangeFrom?: number;
  rangeTo?: number;
  selectColumns?: string;
  payload?: Row | Row[];
  single?: boolean;
  head?: boolean;
  countRequested?: boolean;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function asComparable(value: unknown): string | number | null {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  return null;
}

function compareValues(
  actual: unknown,
  expected: unknown,
  op: "gte" | "lte" | "gt" | "lt",
): boolean {
  const left = asComparable(actual);
  const right = asComparable(expected);
  if (left == null || right == null) {
    return false;
  }
  switch (op) {
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "lt":
      return left < right;
  }
}

function splitByCommaTopLevel(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseValue(valStr: string): unknown {
  const trimmed = valStr.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function evalSingleCond(row: Row, condStr: string): boolean {
  const trimmed = condStr.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(4, -1);
    const subConds = splitByCommaTopLevel(inner);
    return subConds.every((c) => evalSingleCond(row, c));
  }
  if (trimmed.startsWith("or(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(3, -1);
    const subConds = splitByCommaTopLevel(inner);
    return subConds.some((c) => evalSingleCond(row, c));
  }

  const firstDot = trimmed.indexOf(".");
  if (firstDot === -1) return true;
  const col = trimmed.slice(0, firstDot);
  const rest = trimmed.slice(firstDot + 1);
  const secondDot = rest.indexOf(".");
  if (secondDot === -1) return true;
  const op = rest.slice(0, secondDot);
  const valStr = rest.slice(secondDot + 1);

  const actual = row[col];
  const expected = parseValue(valStr);

  switch (op) {
    case "eq":
      return actual === expected || String(actual) === String(expected);
    case "neq":
      return actual !== expected && String(actual) !== String(expected);
    case "gt":
      return compareValues(actual, expected, "gt");
    case "gte":
      return compareValues(actual, expected, "gte");
    case "lt":
      return compareValues(actual, expected, "lt");
    case "lte":
      return compareValues(actual, expected, "lte");
    case "is":
      if (expected === null) return isNullish(actual);
      return actual === expected;
    case "in": {
      let valuesStr = valStr.trim();
      if (valuesStr.startsWith("(") && valuesStr.endsWith(")")) {
        valuesStr = valuesStr.slice(1, -1);
      }
      const list = valuesStr.split(",").map(parseValue);
      return list.some((item) => actual === item || String(actual) === String(item));
    }
    default:
      return true;
  }
}

function evalOrClause(row: Row, clause: string): boolean {
  const topConds = splitByCommaTopLevel(clause);
  return topConds.some((cond) => evalSingleCond(row, cond));
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "gte":
      return compareValues(actual, filter.value, "gte");
    case "lte":
      return compareValues(actual, filter.value, "lte");
    case "gt":
      return compareValues(actual, filter.value, "gt");
    case "lt":
      return compareValues(actual, filter.value, "lt");
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case "is":
      // .is("col", null) → actual is null/undefined
      if (filter.value === null) return isNullish(actual);
      return actual === filter.value;
    case "not": {
      // .not("col", "is", null) → actual is NOT null
      const inner: Filter = {
        column: filter.column,
        op: (filter.notOp as Filter["op"]) || "eq",
        value: filter.value,
      };
      return !matchesFilter(row, inner);
    }
    case "or":
      return evalOrClause(row, String(filter.orClause || filter.value));
    default:
      return true;
  }
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

function projectRow(row: Row, selectColumns?: string): Row {
  if (!selectColumns || selectColumns === "*" || selectColumns.includes("*")) {
    // Strip nested join placeholders when repositories select with join syntax.
    // Unknown nested relations resolve to null so list endpoints stay empty-safe.
    const projected: Row = { ...row };
    if (selectColumns?.includes("monitored_events")) {
      projected.monitored_events = row.monitored_events ?? null;
    }
    return projected;
  }

  const cols = selectColumns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .filter((c) => !c.includes("(") && !c.includes(")"));

  if (cols.length === 0) {
    return { ...row };
  }

  const out: Row = {};
  for (const col of cols) {
    if (col in row) {
      out[col] = row[col];
    }
  }
  return out;
}

class InMemoryQueryBuilder implements PromiseLike<{
  data: unknown;
  error: { message: string; code?: string; details?: string } | null;
  count: number | null;
}> {
  private readonly store: Map<string, Row[]>;
  private readonly state: QueryState;

  constructor(store: Map<string, Row[]>, state: QueryState) {
    this.store = store;
    this.state = state;
  }

  private clone(patch: Partial<QueryState>): InMemoryQueryBuilder {
    return new InMemoryQueryBuilder(this.store, { ...this.state, ...patch });
  }

  select(
    columns = "*",
    options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
  ): InMemoryQueryBuilder {
    // insert/update/delete pipelines call .select() after mutation; keep action.
    const headPatch =
      options?.head === undefined ? {} : ({ head: options.head } as const);
    if (this.state.action === "insert" || this.state.action === "update" || this.state.action === "delete" || this.state.action === "upsert") {
      return this.clone({
        selectColumns: columns,
        ...headPatch,
        countRequested: options?.count !== undefined,
      });
    }
    return this.clone({
      action: "select",
      selectColumns: columns,
      ...headPatch,
      countRequested: options?.count !== undefined,
    });
  }

  insert(payload: Row | Row[]): InMemoryQueryBuilder {
    return this.clone({ action: "insert", payload });
  }

  upsert(payload: Row | Row[]): InMemoryQueryBuilder {
    return this.clone({ action: "upsert", payload });
  }

  update(payload: Row): InMemoryQueryBuilder {
    return this.clone({ action: "update", payload });
  }

  delete(): InMemoryQueryBuilder {
    return this.clone({ action: "delete" });
  }

  eq(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "eq", value }],
    });
  }

  neq(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "neq", value }],
    });
  }

  gte(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "gte", value }],
    });
  }

  lte(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "lte", value }],
    });
  }

  gt(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "gt", value }],
    });
  }

  lt(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "lt", value }],
    });
  }

  in(column: string, value: unknown[]): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "in", value }],
    });
  }

  is(column: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [...this.state.filters, { column, op: "is", value }],
    });
  }

  /**
   * PostgREST-style negation, e.g. `.not("expires_at", "is", null)`.
   */
  not(column: string, operator: string, value: unknown): InMemoryQueryBuilder {
    return this.clone({
      filters: [
        ...this.state.filters,
        { column, op: "not", value, notOp: operator },
      ],
    });
  }

  or(clause: string): InMemoryQueryBuilder {
    return this.clone({
      filters: [
        ...this.state.filters,
        { column: "*", op: "or", value: clause, orClause: clause },
      ],
    });
  }

  order(column: string, options?: { ascending?: boolean }): InMemoryQueryBuilder {
    return this.clone({
      orderBy: { column, ascending: options?.ascending !== false },
    });
  }

  limit(count: number): InMemoryQueryBuilder {
    return this.clone({ limitCount: count });
  }

  range(from: number, to: number): InMemoryQueryBuilder {
    return this.clone({ rangeFrom: from, rangeTo: to });
  }

  single(): InMemoryQueryBuilder {
    return this.clone({ single: true });
  }

  maybeSingle(): InMemoryQueryBuilder {
    return this.clone({ single: true });
  }

  then<TResult1 = {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: { message: string; code?: string; details?: string } | null;
          count: number | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private tableRows(): Row[] {
    if (!this.store.has(this.state.table)) {
      this.store.set(this.state.table, []);
    }
    return this.store.get(this.state.table)!;
  }

  private execute(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    try {
      switch (this.state.action) {
        case "insert":
          return this.executeInsert();
        case "upsert":
          return this.executeUpsert();
        case "update":
          return this.executeUpdate();
        case "delete":
          return this.executeDelete();
        case "select":
        default:
          return this.executeSelect();
      }
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "In-memory supabase error",
        },
        count: null,
      };
    }
  }

  private executeInsert(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    const rows = this.tableRows();
    const payloads = Array.isArray(this.state.payload)
      ? this.state.payload
      : [this.state.payload ?? {}];

    const inserted: Row[] = [];
    for (const payload of payloads) {
      const row: Row = {
        id: typeof payload.id === "string" ? payload.id : newId(),
        created_at: typeof payload.created_at === "string" ? payload.created_at : nowIso(),
        updated_at: typeof payload.updated_at === "string" ? payload.updated_at : nowIso(),
        ...payload,
      };
      // Unique-ish protection on common natural keys used by product ensure
      if (typeof row.slug === "string") {
        const conflict = rows.find((r) => r.slug === row.slug);
        if (conflict) {
          return {
            data: null,
            error: {
              message: `duplicate key value violates unique constraint`,
              code: "23505",
              details: `Key (slug)=(${row.slug}) already exists.`,
            },
            count: null,
          };
        }
      }
      rows.push(row);
      inserted.push(row);
    }

    if (this.state.single) {
      return { data: projectRow(inserted[0]!, this.state.selectColumns), error: null, count: null };
    }
    return {
      data: inserted.map((r) => projectRow(r, this.state.selectColumns)),
      error: null,
      count: null,
    };
  }

  private executeUpsert(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    const rows = this.tableRows();
    const payloads = Array.isArray(this.state.payload)
      ? this.state.payload
      : [this.state.payload ?? {}];

    const result: Row[] = [];
    for (const payload of payloads) {
      const id = typeof payload.id === "string" ? payload.id : undefined;
      const existingIdx = id ? rows.findIndex((r) => r.id === id) : -1;
      if (existingIdx >= 0) {
        const merged = {
          ...rows[existingIdx],
          ...payload,
          updated_at: nowIso(),
        };
        rows[existingIdx] = merged;
        result.push(merged);
      } else {
        const row: Row = {
          id: id ?? newId(),
          created_at: nowIso(),
          updated_at: nowIso(),
          ...payload,
        };
        rows.push(row);
        result.push(row);
      }
    }

    if (this.state.single) {
      return { data: projectRow(result[0]!, this.state.selectColumns), error: null, count: null };
    }
    return {
      data: result.map((r) => projectRow(r, this.state.selectColumns)),
      error: null,
      count: null,
    };
  }

  private executeUpdate(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    const rows = this.tableRows();
    const matched = applyFilters(rows, this.state.filters);
    const payload = (this.state.payload as Row) ?? {};

    for (const row of matched) {
      Object.assign(row, payload, { updated_at: nowIso() });
    }

    if (this.state.single) {
      if (matched.length === 0) {
        return {
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          count: null,
        };
      }
      return { data: projectRow(matched[0]!, this.state.selectColumns), error: null, count: null };
    }

    return {
      data: matched.map((r) => projectRow(r, this.state.selectColumns)),
      error: null,
      count: matched.length,
    };
  }

  private executeDelete(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    const rows = this.tableRows();
    const remaining: Row[] = [];
    const deleted: Row[] = [];

    for (const row of rows) {
      if (matchesFilterAll(row, this.state.filters)) {
        deleted.push(row);
      } else {
        remaining.push(row);
      }
    }

    this.store.set(this.state.table, remaining);

    if (this.state.single) {
      return {
        data: deleted[0] ? projectRow(deleted[0], this.state.selectColumns) : null,
        error: null,
        count: null,
      };
    }

    return {
      data: deleted.map((r) => projectRow(r, this.state.selectColumns)),
      error: null,
      count: deleted.length,
    };
  }

  private executeSelect(): {
    data: unknown;
    error: { message: string; code?: string; details?: string } | null;
    count: number | null;
  } {
    let rows = applyFilters(this.tableRows(), this.state.filters);

    if (this.state.orderBy) {
      const { column, ascending } = this.state.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return ascending ? -1 : 1;
        return ascending ? 1 : -1;
      });
    }

    const total = rows.length;

    if (this.state.rangeFrom != null && this.state.rangeTo != null) {
      rows = rows.slice(this.state.rangeFrom, this.state.rangeTo + 1);
    } else if (this.state.limitCount != null) {
      rows = rows.slice(0, this.state.limitCount);
    }

    if (this.state.head) {
      return {
        data: null,
        error: null,
        count: this.state.countRequested ? total : null,
      };
    }

    const projected = rows.map((r) => projectRow(r, this.state.selectColumns));

    if (this.state.single) {
      if (projected.length === 0) {
        return {
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          count: null,
        };
      }
      return { data: projected[0], error: null, count: null };
    }

    return {
      data: projected,
      error: null,
      count: this.state.countRequested ? total : null,
    };
  }
}

function matchesFilterAll(row: Row, filters: Filter[]): boolean {
  if (filters.length === 0) {
    // Supabase delete without filters is invalid; our cleanup uses .neq()
    return false;
  }
  return filters.every((f) => matchesFilter(row, f));
}

export interface InMemorySupabaseClient {
  from: (table: string) => InMemoryQueryBuilder;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  /** Test helper: inspect stored rows */
  __store: Map<string, Row[]>;
  /** Test helper: wipe all tables */
  __reset: () => void;
}

/**
 * Create an isolated in-memory Supabase-like client.
 * Never opens network connections and never mutates a real database.
 */
export function createInMemorySupabaseClient(): InMemorySupabaseClient {
  const store = new Map<string, Row[]>();

  return {
    from(table: string) {
      return new InMemoryQueryBuilder(store, {
        table,
        action: "select",
        filters: [],
      });
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "sum_affiliate_earned") {
        const wallet = String(args?.p_affiliate_wallet ?? "").toLowerCase().trim();
        const rows = store.get("affiliate_earnings") ?? [];
        const total = rows.reduce((acc, row) => {
          if (String(row.affiliate_wallet ?? "").toLowerCase() !== wallet) return acc;
          const n = Number(row.reward_amount ?? 0);
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0);
        return Promise.resolve({ data: total, error: null });
      }
      if (fn === "sum_affiliate_withdrawals") {
        const wallet = String(args?.p_affiliate_wallet ?? "").toLowerCase().trim();
        const statuses = Array.isArray(args?.p_statuses)
          ? (args.p_statuses as string[])
          : [];
        const rows = store.get("affiliate_withdrawals") ?? [];
        const total = rows.reduce((acc, row) => {
          if (String(row.affiliate_wallet ?? "").toLowerCase() !== wallet) return acc;
          if (!statuses.includes(String(row.status ?? ""))) return acc;
          const n = Number(row.amount ?? 0);
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0);
        return Promise.resolve({ data: total, error: null });
      }
      // P1-1 activity analytics RPCs — return empty aggregates so callers fall through
      // only when intentionally missing; unit tests mock the repository layer.
      if (fn === "activity_subscription_analytics") {
        return Promise.resolve({
          data: {
            mrr: 0,
            mrrCurrency: "USDC",
            activeNewsletterSubscriptions: 0,
            settledPayments: 0,
            totalPaymentAttempts: 0,
            conversionRate: 0,
            routeMix: [],
            totalSettledVolume: 0,
            referredSettledCount: 0,
            referredSettledVolume: 0,
          },
          error: null,
        });
      }
      if (fn === "activity_referral_attribution") {
        return Promise.resolve({
          data: {
            partners: [],
            totalReferredVolume: 0,
            totalReferredPayments: 0,
            currency: "USDC",
          },
          error: null,
        });
      }
      if (fn === "treasury_payment_aggregates") {
        const rows = store.get("payment_records") ?? [];
        const settled = rows.filter((row) => row.status === "settled");
        const totalRevenue = settled.reduce((sum, row) => {
          const amount = Number(row.amount_settled ?? 0);
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        return Promise.resolve({
          data: {
            totalRevenue,
            totalPaidRequests: settled.length,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: `RPC not available in in-memory test client: ${fn}` },
      });
    },
    __store: store,
    __reset() {
      store.clear();
    },
  };
}
