import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"

const COLS = ["id","lap","kategoria_id","kategoria","csoport_sorszam","csoport","sorrend","nev","leiras","ar1","ar2","allergenek","elfogyott","rejtett","alkoholmentes"]

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

function validate(rows: any): string {
  if (!Array.isArray(rows) || rows.length === 0) return "ures_lista"
  if (rows.length > 2000) return "tul_sok_tetel"
  const seen: Record<string, 1> = {}
  for (const r of rows) {
    const id = String(r?.id ?? "").trim()
    if (!id || id.length > 80) return "hianyzo_azonosito"
    if (seen[id]) return "dupla_azonosito"
    seen[id] = 1
    if (!String(r.nev ?? "").trim()) return "hianyzo_nev"
    for (const k of ["ar1", "ar2"]) {
      const v = r[k]
      if (v !== "" && v !== null && v !== undefined && isNaN(Number(v))) return "hibas_ar"
    }
  }
  return ""
}

function clean(rows: any[]) {
  return rows.map((r) => {
    const o: Record<string, unknown> = {}
    for (const k of COLS) {
      let v = r[k]
      if (v === undefined || v === null) v = ""
      if (k === "elfogyott" || k === "rejtett" || k === "alkoholmentes") v = v === true || String(v).toLowerCase() === "true"
      else if (typeof v === "string") v = v.slice(0, 600)
      o[k] = v
    }
    return o
  })
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "szerelmem-menu", consistency: "strong" })

  if (req.method === "GET") {
    const rows = (await store.get("menu", { type: "json" })) ?? []
    const settings = (await store.get("settings", { type: "json" })) ?? {}
    return json({ ok: true, rows, settings })
  }

  if (req.method !== "POST") return json({ ok: false, error: "rossz_metodus" }, 405)

  let body: any
  try { body = JSON.parse(await req.text()) } catch { return json({ ok: false, error: "hibas_keres" }, 400) }

  const pw = Netlify.env.get("ADMIN_PASSWORD")
  if (!pw) return json({ ok: false, error: "nincs_jelszo_beallitva" })
  if (String(body?.pw ?? "") !== pw) {
    await new Promise((r) => setTimeout(r, 800))
    return json({ ok: false, error: "rossz_jelszo" })
  }
  if (body.action === "check") return json({ ok: true })
  if (body.action === "save") {
    const err = validate(body.rows)
    if (err) return json({ ok: false, error: err })
    const prev = await store.get("menu", { type: "json" })
    if (prev) await store.setJSON("menu-elozo", prev)
    const rows = clean(body.rows)
    await store.setJSON("menu", rows)
    if (body.settings && typeof body.settings === "object") {
      const h = body.settings.heti || {}
      const d = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")
      await store.setJSON("settings", { heti: { from: d(h.from), to: d(h.to) } })
    }
    return json({ ok: true, saved: rows.length })
  }
  return json({ ok: false, error: "ismeretlen_muvelet" })
}

export const config: Config = {
  path: "/api/menu",
  method: ["GET", "POST"],
}
