import { getStore } from "@netlify/blobs"
import { createHash, randomBytes } from "node:crypto"
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
  if (x.ebed && typeof x.ebed === "object") {
    const e: any = x.ebed, o: any = {}
    const tm = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "")
    const ar = Number(String(e.ar ?? "").replace(/[^\d]/g, ""))
    if (String(e.ar ?? "") !== "" && Number.isFinite(ar) && ar <= 1000000) o.ar = ar
    if (tm(e.tf)) o.tf = tm(e.tf)
    if (tm(e.tt)) o.tt = tm(e.tt)
    if (Array.isArray(e.days)) {
      const ds = [...new Set(e.days.map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7))].sort()
      if (ds.length) o.days = ds
    }
    for (const k of ["lab_ar", "lab_dy", "lab1", "lab2"]) { const v = str(e[k], 60); if (v) o[k] = v }
    const ft = typeof e.foot === "string" ? e.foot.trim().slice(0, 1200) : ""
    if (ft) o.foot = ft
    o.weeks = {}
    if (e.weeks && typeof e.weeks === "object") {
      const keys = Object.keys(e.weeks).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-104)
      for (const wk of keys) {
        const W = e.weeks[wk], ow: any = {}
        if (!W || typeof W !== "object") continue
        for (let k = 1; k <= 7; k++) {
          const m = W[k] ?? W[String(k)]
          if (m && typeof m === "object") {
            const l = str(m.leves, 160), f = str(m.foetel, 200)
            if (l || f) ow[k] = { leves: l, foetel: f }
          }
        }
        if (Object.keys(ow).length) o.weeks[wk] = ow
      }
    }
    out.ebed = o
  }
  const h = out.cats.heti || {}
  out.heti = { from: h.from || "", to: h.to || "" }
  return out
}

const PERMS = [
  { k: "elfogyott", l: "Elfogyott kapcsolók", g: "Tételek" },
  { k: "ar", l: "Árak", g: "Tételek" },
  { k: "szoveg", l: "Név, leírás, allergének", g: "Tételek" },
  { k: "uj", l: "Új tétel felvétele", g: "Tételek" },
  { k: "torles", l: "Tétel törlése", g: "Tételek" },
  { k: "rejt", l: "Tétel elrejtése", g: "Tételek" },
  { k: "sorrend", l: "Tételek sorrendje", g: "Tételek" },
  { k: "csempe", l: "Név, ikon, forma, kiemelés", g: "Csempék" },
  { k: "csempe_rejt", l: "Megjelenítés / elrejtés", g: "Csempék" },
  { k: "idozites", l: "Időzítés", g: "Csempék" },
  { k: "csempe_sorrend", l: "Csempék sorrendje", g: "Csempék" },
  { k: "kategoria", l: "Új kategória, törlés", g: "Csempék" },
  { k: "heti", l: "Heti ajánlat", g: "Külön részek" },
  { k: "ebed_menu", l: "Bisztró ebéd heti menü", g: "Külön részek" },
  { k: "ebed_ar", l: "Bisztró ebéd ára, napjai, ideje", g: "Külön részek" },
]
const ALL = PERMS.map((p) => p.k)

const OWNER_LABEL = "Adminisztrátor"
const hash = (salt: string, p: string) => createHash("sha256").update(salt + "|" + p).digest("hex")
function pwOk(u: any, given: string) { return u.ph ? hash(u.salt || "", given) === u.ph : !!u.pw && u.pw === given }
function selfSet(p: string) { const salt = randomBytes(12).toString("hex"); return { pw: "", ph: hash(salt, p), salt } }
const mask = (u: any, owner: boolean) => { const { ph, salt, ...r } = u; return { ...r, pw: owner && !ph ? u.pw : "", own: !!ph } }
function auth(body: any, own: { name: string; pw: string }, users: any[]) {
  const name = String(body?.name ?? "").trim()
  const given = String(body?.pw ?? "")
  if (name.toLocaleLowerCase("hu") === own.name.toLocaleLowerCase("hu") && given === own.pw) return { id: "owner", name: OWNER_LABEL, owner: true, main: true, perms: ALL }
  if (!name) return null
  const u = users.find((x) => x.active !== false && String(x.name).toLocaleLowerCase("hu") === name.toLocaleLowerCase("hu"))
  if (!u || !pwOk(u, given)) return null
  return { id: u.id, name: u.name, owner: false, main: !!u.main, perms: u.main ? ALL : (u.perms || []) }
}
function pub(w: any) { return { name: w.name, owner: w.owner, main: w.main, perms: w.perms } }

