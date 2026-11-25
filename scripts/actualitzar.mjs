// Actualitza data.js de la web dels Pink Beaks a partir de pitch.cat.
// S'executa cada nit amb GitHub Actions (.github/workflows/actualitzar.yml).
// Secrets necessaris: PITCH_USER (llicència de l'usuari), PITCH_PASS, PB_JUGADORS ({"Nom":"ACPPxxxxxx", ...}).
// Les llicències NO s'escriuen mai a data.js ni a cap fitxer del repositori.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'node-html-parser';

const BASE = process.env.PB_BASE || 'https://www.pitch.cat';
const ARREL = new URL('..', import.meta.url).pathname;
const USER = process.env.PITCH_USER || '';
const PASS = process.env.PITCH_PASS || '';
const LIC = JSON.parse(process.env.PB_JUGADORS || '{}'); // nom -> llicència
const PAUSA = 150;
const PAR = ['FB', 'FS', 'GR', 'GH'];
const estat = { inici: new Date().toISOString(), errors: [], avisos: [], canvis: [] };

const dorm = (ms) => new Promise((r) => setTimeout(r, ms));
const avuiMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- HTTP amb galetes
const cookies = new Map();
async function req(path, { method = 'GET', body = null, redirect = 'follow' } = {}) {
  await dorm(PAUSA);
  const headers = { 'User-Agent': 'PinkBeaksBot/1.0 (actualitzacio diaria de handicaps del club)' };
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => k + '=' + v).join('; ');
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(BASE + path, { method, headers, body, redirect });
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [kv] = c.split(';'); const i = kv.indexOf('=');
    if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  if (res.status >= 300 && res.status < 400 && redirect === 'manual') {
    const loc = res.headers.get('location');
    if (loc) return req(new URL(loc, BASE + path).pathname + new URL(loc, BASE + path).search);
  }
  return new TextDecoder('latin1').decode(await res.arrayBuffer());
}
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

