import { readEnv } from "./env.mjs";

export function createSupabaseClientFromEnv() {
  const supabaseUrl = readEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  async function request(path, options = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Supabase ${response.status} ${response.statusText}: ${text}`);
    }

    return text ? JSON.parse(text) : null;
  }

  function queryString(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        search.set(key, String(value));
      }
    }
    const serialized = search.toString();
    return serialized ? `?${serialized}` : "";
  }

  return {
    select(table, params = {}) {
      return request(`${table}${queryString(params)}`);
    },

    insert(table, rows, options = {}) {
      if (!rows.length) return [];
      return request(`${table}`, {
        method: "POST",
        body: rows,
        headers: {
          Prefer: options.returning === "minimal" ? "return=minimal" : "return=representation"
        }
      });
    },

    upsert(table, rows, onConflict, options = {}) {
      if (!rows.length) return [];
      const conflictQuery = onConflict ? queryString({ on_conflict: onConflict }) : "";
      const prefer = [
        "resolution=merge-duplicates",
        options.returning === "minimal" ? "return=minimal" : "return=representation"
      ].join(",");

      return request(`${table}${conflictQuery}`, {
        method: "POST",
        body: rows,
        headers: { Prefer: prefer }
      });
    },

    update(table, patch, filters = {}, options = {}) {
      return request(`${table}${queryString(filters)}`, {
        method: "PATCH",
        body: patch,
        headers: {
          Prefer: options.returning === "minimal" ? "return=minimal" : "return=representation"
        }
      });
    }
  };
}

export function eq(value) {
  return `eq.${value}`;
}

export function gte(value) {
  return `gte.${value}`;
}

export function isNull() {
  return "is.null";
}