const fmtFt = (v: any) => (v === "" || v == null ? "–" : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + ",-")
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function diff(pr: any[], nx: any[], ps: any, ns: any) {
  const need: string[] = [], lines: string[] = []
  const P: Record<string, any> = {}, N: Record<string, any> = {}
  pr.forEach((r) => (P[r.id] = r)); nx.forEach((r) => (N[r.id] = r))
  const nm = (r: any) => String(r.nev || r.id)
  const tag = (r: any, k: string) => (r.kategoria_id === "heti" ? "heti" : k)
  const reord = new Set<string>()
  if (!pr.length) { need.push("uj"); lines.push("Menü betöltve (" + nx.length + " tétel)"); return { need, lines } }
  for (const r of nx) {
    const o = P[r.id]
    if (!o) { need.push(tag(r, "uj")); lines.push("Új tétel: " + nm(r) + " (" + (r.kategoria || r.kategoria_id) + ")"); continue }
    if (String(o.elfogyott) !== String(r.elfogyott)) { need.push(tag(r, "elfogyott")); lines.push(nm(r) + ": " + (r.elfogyott ? "elfogyott" : "újra kapható")) }
    if (String(o.ar1) !== String(r.ar1) || String(o.ar2) !== String(r.ar2)) {
      need.push(tag(r, "ar"))
      lines.push(nm(r) + ": ár " + fmtFt(o.ar1) + (o.ar2 !== "" || r.ar2 !== "" ? " / " + fmtFt(o.ar2) : "") + " → " + fmtFt(r.ar1) + (o.ar2 !== "" || r.ar2 !== "" ? " / " + fmtFt(r.ar2) : ""))
    }
    if (o.nev !== r.nev) { need.push(tag(r, "szoveg")); lines.push(nm(o) + " → átnevezve: " + nm(r)) }
    if (o.leiras !== r.leiras) { need.push(tag(r, "szoveg")); lines.push(nm(r) + ": leírás módosítva") }
    if (String(o.allergenek) !== String(r.allergenek)) { need.push(tag(r, "szoveg")); lines.push(nm(r) + ": allergének módosítva") }
    if (String(o.tipus ?? "") !== String(r.tipus ?? "")) { need.push(tag(r, "szoveg")); lines.push(nm(r) + ": típus módosítva") }
    if (String(o.alkoholmentes) !== String(r.alkoholmentes)) { need.push(tag(r, "szoveg")); lines.push(nm(r) + ": alkoholmentes jelölés módosítva") }
    if (String(o.rejtett) !== String(r.rejtett)) { need.push(tag(r, "rejt")); lines.push(nm(r) + ": " + (r.rejtett ? "elrejtve" : "megjelenítve")) }
    if (String(o.sorrend) !== String(r.sorrend) || String(o.csoport_sorszam) !== String(r.csoport_sorszam)) { need.push(tag(r, "sorrend")); reord.add(String(r.kategoria || r.kategoria_id)) }
  }
  for (const o of pr) if (!N[o.id]) { need.push(tag(o, "torles")); lines.push("Törölve: " + nm(o)) }
  reord.forEach((c) => lines.push("Sorrend módosítva: " + c))
  const pc = ps.cats || {}, nc = ns.cats || {}
  const title = (id: string) => (nc[id]?.title || pc[id]?.title || id)
  const SCH = ["from", "to", "days", "tf", "tt", "md", "mn", "nm"]
  for (const id of new Set([...Object.keys(pc), ...Object.keys(nc)])) {
    const a = pc[id] || {}, b = nc[id] || {}
    const look = ["title", "icon", "size", "kiem"].filter((k) => !same(a[k], b[k]))
    if (look.length) { need.push("csempe"); lines.push("Csempe módosítva: " + title(id) + " (" + look.map((k) => ({ title: "név", icon: "ikon", size: "forma", kiem: "kiemelés" } as any)[k]).join(", ") + ")") }
    if (!same(a.off, b.off)) { need.push("csempe_rejt"); lines.push("Csempe " + (b.off ? "elrejtve" : "megjelenítve") + ": " + title(id)) }
    if (SCH.some((k) => !same(a[k], b[k]))) { need.push(id === "heti" ? "heti" : "idozites"); lines.push("Időzítés módosítva: " + title(id)) }
  }
  if (!same(ps.order, ns.order)) { need.push("csempe_sorrend"); lines.push("Csempék sorrendje módosítva") }
  const pk = (ps.custom || []).map((c: any) => c.id), nk = (ns.custom || []).map((c: any) => c.id)
  nk.filter((k: string) => !pk.includes(k)).forEach((k: string) => { need.push("kategoria"); lines.push("Új kategória: " + title(k)) })
  pk.filter((k: string) => !nk.includes(k)).forEach((k: string) => { need.push("kategoria"); lines.push("Kategória törölve: " + title(k)) })
  const pe = ps.ebed || {}, ne = ns.ebed || {}
  if (!same(pe.ar, ne.ar)) { need.push("ebed_ar"); lines.push("Bisztró ebéd ára: " + fmtFt(pe.ar ?? 3100) + " → " + fmtFt(ne.ar ?? 3100)) }
  if (["tf", "tt", "days"].some((k) => !same(pe[k], ne[k]))) { need.push("ebed_ar"); lines.push("Bisztró ebéd napjai / ideje módosítva") }
  const pw = pe.weeks || {}, nw = ne.weeks || {}
  for (const w of new Set([...Object.keys(pw), ...Object.keys(nw)])) if (!same(pw[w], nw[w])) { need.push("ebed_menu"); lines.push("Bisztró ebéd menü módosítva: " + w + " hete") }
  if (["lab_ar", "lab_dy", "lab1", "lab2", "foot"].some((k) => !same(pe[k], ne[k]))) { need.push("ebed_menu"); lines.push("Bisztró ebéd feliratai módosítva") }
  return { need, lines }
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
  const ownSaved = ((await store.get("owner", { type: "json" })) as any) ?? {}
  const own = { name: String(ownSaved.name || "Admin"), pw: String(ownSaved.pw || pw || "") }
  if (!own.pw) return json({ ok: false, error: "nincs_jelszo_beallitva" })
  const users: any[] = ((await store.get("users", { type: "json" })) as any[]) ?? []
  const who = auth(body, own, users)
  if (!who) {
    await new Promise((r) => setTimeout(r, 800))
    return json({ ok: false, error: "rossz_jelszo" })
  }
  const boss = who.owner || who.main
  if (body.action === "check") return json({ ok: true, who: pub(who) })
  if (body.action === "save") {
    const err = validate(body.rows)
    if (err) return json({ ok: false, error: err })
    const prev = ((await store.get("menu", { type: "json" })) as any[]) ?? []
    const prevSet = ((await store.get("settings", { type: "json" })) as any) ?? {}
    const rows = clean(body.rows)
    const nextSet = body.settings && typeof body.settings === "object" ? cleanSettings(body.settings) : prevSet
    const d = diff(prev, rows, prevSet, nextSet)
    if (!boss) {
      const miss = d.need.filter((k) => !who.perms.includes(k))
      if (miss.length) return json({ ok: false, error: "nincs_jog", miss: [...new Set(miss)] })
    }
    if (!d.lines.length) return json({ ok: true, saved: rows.length })
    if (prev.length) await store.setJSON("menu-elozo", prev)
    await store.setJSON("menu", rows)
    await store.setJSON("settings", nextSet)
    const log = (((await store.get("log", { type: "json" })) as any[]) ?? []).slice(-499)
    log.push({ t: new Date().toISOString(), who: who.name, lines: d.lines.slice(0, 40) })
    await store.setJSON("log", log)
    return json({ ok: true, saved: rows.length })
  }
  if (body.action === "log") {
    if (!boss) return json({ ok: false, error: "nincs_jog" })
    const log = ((await store.get("log", { type: "json" })) as any[]) ?? []
    return json({ ok: true, log: log.slice().reverse() })
  }
  if (body.action === "users") {
    if (!boss) return json({ ok: false, error: "nincs_jog" })
    return json({ ok: true, users: users.map((u) => mask(u, who.owner)), perms: PERMS, owner: who.owner ? own : null })
  }
  if (body.action === "users_save") {
    if (!boss) return json({ ok: false, error: "nincs_jog" })
    const list = Array.isArray(body.users) ? body.users : null
    if (!list) return json({ ok: false, error: "hibas_keres" })
    const seen: Record<string, 1> = {}
    const out: any[] = []
    for (const u of list.slice(0, 50)) {
      const old0 = users.find((x) => x.id === u?.id)
      if (!who.owner && old0?.main && old0.id !== who.id) { out.push(old0); seen[String(old0.name).toLocaleLowerCase("hu")] = 1; continue }
      const name = String(u?.name ?? "").trim().slice(0, 40)
      const upw = String(u?.pw ?? "").slice(0, 60)
      if (!name || (!upw && !old0)) return json({ ok: false, error: "hianyzo_nev_jelszo" })
      const cred = upw ? { pw: upw, ph: "", salt: "" } : { pw: old0.pw || "", ph: old0.ph || "", salt: old0.salt || "" }
      const key = name.toLocaleLowerCase("hu")
      if (seen[key] || key === own.name.toLocaleLowerCase("hu")) return json({ ok: false, error: "dupla_nev" })
      seen[key] = 1
      const old = users.find((x) => x.id === u.id)
      let main = u.main === true
      if (!who.owner) main = old ? !!old.main : false
      out.push({
        id: typeof u.id === "string" && /^[a-z0-9-]{1,40}$/.test(u.id) ? u.id : "u-" + Date.now().toString(36) + out.length,
        name, ...cred, main,
        active: u.active !== false,
        perms: Array.isArray(u.perms) ? u.perms.filter((k: any) => PERMS.some((p) => p.k === k)) : [],
      })
    }
    if (!who.owner) {
      for (const o of users) if (o.main && !out.some((x) => x.id === o.id)) return json({ ok: false, error: "nincs_jog" })
    }
    await store.setJSON("users", out)
    const log = (((await store.get("log", { type: "json" })) as any[]) ?? []).slice(-499)
    const ul: string[] = []
    for (const u of out) {
      const o = users.find((x) => x.id === u.id)
      if (!o) { ul.push("Új admin: " + u.name); continue }
      if (o.name !== u.name) ul.push("Admin átnevezve: " + o.name + " → " + u.name)
      if (o.pw !== u.pw || o.ph !== u.ph) ul.push(u.name + ": jelszó visszaállítva")
      if (!!o.main !== !!u.main) ul.push(u.name + ": " + (u.main ? "fő admin lett" : "már nem fő admin"))
      if ((o.active !== false) !== (u.active !== false)) ul.push(u.name + ": " + (u.active !== false ? "újra beléphet" : "nem léphet be"))
      if (JSON.stringify(o.perms || []) !== JSON.stringify(u.perms || [])) ul.push(u.name + ": jogosultságok módosítva")
    }
    for (const o of users) if (!out.some((x) => x.id === o.id)) ul.push("Admin törölve: " + o.name)
    if (ul.length) log.push({ t: new Date().toISOString(), who: who.name, lines: ul })
    await store.setJSON("log", log)
    return json({ ok: true, users: out.map((u) => mask(u, who.owner)) })
  }
  if (body.action === "self_pw") {
    const np = String(body.newpw ?? "").slice(0, 60)
    if (np.length < 4) return json({ ok: false, error: "rovid_jelszo" })
    if (who.owner) await store.setJSON("owner", { name: own.name, pw: np })
    else {
      const i = users.findIndex((x) => x.id === who.id)
      if (i < 0) return json({ ok: false, error: "rossz_jelszo" })
      users[i] = { ...users[i], ...selfSet(np) }
      await store.setJSON("users", users)
    }
    const log = (((await store.get("log", { type: "json" })) as any[]) ?? []).slice(-499)
    log.push({ t: new Date().toISOString(), who: who.name, lines: ["Saját jelszó módosítva"] })
    await store.setJSON("log", log)
    return json({ ok: true })
  }
  if (body.action === "todos" || body.action === "todo_add" || body.action === "todo_done" || body.action === "todo_del") {
    const me = who.owner ? "owner" : who.id
    let todos: any[] = ((await store.get("todos", { type: "json" })) as any[]) ?? []
    const people = [{ id: "owner", name: OWNER_LABEL }, ...users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name }))]
    const cut = Date.now() - 30 * 864e5
    let ch = false
    if (body.action === "todo_add") {
      const text = String(body.text ?? "").trim().slice(0, 300)
      const to = String(body.to ?? "all")
      const due = typeof body.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due) ? body.due : ""
      if (!text) return json({ ok: false, error: "ures_teendo" })
      if (to !== "all" && !people.some((p) => p.id === to)) return json({ ok: false, error: "hibas_keres" })
      todos.push({ id: "t-" + Date.now().toString(36) + randomBytes(3).toString("hex"), t: new Date().toISOString(), by: me, byName: who.name, to, text, due, done: null })
      ch = true
    }
    if (body.action === "todo_done") {
      const t = todos.find((x) => x.id === body.id)
      if (!t) return json({ ok: false, error: "nincs_ilyen" })
      t.done = body.done ? { by: me, name: who.name, t: new Date().toISOString() } : null
      ch = true
    }
    if (body.action === "todo_del") {
      const t = todos.find((x) => x.id === body.id)
      if (!t) return json({ ok: false, error: "nincs_ilyen" })
      if (t.by !== me && !boss) return json({ ok: false, error: "nincs_jog" })
      todos = todos.filter((x) => x.id !== body.id)
      ch = true
    }
    const kept = todos.filter((x) => !x.done || Date.parse(x.done.t) > cut).slice(-300)
    if (ch || kept.length !== todos.length) await store.setJSON("todos", kept)
    return json({ ok: true, me, boss, people, todos: kept })
  }
  if (body.action === "owner_save") {
    if (!who.owner) return json({ ok: false, error: "nincs_jog" })
    const name = String(body.owner?.name ?? "").trim().slice(0, 40)
    const npw = String(body.owner?.pw ?? "").slice(0, 60)
    if (!name || npw.length < 4) return json({ ok: false, error: "hianyzo_nev_jelszo" })
    if (users.some((u) => String(u.name).toLocaleLowerCase("hu") === name.toLocaleLowerCase("hu"))) return json({ ok: false, error: "dupla_nev" })
    await store.setJSON("owner", { name, pw: npw })
    const log = (((await store.get("log", { type: "json" })) as any[]) ?? []).slice(-499)
    log.push({ t: new Date().toISOString(), who: OWNER_LABEL, lines: [OWNER_LABEL + " belépési adatai módosítva"] })
    await store.setJSON("log", log)
    return json({ ok: true, owner: { name, pw: npw } })
  }
  return json({ ok: false, error: "ismeretlen_muvelet" })
}

export const config: Config = {
  path: "/api/menu",
  method: ["GET", "POST"],
}
