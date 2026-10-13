import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"

const COLS = ["id","lap","kategoria_id","kategoria","csoport_sorszam","csoport","sorrend","nev","leiras","ar1","ar2","allergenek","elfogyott","rejtett","alkoholmentes","tipus"]

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

function cleanSettings(x: any) {
  const d = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "")
  const idok = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_-]{1,40}$/.test(v)
  const out: any = { cats: {}, order: {}, custom: [] }
  if (x.cats && typeof x.cats === "object") {
    for (const [k, v] of Object.entries(x.cats).slice(0, 120)) {
      if (!idok(k) || !v || typeof v !== "object") continue
      const s: any = v, o: any = {}
      const t = str(s.title, 60); if (t) o.title = t
      const ic = str(s.icon, 40); if (/^[a-z0-9_-]+$/.test(ic)) o.icon = ic
      if (d(s.from)) o.from = d(s.from)
      if (d(s.to)) o.to = d(s.to)
      const tm = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "")
      if (tm(s.tf)) o.tf = tm(s.tf)
      if (tm(s.tt)) o.tt = tm(s.tt)
      if (Array.isArray(s.days)) {
        const ds = [...new Set(s.days.map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7))].sort()
        if (ds.length && ds.length < 7) o.days = ds
      }
      if (s.size === "hosszu") o.size = "hosszu"
      if (s.md === true) o.md = true
      if (s.nm === true) o.nm = true
      if (s.mn === true) o.mn = true
      if (s.off === true) o.off = true
      if (typeof s.kiem === "boolean") o.kiem = s.kiem
      out.cats[k] = o
    }
  }
  for (const t of ["Itallap", "Étlap"]) {
    const a = x.order?.[t]
    if (Array.isArray(a)) out.order[t] = a.filter(idok).slice(0, 120)
  }
  if (Array.isArray(x.custom)) {
    out.custom = x.custom
      .filter((c: any) => c && idok(c.id) && (c.tab === "Itallap" || c.tab === "Étlap"))
      .slice(0, 60)
      .map((c: any) => ({ id: c.id, tab: c.tab }))
  }
  if (x.heti && typeof x.heti === "object" && !out.cats.heti?.from && !out.cats.heti?.to) {
    const f = d(x.heti.from), t = d(x.heti.to)
    if (f || t) out.cats.heti = { ...(out.cats.heti || {}), ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) }
  }
  const h = out.cats.heti || {}
  out.heti = { from: h.from || "", to: h.to || "" }
  return out
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
    if (body.settings && typeof body.settings === "object") await store.setJSON("settings", cleanSettings(body.settings))
    return json({ ok: true, saved: rows.length })
  }
  return json({ ok: false, error: "ismeretlen_muvelet" })
}

export const config: Config = {
  path: "/api/menu",
  method: ["GET", "POST"],
}