// ---------- utilitats de text
const net = (s) => (s || '').replace(/\s+/g, ' ').trim();
const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const num = (s) => { if (!s) return null; const m = s.match(/(\(\+\))?\s*(\d+(?:,\d+)?)/); if (!m) return null; const v = parseFloat(m[2].replace(',', '.')); return m[1] ? -v : v; };
const cells = (tr) => tr.childNodes.filter((n) => n.tagName === 'TD' || n.tagName === 'TH');
function camp(c) {
  const m = [[/VALLROMANES/, 'Vallromanes'], [/CASTELL GODMAR/, 'Castell Godmar'], [/GARRIGA/, 'La Garriga'], [/GURUMBAU/, 'Mas Gurumbau'], [/HCP 1/, 'HCP 1'], [/TEIA/, 'Teià'], [/SANT CEBRI/, 'Sant Cebrià'], [/VALLÈS/, 'Vallès Golf'], [/FRANCIAC/, 'Franciac'], [/PORTAL DEL ROC/, 'Portal del Roc'], [/TORRELLAS/, 'Mas Torrellas'], [/MONTSENY/, 'Montseny'], [/CAN RAFEL/, 'Can Rafel'], [/BELLPUIG/, 'Bellpuig'], [/ROC3/, 'Roc3'], [/LLORET/, 'Lloret'], [/GUALTA/, 'Gualta'], [/XIXERELLA/, 'Xixerella'], [/ORDINO/, "Vall d'Ordino"], [/TENNIS MORA/, 'Tennis Mora'], [/OLLER/, 'Oller del Mas'], [/VENDRELL/, 'Vendrell'], [/bonÀrea/i, 'bonÀrea'], [/MAS PAG/, 'Mas Pagès'], [/MASCAR/, 'Can Mascaró'], [/COSTA DAURADA/, 'Costa Daurada']];
  for (const [r, n] of m) if (r.test(c)) return n;
  return c.replace(/\(.*?\)/g, '').replace(/PITCH (&|AND) PUTT|GOLF I|RECORREGUT( DE)?/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
}
const monday = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ---------- dades actuals
const DATA_PATH = ARREL + 'data.js';
const txt = readFileSync(DATA_PATH, 'utf8');
const D = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
const AVUI = avuiMadrid();
const MES = AVUI.slice(0, 7);
const FEM = new Set(D.jugadors.filter((j) => j.equip === 'Femení').map((j) => j.nom));

// ---------- 1. Handicaps (no cal sessió)
async function handicaps() {
  const out = {};
  for (const j of D.jugadors) {
    const l = LIC[j.nom]; if (!l) { estat.avisos.push('Sense llicència als secrets: ' + j.nom); continue; }
    try {
      const h = await req('/handicap.php', { method: 'POST', body: form({ LOGIN: l, action: 'Consultar' }) });
      const t = net(parse(h).text); const i = t.indexOf('Introdueix la llic'); const s = t.slice(Math.max(0, i), i + 600);
      if (/NO activa/i.test(s)) { estat.avisos.push('Llicència no activa: ' + j.nom); continue; }
      const hc = s.match(/Handicap exacte:\s*(\(\+\))?\s*([\d,]+)/); const d = s.match(/actualització el (\d\d)\.(\d\d)\.(\d{4})/);
      if (!hc) { estat.avisos.push('No trobo el handicap de ' + j.nom); continue; }
      out[j.nom] = { h: (hc[1] ? -1 : 1) * parseFloat(hc[2].replace(',', '.')), d: d ? `${d[3]}-${d[2]}-${d[1]}` : null };
    } catch (e) { estat.errors.push('Handicap ' + j.nom + ': ' + e.message); }
  }
  return out;
}

// ---------- 2. Sessió i resultats
async function login() {
  if (!USER || !PASS) { estat.errors.push('Falten els secrets PITCH_USER / PITCH_PASS'); return false; }
  await req('/login.php');
  await req('/login.php', { method: 'POST', body: form({ url: '/login.php', accio: 'entrar', LOGIN: USER, PASSWD: PASS, action: 'entrar' }), redirect: 'manual' });
  const h = await req('/jugador/resultats/resultats.php');
  const ok = /name=["']?IDJUG/i.test(h);
  if (!ok) estat.errors.push('No he pogut iniciar sessió a pitch.cat (usuari o contrasenya?)');
  return ok ? h : false;
}
const parseRows = (h) => parse(h).querySelectorAll('tr').map((tr) => {
  const c = cells(tr).map((x) => net(x.text)); const a = tr.querySelector('a[href*="torneig.php"]');
  return { c, id: a ? ((a.getAttribute('href') || '').match(/id=(\d+)/) || [])[1] || null : null };
}).filter((r) => r.c.length >= 15 && /^\d\d\.\d\d\.\d{4}/.test(r.c[0]));

async function resultats(html0) {
  const root = parse(html0); const sel = root.querySelector('select[name="IDJUG"]') || root.querySelector('select[name=IDJUG]');
  const opts = sel.querySelectorAll('option'); const self = opts[0].getAttribute('value');
  const perLic = Object.fromEntries(Object.entries(LIC).map(([n, l]) => [l, n]));
  const EQ = {}, IDS = {}, FULL = {};
  for (const o of opts) { const t = net(o.text); const l = (t.match(/ACPP\d{6}/) || [])[0]; const n = o.getAttribute('value') === self ? perLic[USER] : perLic[l]; if (n) { const f = norm(t.replace(/ACPP\d{6}/, '')); EQ[f] = n; IDS[n] = o.getAttribute('value'); FULL[n] = f; } }
  const nice = (n) => { if (!n) return null; if (EQ[norm(n)]) return EQ[norm(n)]; const w = n.split(' '); const k = (['JOSE', 'PERE', 'JUAN', 'JOAN', 'MARIA'].includes(w[0]) && w.length >= 4) ? w.slice(0, 3) : w.slice(0, 2); return k.map((x) => x[0] + x.slice(1).toLowerCase()).join(' '); };
  const select = (nom) => req('/jugador/resultats/resultats.php', { method: 'POST', body: form({ IDJUG: IDS[nom] }) });
  const parella = async (nom, id) => {
    await select(nom); const h = await req('/jugador/resultats/torneig.php?id=' + id);
    const ns = parse(h).querySelectorAll('tr').map((tr) => { const c = cells(tr); return c.length ? net(c[0].text) : ''; }).filter((x) => /^[A-ZÀ-ÜÑÇ' .·-]{6,}$/.test(x) && /\s/.test(x) && !/PITCH|PUTT|CAMP/.test(x));
    const own = FULL[nom]; const i = ns.findIndex((x) => norm(x) === own); let p = i >= 0 ? (i % 2 === 0 ? ns[i + 1] : ns[i - 1]) : null;
    if (!p || norm(p) === own) p = ns.find((x) => norm(x) !== own); return p ? nice(p) : null;
  };
  const ALL = {};
  for (const nom of Object.keys(IDS)) {
    try {
      const h = await select(nom); const tot = +((h.match(/(\d+) partides jugades/) || [])[1] || 0); let rows = parseRows(h);
      for (let p = 2; p <= Math.ceil(tot / 10); p++) rows = rows.concat(parseRows(await req('/jugador/resultats/resultats.php?&pag=' + p)));
      rows = rows.map((r, k) => { const s = r.c[0]; const [dd, mm, yy] = s.slice(0, 10).split('.'); return { d: `${yy}-${mm}-${dd}`, dt: `${yy}-${mm}-${dd} ${s.slice(10, 15) || '00:00'}`, k, t: r.c[1], c: camp(r.c[2]), m: r.c[3], f: r.c[4], cb: +r.c[13] || null, cn: +r.c[14] || null, hi: num(r.c[10]), hf: num(r.c[11]), hiraw: r.c[10], id: r.id }; })
        .sort((a, b) => (a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : b.k - a.k));
      ALL[nom] = rows;
    } catch (e) { estat.errors.push('Resultats ' + nom + ': ' + e.message); }
  }
  return { ALL, parella, select, self, IDS };
}

// ---------- 3. Càlculs
const avg = (a) => (a.length ? r1(a.reduce((t, r) => t + r.cb, 0) / a.length) : null);
const best = (a) => a.filter((r) => r.cb).sort((x, y) => x.cb - y.cb || x.cn - y.cn || (x.d < y.d ? 1 : -1))[0];
const pickR = (r) => r && { nom: r.nom, cb: r.cb, cn: r.cn, t: r.t, c: r.c, d: r.d, m: r.m };

async function resumJugador(nom, rows, parella) {
  const any = new Date(AVUI + 'T12:00:00Z'); any.setUTCFullYear(any.getUTCFullYear() - 1); const DES = any.toISOString().slice(0, 10);
  const s = rows.filter((r) => r.cb).slice().sort((a, b) => (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0));
  const IN = s.filter((r) => r.m === 'IN' && r.d >= DES), FB = s.filter((r) => PAR.includes(r.m)), allIN = s.filter((r) => r.m === 'IN');
  const bst = (a) => a.slice().sort((x, y) => x.cb - y.cb || (x.d < y.d ? 1 : -1))[0];
  const pick = (r) => r && [r.d, r.t, r.c, r.cb, r.cn]; const pickp = (r) => r && [r.d, r.t, r.c, r.cb, r.cn, r.m];
  const cnt = {}; rows.forEach((r) => { cnt[r.c] = (cnt[r.c] || 0) + 1; }); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const bf = bst(FB); let bfp = null; if (bf && bf.id) { try { bfp = (await parella(nom, bf.id)) || 'parella no identificada'; } catch (e) { bfp = 'parella no identificada'; } }
  const l10 = allIN.slice(0, 10).map((r) => r.cb).sort((a, b) => a - b).slice(0, 5);
  return { g: l10.length ? r1(l10.reduce((t, x) => t + x, 0) / l10.length) : null, gn: Math.min(10, allIN.length), n: rows.length, n12: s.filter((r) => r.d >= DES).length, m5: avg(IN.slice(0, 5)), m5p: IN.length >= 10 ? avg(IN.slice(5, 10)) : null, k5: Math.min(5, IN.length), bi: pick(bst(allIN)), bf: pickp(bf), bfp, top, u: s.slice(0, 10).map((r) => [r.d, r.t, r.c, r.m, r.f, r.cb, r.cn]) };
}
function minHistoric(rows) {
  let i = 0; while (i < rows.length && !/\(\+\)/.test(rows[i].hiraw) && (rows[i].hi == null || rows[i].hi < 1)) i++;
  let b = null, bd = null; for (const r of rows.slice(i)) for (const v of [r.hi, r.hf]) if (v != null && (b == null || v < b)) { b = v; bd = r.d; }
  return b == null ? null : [b, bd];
}
async function actualitat(ALL, OFF, parella) {
  const flat = []; for (const [n, rs] of Object.entries(ALL)) rs.forEach((r) => flat.push({ ...r, nom: n }));
  const START = addD(monday(AVUI), -7 * 15); const weeks = {};
  for (const r of flat) { if (r.d < START) continue; const w = monday(r.d); (weeks[w] = weeks[w] || []).push(r); }
  const WK = Object.keys(weeks).sort(); const LAST = WK[WK.length - 1]; const S = {};
  for (const w of WK) {
    const rs = weeks[w], end = addD(w, 7); const cnt = {}; rs.forEach((r) => { cnt[r.nom] = (cnt[r.nom] || 0) + 1; });
    const IN = rs.filter((r) => r.m === 'IN'), P = rs.filter((r) => PAR.includes(r.m));
    const bp = best(P); const bpo = pickR(bp); if (bp && bp.id) { try { bpo.par = await parella(bp.nom, bp.id); } catch (e) { /* res */ } }
    const hc = [], rec = [];
    for (const n of Object.keys(cnt)) {
      const INn = ALL[n].filter((r) => r.m === 'IN' && r.hi != null);
      const fw = INn.find((r) => r.d >= w && r.d < end); const lb = [...INn].reverse().find((r) => r.d < w); const a = fw ? fw.hi : (lb ? lb.hf : null);
      const na = INn.find((r) => r.d >= end); const le = [...INn].reverse().find((r) => r.d < end); const b = w === LAST ? OFF[n] : (na ? na.hi : (le ? le.hf : null));
      if (a == null || b == null) continue; const dl = r1(b - a); if (dl) hc.push([n, dl, a, b]);
      const prior = INn.filter((r) => r.d < w).flatMap((r) => [r.hi, r.hf]).filter((v) => v != null); if (prior.length && dl < 0 && b < Math.min(...prior)) rec.push([n, b]);
    }
    const vist = new Map();
    for (const r of rs.slice().sort((a, b) => (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0))) {
      const k = PAR.includes(r.m) && r.id ? r.id + '|' + r.m + '|' + r.cb : null;
      if (k && vist.has(k)) { const row = vist.get(k); if (!row[1].split(' i ').includes(r.nom)) row[1] += ' i ' + r.nom; continue; }
      const row = [r.d, r.nom, r.t, r.c, r.m, r.f, r.cb, r.cn]; vist.set(k || Symbol(), row);
    }
    const v = [...vist.values()];
    S[w] = { v, n: Object.entries(cnt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), bi: pickR(best(IN)), bp: bpo || null, bf: pickR(best(IN.filter((r) => FEM.has(r.nom)))) || null, hc: hc.sort((x, y) => x[1] - y[1]), rec };
  }
  const ANY = AVUI.slice(0, 4) + '-01-01'; const Y = flat.filter((r) => r.d >= ANY);
  const yp = best(Y.filter((r) => PAR.includes(r.m))); const ypo = pickR(yp); if (yp && yp.id) { try { ypo.par = await parella(yp.nom, yp.id); } catch (e) { /* res */ } }
  const camps = {}; Y.forEach((r) => { camps[r.c] = (camps[r.c] || 0) + 1; }); const voltes = {}; Y.forEach((r) => { voltes[r.nom] = (voltes[r.nom] || 0) + 1; });
  const ratxes = {}; for (const [n, rs] of Object.entries(ALL)) { let bS = 0, bE = null, run = 0; for (const r of rs.filter((r) => r.m === 'IN' && r.cn)) { if (r.cn < 54) { run++; if (r.d >= ANY && run > bS) { bS = run; bE = r.d; } } else run = 0; } ratxes[n] = [run, bS, bE]; }
  return { setmanes: S, any: { bi: pickR(best(Y.filter((r) => r.m === 'IN'))), bp: ypo || null, bf: pickR(best(Y.filter((r) => r.m === 'IN' && FEM.has(r.nom)))) || null, camps: Object.entries(camps).sort((a, b) => b[1] - a[1]).slice(0, 5), voltes: Object.entries(voltes).sort((a, b) => b[1] - a[1]), ratxes } };
}

function numero1Setmanes(ALL, OFF) {
  const NOMS = ['Gery', 'Oriol', 'Xoldi'].filter((n) => ALL[n]);
  const ultimDg = addD(monday(AVUI), -1); const out = []; let prev = null;
  for (let dg = '2024-12-01'; dg <= ultimDg; dg = addD(dg, 7)) {
    const h = NOMS.map((n) => { const IN = ALL[n].filter((r) => r.m === 'IN' && r.hi != null); const nx = IN.find((r) => r.d > dg); if (nx) return nx.hi; const lb = [...IN].reverse().find((r) => r.d <= dg); return OFF[n] != null ? OFF[n] : (lb ? lb.hf : null); });
    let best = null; NOMS.forEach((n, i) => { if (h[i] == null) return; if (best == null || h[i] < h[best] || (h[i] === h[best] && n === prev)) best = i; });
    if (best == null) continue; prev = NOMS[best]; out.push([dg, NOMS[best], ...h]);
  }
  return { noms: NOMS, setmanes: out };
}

// ---------- principal
async function main() {
  const H = await handicaps();
  const ultim = D.mesos[D.mesos.length - 1];
  const anterior = Object.assign({}, ultim.hcp);
  let mes = D.mesos.find((m) => m.mes === MES);
  if (!mes) { mes = { mes: MES, hcp: Object.assign({}, ultim.hcp) }; D.mesos.push(mes); D.mesos.sort((a, b) => (a.mes < b.mes ? -1 : 1)); }
  let canvi = false;
  for (const j of D.jugadors) {
    const n = H[j.nom]; if (!n) continue;
    if (mes.hcp[j.nom] !== n.h) { estat.canvis.push(`${j.nom}: ${mes.hcp[j.nom]} → ${n.h}`); canvi = true; }
    mes.hcp[j.nom] = n.h; if (n.d) j.darrer_update = n.d;
  }
  if (Object.keys(H).length) mes.actualitzat = AVUI;
  if (canvi) { D.hcp_anterior = anterior; D.hcp_anterior_data = ultim.actualitzat || D.generat; }
  const OFF = Object.fromEntries(D.jugadors.map((j) => [j.nom, mes.hcp[j.nom]]));

  const h0 = await login();
  if (h0) {
    const { ALL, parella } = await resultats(h0);
    const R = Object.assign({}, D.resultats || {}); const MIN = Object.assign({}, D.hcp_min || {});
    for (const [nom, rows] of Object.entries(ALL)) {
      try { R[nom] = await resumJugador(nom, rows, parella); const mn = minHistoric(rows); if (mn) MIN[nom] = mn; } catch (e) { estat.errors.push('Resum ' + nom + ': ' + e.message); }
    }
    // el handicap oficial actual també compta per al rècord
    for (const [n, v] of Object.entries(OFF)) if (v != null && MIN[n] && v < MIN[n][0]) MIN[n] = [v, AVUI];
    D.resultats = R; D.hcp_min = MIN; D.resultats_actualitzat = AVUI;
    try { D.actualitat = await actualitat(ALL, OFF, parella); D.actualitat_data = AVUI; } catch (e) { estat.errors.push('Actualitat: ' + e.message); }
    try { D.n1 = numero1Setmanes(ALL, OFF); } catch (e) { estat.errors.push('Número 1: ' + e.message); }
  }
  D.generat = AVUI;
  const out = 'window.PB_DATA = ' + JSON.stringify(D) + ';\n';
  if (/ACPP\d{6}/.test(out)) throw new Error('data.js contindria una llicència: no es desa');
  writeFileSync(DATA_PATH, out);
  estat.fi = new Date().toISOString(); estat.ok = estat.errors.length === 0; estat.resultats = !!h0;
  writeFileSync(ARREL + 'estat.json', JSON.stringify(estat, null, 1) + '\n');
  console.log(JSON.stringify(estat, null, 1));
}
main().catch((e) => {
  estat.errors.push('Error general: ' + e.message); estat.ok = false; estat.fi = new Date().toISOString();
  try { writeFileSync(ARREL + 'estat.json', JSON.stringify(estat, null, 1) + '\n'); } catch (e2) { /* res */ }
  console.error(e); process.exit(1);
});
