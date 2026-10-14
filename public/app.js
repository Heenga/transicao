
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const SPORTS = { swim:"Natação", bike:"Bike", run:"Corrida", brick:"Transição", strength:"Força", rest:"Descanso", other:"Outro" };
const DOW = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const RACES = { sprint:"Sprint (750 m / 20 km / 5 km)", olimpico:"Olímpico (1,5 km / 40 km / 10 km)", "703":"70.3 (1,9 km / 90 km / 21 km)", ironman:"Ironman (3,8 km / 180 km / 42 km)" };

const RACE_DEFAULT = { name:"All Limits", label:"High Limits", date:"2027-05-30", time:"06:30", type:"olimpico", place:"Lagoa dos Ingleses · Alphaville, Nova Lima – MG" };
const S = { race: { ...RACE_DEFAULT }, isOwner:false, kudos:[], view:"painel", uid:null, db:null, profile:null, activities:[], plan:null, chat:[], team:[], zones:null, week:0, busy:{}, msg:{}, ready:false, noDb:false };

/* ---------- datas e formatos ---------- */
const dayKey = d => { const x = new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const mondayOf = d => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const fmtDur = s => { s = Math.round(s||0); const h = Math.floor(s/3600), m = Math.floor(s%3600/60); return h ? `${h}h${String(m).padStart(2,"0")}` : `${m} min`; };
const fmtNum = (n, d=1) => Number(n||0).toLocaleString("pt-BR",{maximumFractionDigits:d, minimumFractionDigits:0});
const paceRun = (m, s) => m > 0 ? (()=>{ const p = s/(m/1000); return `${Math.floor(p/60)}:${String(Math.round(p%60)).padStart(2,"0")}/km`; })() : "—";
const paceSwim = (m, s) => m > 0 ? (()=>{ const p = s/(m/100); return `${Math.floor(p/60)}:${String(Math.round(p%60)).padStart(2,"0")}/100m`; })() : "—";
const speedBike = (m, s) => s > 0 ? `${fmtNum((m/1000)/(s/3600),1)} km/h` : "—";
const fmtDist = (sport, m) => sport === "swim" ? `${fmtNum(m,0)} m` : `${fmtNum(m/1000,1)} km`;
const fmtDate = d => new Date(d).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});

/* ---------- normalização de atividades ---------- */
function sportOf(t){
  t = String(t||"").toLowerCase();
  if (/swim|nata/.test(t)) return "swim";
  if (/ride|bike|cycl|cicl|velo|spin/.test(t)) return "bike";
  if (/run|corr|treadmill|esteira/.test(t)) return "run";
  if (/weight|strength|for[cç]a|academia|crossfit|workout|pilates|muscula/.test(t)) return "strength";
  return "other";
}
function toSec(v){
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const p = s.split(":").map(Number);
  if (p.some(isNaN)) return 0;
  return p.reduce((a, b) => a*60 + b, 0);
}
function normalize(a){
  if (!a || typeof a !== "object") return null;
  if (a.summary && typeof a.summary === "object") a = { ...a.summary, ...a, total_elevation_gain: a.summary.elevation_gain ?? a.summary.total_elevation_gain, average_heartrate: a.summary.avg_heartrate ?? a.summary.average_heartrate ?? a.summary.avg_heart_rate };
  if (!a.start_date_local && a.start_local) a = { ...a, start_date_local: a.start_local };
  const sport = sportOf(a.sport_type ?? a.type ?? a.activity_type ?? a.sport ?? a.name);
  let dist = Number(a.distance ?? a.distance_m ?? 0);
  if (!dist && a.distance_km) dist = Number(a.distance_km) * 1000;
  const moving = toSec(a.moving_time ?? a.moving_s ?? a.elapsed_time ?? a.duration ?? 0);
  const date = a.start_date_local ?? a.start_date ?? a.date ?? a.startDate;
  if (!date || isNaN(new Date(date))) return null;
  return {
    id: String(a.id ?? a.activity_id ?? (date + sport + Math.round(dist))),
    date: new Date(String(date)).toISOString(),
    sport, name: String(a.name ?? SPORTS[sport]).slice(0, 80),
    dist: Math.round(dist), mov: Math.round(moving),
    hr: a.average_heartrate ?? a.hr_avg ?? a.avg_hr ?? null,
    elev: Math.round(Number(a.total_elevation_gain ?? a.elev_m ?? 0)) || 0
  };
}
function findActivityArray(x, depth = 0){
  if (depth > 5 || x == null) return null;
  if (typeof x === "string"){ try { return findActivityArray(JSON.parse(x), depth+1); } catch { return null; } }
  if (Array.isArray(x)){
    if (x.length && x.some(o => o && typeof o === "object" && ("distance" in o || "moving_time" in o || "sport_type" in o || "start_date" in o))) return x;
    for (const v of x){ const r = findActivityArray(v, depth+1); if (r) return r; }
    return x.length === 0 ? x : null;
  }
  if (typeof x === "object"){ for (const v of Object.values(x)){ const r = findActivityArray(v, depth+1); if (r) return r; } }
  return null;
}
function sameWorkout(a, b){
  return a.sport === b.sport && Math.abs(new Date(a.date) - new Date(b.date)) < 5*60e3 &&
    (Math.abs(a.dist - b.dist) <= Math.max(150, 0.06 * Math.max(a.dist, b.dist)) || Math.abs(a.mov - b.mov) < 180);
}
function mergeActivities(list, src){
  const map = new Map(S.activities.map(a => [a.id, a]));
  let added = 0;
  for (let a of list){
    if (!a) continue;
    if (src && !a.src) a.src = src;
    if (map.has(a.id)){ map.set(a.id, { ...map.get(a.id), ...a }); continue; }
    const dup = [...map.values()].find(b => sameWorkout(a, b));
    if (dup){ if (!dup.hr && a.hr) dup.hr = a.hr; dup.also = [...new Set([...(dup.also||[]), a.src].filter(Boolean))]; continue; }
    map.set(a.id, a); added++;
  }
  S.activities = [...map.values()].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 900);
  return added;
}

/* ---------- CSV (exportação Strava / Garmin Connect) ---------- */
function parseCSV(text){
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ","){ row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r"){ if (c === "\r" && text[i+1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function activitiesFromCSV(text){
  const rows = parseCSV(text); if (rows.length < 2) return [];
  const h = rows[0].map(s => s.trim().toLowerCase());
  const idx = (...names) => { for (const n of names){ const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const lastIdx = n => h.lastIndexOf(n);
  const strava = h.includes("activity id");
  const iId = idx("activity id"), iDate = idx("activity date","date","data"), iType = idx("activity type","tipo de atividade","sport"),
        iName = idx("activity name","title","título"), iMov = idx("moving time","tempo em movimento","time","tempo","elapsed time"),
        iHr = idx("average heart rate","avg hr","fc média","frequência cardíaca média"), iEl = idx("elevation gain","total ascent","ganho de elevação");
  const iDistM = strava && lastIdx("distance") !== h.indexOf("distance") ? lastIdx("distance") : -1;
  const iDist = idx("distance","distância");
  const out = [];
  for (const r of rows.slice(1)){
    const type = r[iType] ?? "", sport = sportOf(type);
    let dist = 0;
    const num = v => parseFloat(String(v ?? "").replace(/\./g, m => m).replace(/,(?=\d{3}\b)/g,"").replace(",", "."));
    if (iDistM >= 0 && r[iDistM]) dist = num(r[iDistM]);
    else if (iDist >= 0){ const v = num(r[iDist]); dist = sport === "swim" && v > 50 ? v : v * 1000; }
    let mov = toSec(r[iMov]);
    const a = normalize({ id: iId >= 0 ? r[iId] : undefined, date: parseLooseDate(r[iDate]), sport_type: type, name: r[iName], distance: dist||0, moving_time: mov, average_heartrate: num(r[iHr]) || null, total_elevation_gain: num(r[iEl]) || 0 });
    if (a) out.push(a);
  }
  return out;
}
function parseLooseDate(s){
  if (!s) return null; s = String(s).trim();
  const d = new Date(s); if (!isNaN(d)) return d.toISOString();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0)).toISOString();
  return null;
}

/* ---------- Garmin: arquivos .fit / .tcx / .gpx ---------- */
const FIT_EPOCH = 631065600;
const FIT_SPORT = { 1:"run", 2:"bike", 5:"swim", 10:"strength", 4:"other", 11:"other" };
function parseFIT(buf){
  const v = new DataView(buf), out = [];
  if (buf.byteLength < 14) return out;
  const hs = v.getUint8(0), dataSize = v.getUint32(4, true);
  if (String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11)) !== ".FIT") return out;
  const end = Math.min(hs + dataSize, buf.byteLength);
  const defs = {}; let p = hs;
  const read = (size, base, le) => {
    const t = base & 0x1f;
    if (size === 1){ const x = v.getUint8(p); return x === 0xFF ? null : x; }
    if (size === 2){ const x = v.getUint16(p, le); return x === 0xFFFF ? null : x; }
    if (size === 4){ const x = (t === 5 || t === 0x05) ? v.getInt32(p, le) : v.getUint32(p, le); return x === 0xFFFFFFFF || x === 0x7FFFFFFF ? null : x; }
    return null;
  };
  try {
    while (p < end){
      const h = v.getUint8(p++);
      let local, isDef = false, devFlag = false;
      if (h & 0x80){ local = (h >> 5) & 3; } else { local = h & 0x0f; isDef = !!(h & 0x40); devFlag = !!(h & 0x20); }
      if (isDef){
        p++; const le = v.getUint8(p++) === 0; const gnum = v.getUint16(p, le); p += 2;
        const n = v.getUint8(p++), fields = [];
        for (let i = 0; i < n; i++){ fields.push({ num: v.getUint8(p), size: v.getUint8(p+1), base: v.getUint8(p+2) }); p += 3; }
        let devSize = 0;
        if (devFlag){ const dn = v.getUint8(p++); for (let i = 0; i < dn; i++){ devSize += v.getUint8(p+1); p += 3; } }
        defs[local] = { le, gnum, fields, devSize };
      } else {
        const d = defs[local]; if (!d) break;
        const rec = {};
        for (const f of d.fields){ rec[f.num] = read(f.size, f.base, d.le); p += f.size; }
        p += d.devSize;
        if (d.gnum === 18 && rec[2] != null){
          out.push({ id: "fit" + rec[2] + "-" + (rec[5] ?? 0), date: new Date((rec[2] + FIT_EPOCH) * 1000).toISOString(),
            sport_type: FIT_SPORT[rec[5]] || "other", name: "Garmin " + (SPORTS[FIT_SPORT[rec[5]] || "other"]),
            distance: rec[9] != null ? rec[9] / 100 : 0, moving_time: (rec[8] ?? rec[7] ?? 0) / 1000,
            average_heartrate: rec[16], total_elevation_gain: rec[22] ?? 0 });
        }
      }
    }
  } catch (e) { console.warn("fit", e); }
  return out.map(x => { const a = normalize(x); if (a){ a.sport = x.sport_type === "strength" ? "strength" : a.sport; } return a; }).filter(Boolean);
}
function parseTCX(text){
  const out = [];
  for (const m of text.matchAll(/<Activity\s[^>]*Sport="([^"]*)"[^>]*>([\s\S]*?)<\/Activity>/g)){
    const body = m[2], id = (body.match(/<Id>([^<]+)<\/Id>/) || [])[1];
    const sum = re => [...body.matchAll(re)].reduce((s, x) => s + parseFloat(x[1]), 0);
    const hrs = [...body.matchAll(/<AverageHeartRateBpm>\s*<Value>(\d+)<\/Value>/g)].map(x => +x[1]);
    out.push(normalize({ id: "tcx" + id, date: id, sport_type: m[1], name: "Garmin " + m[1],
      distance: sum(/<Lap[\s\S]*?<DistanceMeters>([\d.]+)<\/DistanceMeters>/g), moving_time: sum(/<TotalTimeSeconds>([\d.]+)<\/TotalTimeSeconds>/g),
      average_heartrate: hrs.length ? hrs.reduce((a,b)=>a+b,0)/hrs.length : null }));
  }
  return out.filter(Boolean);
}
function parseGPX(text, fallbackName){
  const type = (text.match(/<type>([^<]+)<\/type>/) || [])[1] || fallbackName || "";
  const name = (text.match(/<trk>\s*<name>([^<]+)<\/name>/) || text.match(/<name>([^<]+)<\/name>/) || [])[1] || "Treino GPS";
  const pts = [...text.matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
    .map(m => ({ lat:+m[1], lon:+m[2], t:(m[3].match(/<time>([^<]+)<\/time>/)||[])[1] }));
  if (pts.length < 2) return [];
  let d = 0; const R = 6371e3, rad = x => x*Math.PI/180;
  for (let i = 1; i < pts.length; i++){ const a = pts[i-1], b = pts[i];
    const h = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2; d += 2*R*Math.asin(Math.sqrt(h)); }
  const t0 = pts.find(p => p.t)?.t, t1 = [...pts].reverse().find(p => p.t)?.t;
  return [normalize({ id: "gpx" + t0, date: t0, sport_type: type + " " + name, name, distance: d, moving_time: t0 && t1 ? (new Date(t1) - new Date(t0))/1000 : 0 })].filter(Boolean);
}

/* ---------- Apple Watch: exportação do app Saúde ---------- */
const HK = { Running:"run", Cycling:"bike", Swimming:"swim", TraditionalStrengthTraining:"strength", FunctionalStrengthTraining:"strength", CrossTraining:"strength", HighIntensityIntervalTraining:"strength", SwimBikeRun:"other" };
function parseAppleHealth(xml){
  const out = [], since = addDays(new Date(), -400);
  const attr = (s, k) => (s.match(new RegExp("\\b" + k + '="([^"]*)"')) || [])[1];
  const re = /<Workout\s([^>]*?)(\/?)>/g; let m;
  while ((m = re.exec(xml))){
    const a = m[1], typeRaw = (attr(a, "workoutActivityType") || "").replace("HKWorkoutActivityType", "");
    const sport = HK[typeRaw] || "other";
    const startRaw = attr(a, "startDate"); if (!startRaw) continue;
    const local = startRaw.slice(0, 19).replace(" ", "T");
    if (new Date(local) < since) continue;
    let body = "";
    if (!m[2]){ const e = xml.indexOf("</Workout>", re.lastIndex); if (e > 0) body = xml.slice(re.lastIndex, e); }
    let dist = parseFloat(attr(a, "totalDistance")) || 0, unit = attr(a, "totalDistanceUnit") || "km";
    if (!dist){ const st = body.match(/<WorkoutStatistics[^>]*type="HKQuantityTypeIdentifierDistance[A-Za-z]*"[^>]*>/);
      if (st){ dist = parseFloat(attr(st[0], "sum")) || 0; unit = attr(st[0], "unit") || "km"; } }
    const meters = unit === "km" ? dist*1000 : unit === "mi" ? dist*1609.34 : unit === "yd" ? dist*0.9144 : dist;
    const durU = attr(a, "durationUnit") || "min", dur = parseFloat(attr(a, "duration")) || 0;
    const hrS = body.match(/<WorkoutStatistics[^>]*type="HKQuantityTypeIdentifierHeartRate"[^>]*>/);
    const act = normalize({ id: "hk" + startRaw.replace(/\D/g, "") + typeRaw, date: local, sport_type: sport, name: "Apple Watch · " + (SPORTS[sport] || typeRaw),
      distance: meters, moving_time: durU === "min" ? dur*60 : durU === "hr" ? dur*3600 : dur,
      average_heartrate: hrS ? parseFloat(attr(hrS[0], "average")) || null : null });
    if (act){ act.sport = sport; out.push(act); }
  }
  return out;
}

/* ---------- leitura de arquivos (qualquer fonte) ---------- */
let zipLib = null;
function loadZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return zipLib ||= new Promise((ok, no) => { const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = () => ok(window.JSZip); s.onerror = () => no(new Error("zip")); document.head.append(s); });
}
async function parseFileBlob(name, getText, getBuf){
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "fit") return parseFIT(await getBuf());
  if (ext === "tcx") return parseTCX(await getText());
  if (ext === "gpx") return parseGPX(await getText(), name);
  if (ext === "csv") return activitiesFromCSV(await getText());
  if (ext === "xml"){ const t = await getText(); return /<HealthData/.test(t.slice(0, 5000)) || /<Workout\s/.test(t) ? parseAppleHealth(t) : []; }
  return [];
}
async function importFiles(files, src){
  busy("import_" + src, true); render();
  const acts = []; let skipped = 0;
  try {
    for (const f of files){
      if (/\.zip$/i.test(f.name)){
        const JSZip = await loadZip(); const zip = await JSZip.loadAsync(f);
        const entries = Object.values(zip.files).filter(e => !e.dir && /(export\.xml|\.fit|\.tcx|\.gpx|\.csv)$/i.test(e.name) && !/export_cda\.xml$/i.test(e.name));
        for (const e of entries.slice(0, 2000)){
          const r = await parseFileBlob(e.name, () => e.async("string"), () => e.async("arraybuffer"));
          acts.push(...r);
        }
        if (!entries.length) skipped++;
      } else {
        const r = await parseFileBlob(f.name, () => f.text(), () => f.arrayBuffer());
        if (!r.length) skipped++; acts.push(...r);
      }
    }
  } catch (e) {
    busy("import_" + src, false);
    flash("dados", /zip/.test(e?.message) ? "Não consegui abrir o .zip. Descompacte e envie o export.xml (Apple) ou os arquivos .fit (Garmin)." :
      "O arquivo é grande demais para o navegador. Para o Apple Saúde, envie só o export.xml descompactado; para o Garmin, envie menos arquivos por vez.", true);
    return;
  }
  busy("import_" + src, false);
  if (!acts.length){ flash("dados", src === "apple" ? "Não encontrei treinos. Envie o export.zip ou export.xml exportado pelo app Saúde do iPhone." : "Não encontrei treinos. Envie arquivos .fit, .tcx, .gpx ou o CSV de atividades do Garmin Connect.", true); return; }
  const added = mergeActivities(acts, src);
  S.sources = { ...(S.sources||{}), [src]: new Date().toISOString() };
  await save("activities", { list: S.activities, zones: S.zones, syncedAt: S.lastSync || null, sources: S.sources }); saveTeam();
  flash("dados", `${acts.length} treinos lidos de ${src === "apple" ? "Apple Watch" : "Garmin"}, ${added} novos (${acts.length - added} já existiam via outra fonte).`, false);
}

/* ---------- estatísticas ---------- */
function weeklyBuckets(n = 12){
  const start = addDays(mondayOf(new Date()), -7*(n-1));
  const weeks = Array.from({length:n}, (_, i) => ({ start: addDays(start, 7*i), swim:{d:0,t:0,c:0}, bike:{d:0,t:0,c:0}, run:{d:0,t:0,c:0}, other:{d:0,t:0,c:0} }));
  for (const a of S.activities){
    const i = Math.floor((mondayOf(a.date) - start) / (7*864e5));
    if (i >= 0 && i < n){ const b = weeks[i][a.sport] || weeks[i].other; b.d += a.dist; b.t += a.mov; b.c++; }
  }
  return weeks;
}
function sportStats(sport, days = 28){
  const since = addDays(new Date(), -days);
  const xs = S.activities.filter(a => a.sport === sport && new Date(a.date) >= since);
  const d = xs.reduce((s,a)=>s+a.dist,0), t = xs.reduce((s,a)=>s+a.mov,0);
  const longest = xs.reduce((m,a)=>a.dist>m.dist?a:m,{dist:0,mov:0});
  return { n: xs.length, d, t, perWeek: d/(days/7), longest };
}
/* Contexto enxuto para a IA: só o que muda a decisão, em texto curto (menos tokens, mesma informação). */
const DIAS_NOME = ["seg","ter","qua","qui","sex","sáb","dom"];
function profileForAI(){
  const p = S.profile || {};
  const out = { apelido: p.nick, nivel: p.level, peso_kg: p.peso, altura_cm: p.altura, horas_semana: p.hours, piscina: p.pool,
    dias_disponiveis: Array.isArray(p.days) ? p.days.map(d => DIAS_NOME[d]).join(",") : undefined,
    ponto_fraco: p.fraco, rolo: p.rolo, corrida_onde: p.corre, por_dia: p.porDia, fds_tudo: p.fds };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== ""));
}
const complaintsForAI = () => activeComplaints().map(c => ({ local: c.local, dor: c.intensidade, quando: c.quando, piora_com: c.agrava, desde: c.data }));
function summaryForAI(){
  // semanas sem treino viram "—"; números em texto curto
  const w = weeklyBuckets(8).map(x => { const parts = [x.swim.d && `nat ${Math.round(x.swim.d)}m/${Math.round(x.swim.t/60)}min`, x.bike.d && `bike ${fmtNum(x.bike.d/1000,1)}km/${Math.round(x.bike.t/60)}min`, x.run.d && `corr ${fmtNum(x.run.d/1000,1)}km/${Math.round(x.run.t/60)}min`].filter(Boolean);
    return `${dayKey(x.start)}: ${parts.join(", ") || "—"}`; });
  const s = sport => { const k = sportStats(sport, 28); return { sessoes_28d: k.n, volume_semana_medio: sport==="swim" ? `${Math.round(k.perWeek)} m` : `${(k.perWeek/1000).toFixed(1)} km`,
    ritmo: sport==="swim" ? paceSwim(k.d,k.t) : sport==="run" ? paceRun(k.d,k.t) : speedBike(k.d,k.t), mais_longo: fmtDist(sport, k.longest.dist) }; };
  return { semanas: w, ultimos_28_dias: { natacao: s("swim"), bike: s("bike"), corrida: s("run") }, total_atividades: S.activities.length };
}

/* ---------- capacidades ---------- */
const cap = name => (window.claude && window.claude.use) ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
const docRef = name => S.db && S.uid ? S.db.collection("data/users/" + S.uid).doc(name) : null;
/* Camada de dados: cada pessoa tem uma pasta própria na base do app (data/users/<id>/…),
   com um documento por assunto. Toda alteração é gravada na hora, em fila por documento. */
const DOCS = ["profile","activities","plan","chat","checkins","diet","weights"];
const queues = {}; let pending = 0;
function setSaveState(st){ S.saveState = st; const el = $("#savestate"); if (el){ el.dataset.st = st.k; el.textContent = st.t; } }
function save(name, data){
  const ref = docRef(name);
  if (!ref){ if (S.ready) setSaveState({ k:"off", t:"Não salvo: faça login de novo" }); return Promise.resolve(); }
  pending++; setSaveState({ k:"saving", t:"Salvando…" });
  queues[name] = (queues[name] || Promise.resolve()).then(() => ref.set({ ...data, _updatedAt: new Date().toISOString() }))
    .then(() => { if (--pending === 0) setSaveState({ k:"ok", t:"Salvo " + new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) }); })
    .catch(e => { pending = Math.max(0, pending-1); console.warn("save", name, e); setSaveState({ k:"err", t:"Erro ao salvar" });
      flash(S.view, `Não consegui salvar (${e?.code || "erro"}). Recarregue a página e tente de novo.`, true); });
  return queues[name];
}
async function exportMine(){
  const out = { app:"Transição", exportedAt: new Date().toISOString(), profile:S.profile, activities:S.activities, plan:S.plan, chat:S.chat, checkins:S.checkins, diet:S.diet, weights:S.weights };
  return offerDownload(`transicao-${(S.profile?.nick||"meus-dados").toLowerCase().replace(/\W+/g,"-")}-${dayKey(new Date())}.json`, out);
}
async function exportGroup(){
  if (!S.db) return;
  busy("export", true); render();
  const ids = S.team.map(t => t.__id), out = { app:"Transição", exportedAt: new Date().toISOString(), race: S.race, athletes: {} };
  for (const id of ids){
    const docs = await Promise.all(DOCS.map(n => S.db.collection("data/users/" + id).doc(n).get().catch(() => null)));
    out.athletes[id] = { nick: S.team.find(t => t.__id === id)?.nick || "", ...Object.fromEntries(DOCS.map((n, i) => [n, docs[i]?.exists ? docs[i].data() : null])) };
  }
  busy("export", false); render();
  return offerDownload(`transicao-grupo-${dayKey(new Date())}.json`, out);
}
async function offerDownload(filename, obj){
  const dl = await cap("downloads");
  if (!dl){ flash("dados", "Não consegui gerar o download.", true); return; }
  try { await dl.save({ filename, data: new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" }) }); flash("dados", "Arquivo gerado.", false); }
  catch (e) { if (e?.code !== "cancelled" && e?.code !== "declined") flash("dados", "Não consegui gerar o arquivo (" + (e?.code || "erro") + ").", true); }
}
/* ---------- competição: resumo público de cada participante (sem dados de saúde) ---------- */
function streakDays(){
  const days = new Set(S.activities.map(a => dayKey(a.date))); let n = 0, d = new Date();
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  while (days.has(dayKey(d))){ n++; d = addDays(d, -1); }
  return n;
}
function streakWeeks(){
  const w = weeklyBuckets(26); let n = 0;
  for (let i = w.length - 2; i >= 0; i--){ const c = w[i].swim.c + w[i].bike.c + w[i].run.c + w[i].other.c; if (c >= 4) n++; else break; }
  const cur = w[w.length-1]; if (cur.swim.c + cur.bike.c + cur.run.c + cur.other.c >= 4) n++;
  return n;
}
/* reconhecimentos: só aparecem quando os dados comprovam a evolução */
function highlights(){
  const out = [], now = Date.now(), d7 = addDays(new Date(), -7), d90 = addDays(new Date(), -97);
  const sd = streakDays(), sw = streakWeeks(), adh = adherence();
  if (sd >= 3) out.push({ k:"streak", t:`${sd} dias seguidos treinando`, d: sd >= 7 ? "Sequência de respeito. É essa constância que constrói o condicionamento." : "Boa sequência. Mantenha o ritmo, com os dias leves realmente leves." });
  if (sw >= 2) out.push({ k:"sem", t:`${sw} semanas seguidas com 4+ treinos`, d:"Consistência semana após semana é o que mais faz evoluir no triatlo." });
  if (adh != null && adh >= 85) out.push({ k:"plano", t:`${adh}% do plano cumprido`, d:"Você está fazendo exatamente o que o plano pede. Excelente disciplina." });
  if (dataQuality().enough){
    const f = fitnessSeries(42), n = f.at(-1).ctl, a = f[Math.max(0, f.length-29)].ctl;
    if (a > 1 && (n - a)/a >= 0.08) out.push({ k:"forma", t:`Condicionamento +${fmtNum((n-a)/a*100,1)}% em 4 semanas`, d:`Saiu de ${fmtNum(score(a),1)} para ${fmtNum(score(n),1)}. Seu corpo está respondendo ao treino.` });
  }
  const names = { swim:"natação", bike:"pedal", run:"corrida" };
  for (const sp of ["swim","bike","run"]){
    const recent = S.activities.filter(x => x.sport === sp && new Date(x.date) >= d7), prev = S.activities.filter(x => x.sport === sp && new Date(x.date) < d7 && new Date(x.date) >= d90);
    if (!recent.length || prev.length < 3) continue;
    const best = recent.reduce((m,x) => x.dist > m.dist ? x : m, recent[0]), prevBest = Math.max(...prev.map(x => x.dist));
    if (best.dist > prevBest * 1.03) out.push({ k:"pr-"+sp, t:`Maior ${names[sp]} dos últimos 3 meses`, d:`${fmtDist(sp, best.dist)} ${agoText(best.date)}. Recorde recente batido.` });
  }
  const cmp = compareRows().find(r => r.k === "Ritmo de corrida");
  if (cmp && cmp.a && cmp.b && (cmp.a - cmp.b)/cmp.a >= 0.03) out.push({ k:"pace", t:"Corrida mais rápida", d:`Ritmo médio de ${cmp.f(cmp.a)} para ${cmp.f(cmp.b)} em relação a 2 meses atrás.` });
  return out.slice(0, 4);
}
function highlightsHTML(){
  const h = highlights(); if (!h.length) return "";
  return `<section class="kudos-card"><div class="kc-head"><span class="eyebrow">Mandou bem</span><b>${h.length === 1 ? "Sua evolução desta semana" : "Você está evoluindo, e os números mostram"}</b></div>
    <ul>${h.map(x => `<li><b>${esc(x.t)}</b><span>${esc(x.d)}</span></li>`).join("")}</ul></section>`;
}
function computeBadges(){
  const b = [], wk = weeklyBuckets(1)[0], monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const m = sp => S.activities.filter(a => a.sport === sp && new Date(a.date) >= monthStart).reduce((s,a)=>s+a.dist,0);
  const byDay = {}; S.activities.filter(a => new Date(a.date) >= addDays(new Date(), -14)).forEach(a => (byDay[dayKey(a.date)] ||= new Set()).add(a.sport));
  if (wk.swim.c && wk.bike.c && wk.run.c) b.push({ k:"tri", t:"Tri da semana", d:"Nadou, pedalou e correu nesta semana" });
  if (Object.values(byDay).some(s => s.has("bike") && s.has("run")) || S.activities.some(a => a.sport === "brick" && new Date(a.date) >= addDays(new Date(), -14))) b.push({ k:"brick", t:"Brick", d:"Bike e corrida no mesmo dia nas últimas 2 semanas" });
  if (m("bike") >= 100000) b.push({ k:"cent", t:"Centenário", d:"100 km ou mais de bike no mês" });
  if (m("run") >= 42195) b.push({ k:"mara", t:"Maratona do mês", d:"42 km ou mais de corrida no mês" });
  if (m("swim") >= 5000) b.push({ k:"peixe", t:"Peixe", d:"5 km ou mais de natação no mês" });
  if (streakDays() >= 5) b.push({ k:"fogo", t:`${streakDays()} dias seguidos`, d:"Dias consecutivos treinando" });
  if (streakWeeks() >= 3) b.push({ k:"const", t:"Constância", d:`${streakWeeks()} semanas seguidas com 4+ treinos` });
  const adh = adherence(); if (adh != null && adh >= 90) b.push({ k:"plano", t:"No plano", d:"90%+ dos treinos do plano cumpridos" });
  return b;
}
const PERIODS = { dia:"Hoje", semana:"Semana", mes:"Mês", periodo:"Todo o período" };
const RANK_START = "2026-10-15"; // o ranking só conta treinos a partir deste dia
const rankStarted = () => dayKey(new Date()) >= RANK_START;
function periodStart(k){
  const t = new Date(new Date().toDateString()), min = new Date(RANK_START + "T00:00:00");
  const st = k === "dia" ? t : k === "semana" ? mondayOf(t) : k === "mes" ? new Date(t.getFullYear(), t.getMonth(), 1) : min;
  return st < min ? min : st;
}
function periodStats(){
  const enough = dataQuality().enough, fit = enough ? fitnessSeries(240) : null, out = {};
  for (const k of Object.keys(PERIODS)){
    const st = periodStart(k), xs = S.activities.filter(a => new Date(a.date) >= st && a.sport !== "other");
    const by = sp => xs.filter(a => a.sport === sp);
    const hours = xs.reduce((s,a)=>s+a.mov,0)/3600, days = Math.max(1, Math.ceil((Date.now() - st)/864e5));
    const sports = ["swim","bike","run"].filter(sp => by(sp).length).length;
    const points = Math.round(hours*10 + Math.min(xs.length, days*2)*5 + (sports === 3 ? 20 : 0));
    let formaIni = null;
    if (fit){ const i = fit.findIndex(p => p.d >= st); formaIni = i > 0 ? +score(fit[i-1].ctl).toFixed(1) : i === 0 ? +score(fit[0].ctl).toFixed(1) : null; }
    out[k] = { points, hours: +hours.toFixed(1), sessions: xs.length, swim_m: Math.round(by("swim").reduce((s,a)=>s+a.dist,0)),
      bike_km: +(by("bike").reduce((s,a)=>s+a.dist,0)/1000).toFixed(1), run_km: +(by("run").reduce((s,a)=>s+a.dist,0)/1000).toFixed(1),
      forma: fit ? +score(fit.at(-1).ctl).toFixed(1) : null, forma_ini: formaIni };
  }
  return out;
}
function saveTeam(){
  if (!S.db || !S.uid || !S.profile) return;
  const w = weeklyBuckets(1)[0], w12 = weeklyBuckets(12), monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const month = sp => S.activities.filter(a => a.sport === sp && new Date(a.date) >= monthStart).reduce((s,a)=>s+a.dist,0);
  const hours = (w.swim.t + w.bike.t + w.run.t + w.other.t)/3600, sessions = w.swim.c + w.bike.c + w.run.c + w.other.c;
  const adh = adherence();
  const fit = S.activities.length ? fitnessSeries(42) : null;
  const doc = { nick: S.profile.nick || "Atleta", level: S.profile.level || "",
    week: { swim_m: Math.round(w.swim.d), bike_km: +(w.bike.d/1000).toFixed(1), run_km: +(w.run.d/1000).toFixed(1), hours: +hours.toFixed(1), sessions },
    month: { swim_m: Math.round(month("swim")), bike_km: +(month("bike")/1000).toFixed(1), run_km: +(month("run")/1000).toFixed(1) },
    weeks12: w12.map(x => ({ s: Math.round(x.swim.t/60), b: Math.round(x.bike.t/60), r: Math.round(x.run.t/60), o: Math.round(x.other.t/60) })),
    points: 0, // preenchido abaixo com os pontos da semana contados a partir de RANK_START
    forma: fit && dataQuality().enough ? +score(fit.at(-1).ctl).toFixed(1) : null, forma4: fit && dataQuality().enough ? +score(fit[Math.max(0, fit.length-29)].ctl).toFixed(1) : null,
    streakDays: streakDays(), streakWeeks: streakWeeks(), adherence: adh, badges: computeBadges().map(b => ({ k:b.k, t:b.t, d:b.d })),
    recent: S.activities.slice(0, 6).map(a => ({ id: a.id, date: a.date, sport: a.sport, dist: a.dist, mov: a.mov, tipo: a.tipo || "" })),
    periods: periodStats(), updatedAt: new Date().toISOString() };
  doc.points = doc.periods.semana.points;
  S.db.collection("team").doc(S.uid).set(doc).catch(e => console.warn("team", e));
}

/* ---------- Strava ---------- */
const STRAVA = "Strava";
function mcpErrText(e){
  switch (e?.code){
    case "server_not_connected": return "O Strava ainda não está conectado na sua conta Claude. Adicione em claude.ai → Configurações → Conectores → Strava, depois volte aqui.";
    case "needs_reauth": return "A conexão com o Strava expirou. Reconecte em claude.ai → Configurações → Conectores.";
    case "selection_required": return "Você tem mais de uma conexão Strava. Escolha qual usar no aviso que o Claude mostrou e tente de novo.";
    case "not_in_manifest": case "consent_required": return "O acesso ao Strava foi recusado para esta página. Libere em Permissões do artefato e tente de novo.";
    case "blocked_by_policy": return "Sua organização bloqueou esse conector.";
    case "server_unavailable": return "O Strava não respondeu agora. Tente de novo em alguns segundos.";
    case "not_granted": case "capability_disabled": case "capability_removed": return "Esta visualização não permite conectores. Abra a página pelo claude.ai, logado.";
    case "tool_error": return "O Strava recusou a consulta: " + (e.message || "erro desconhecido");
    default: return "Não consegui falar com o Strava (" + (e?.code || "erro") + "). Tente de novo.";
  }
}
function parseStravaPage(res){
  const pl = typeof res.payload === "string" ? (()=>{ try { return JSON.parse(res.payload); } catch { return res.payload; } })() : res.payload;
  const arr = (pl && Array.isArray(pl.activities)) ? pl.activities : findActivityArray(pl);
  return { arr, cursor: pl && pl.has_next_page ? (pl.end_cursor || pl.pageInfo?.endCursor) : null, pl };
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no({ code:"timeout" }), ms))]);
async function persistSync(){
  S.sources = { ...(S.sources||{}), strava: new Date().toISOString() };
  S.lastSync = new Date().toISOString();
  await save("activities", { list: S.activities, zones: S.zones, syncedAt: S.lastSync, sources: S.sources });
  saveTeam();
}
async function syncStrava(){
  if (S.busy.strava) return;
  if (!window.TRI?.me?.strava?.connected){ flash(S.view, "Conecte seu Strava primeiro: Configurações → Conexões → Conectar meu Strava.", true); return; }
  busy("strava", true); S.msg[S.view] = { text: "Lendo seus treinos recentes do Strava…", err:false }; render();
  const errText = e => e?.code === "server_not_connected" ? "Conecte seu Strava primeiro." : e?.code === "needs_reauth" ? "A conexão com o Strava expirou. Conecte de novo em Configurações." : e?.code === "rate_limited" ? (e.message || "Limite atingido. Tente em alguns minutos.") : (e?.message || "Não consegui falar com o Strava.");
  try {
    const r = await TRI.api("/api/strava/activities?days=60&per_page=100");
    const all = (r.activities || []).map(normalize).filter(Boolean);
    const added = mergeActivities(all, "strava");
    await persistSync();
    busy("strava", false);
    flash(S.view, all.length ? `${all.length} treinos recentes lidos do Strava (${added} novos). Carregando o histórico em segundo plano…` : "Strava conectado, mas sem atividades nos últimos 60 dias.", false);
    (async () => {
      let total = 0;
      for (let p = 1; p <= 4; p++){
        const h = await TRI.api(`/api/strava/activities?days=200&before_days=60&per_page=100&page=${p}`);
        total += mergeActivities((h.activities || []).map(normalize).filter(Boolean), "strava");
        if (!h.has_more) break;
      }
      try { const z = await TRI.api("/api/strava/activities?zones=1"); S.zones = JSON.stringify(z.zones).slice(0, 1500); } catch {}
      await persistSync();
      flash(S.view, `Strava sincronizado: histórico carregado${total ? ` (+${total} treinos antigos)` : ""}.`, false);
      maybeReplan();
    })().catch(() => {});
  } catch (e) { busy("strava", false); flash(S.view, errText(e), true); }
}
function stravaActionHTML(){
  const c = window.TRI?.me?.strava?.connected;
  return c ? `<div class="row"><button class="btn" data-act="sync" ${S.busy.strava ? "disabled" : ""}>${S.busy.strava ? '<span class="spin"></span> Lendo' : "Sincronizar"}</button><button class="btn ghost sm" data-act="stravaoff">Desconectar</button></div>`
           : `<button class="btn" data-act="stravaon" style="background:#FC4C02;border-color:#FC4C02;color:#fff">Conectar meu Strava</button>`;
}
async function extractWithClaude(text){
  const sample = await cap("sample"); if (!sample) return [];
  const arr = await sample.json(`Extraia as atividades do texto abaixo. Responda só com um array JSON de objetos {"id":string,"date":"ISO 8601","sport_type":"Swim|Ride|Run|Other","name":string,"distance":metros,"moving_time":segundos,"average_heartrate":number|null,"total_elevation_gain":metros}.\n\nTexto:\n${text.slice(0, 60000)}`, { modelTier:"quick" }).catch(() => []);
  return Array.isArray(arr) ? arr.map(normalize).filter(Boolean) : [];
}

/* ---------- método de treino (base de evidências usada pelo gerador e pelo coach) ---------- */
function phaseFor(days){
  if (days == null) return { fase:"Base", nota:"sem data de prova" };
  const w = days / 7;
  if (w < 0) return { fase:"Transição", nota:"prova já passou: 1–2 semanas leves e sem estrutura" };
  if (w <= 2) return { fase:"Polimento", nota:"reduzir volume 40–60% e manter a intensidade" };
  if (w <= 6) return { fase:"Específico", nota:"sessões no ritmo de prova, bricks longos, simulação de prova" };
  if (w <= 16) return { fase:"Construção", nota:"aumentar limiar e VO2, manter o volume aeróbico" };
  return { fase:"Base", nota:"volume aeróbico, técnica de natação, força pesada, pouco trabalho forte" };
}
function athleteTier(){
  const h = Number(S.profile?.hours) || 6, lv = S.profile?.level || "iniciante";
  if (lv === "iniciante" || h < 6) return "A";
  if (lv === "avançado" && h >= 10) return "C";
  return "B";
}
const METODO = `MÉTODO DE TREINO DO APP (siga à risca)
ZONAS (5 zonas; sem lactímetro, controle por FC, pace/potência e esforço percebido 1-10):
Z1 recuperação (RPE 1-2) · Z2 aeróbico, conversa fácil (RPE 3-4, abaixo do 1º limiar) · Z3 moderado/tempo, ritmo de 70.3 (RPE 5-6) · Z4 limiar, ritmo de prova de ~1 h (RPE 7-8) · Z5 VO2máx (RPE 9).
DISTRIBUIÇÃO DE INTENSIDADE (por tempo):
- Base: piramidal, ~80% Z1-Z2, ~15% Z3, ~5% Z4-Z5.
- Construção/Específico: manter ≥75-80% fácil; o trabalho forte sobe. Para prova curta (sprint/olímpico) tende a polarizado (~80/5/15). Para 70.3/Ironman mantenha bastante Z3 específico (ritmo de prova), que em amadores se associa a melhor desempenho.
- O erro mais comum de amador é fazer os dias fáceis forte demais: dias fáceis são realmente fáceis.
MÉTODO NORUEGUÊS ADAPTADO: muito volume fácil + trabalho de limiar controlado ("sub-limiar": termina sentindo que faria mais 1-2 tiros; RPE 6-7; ex.: corrida 5-6x6 min ou 8-10x3 min com 1 min, bike 4-5x8-10 min com 2 min). Nunca acelerar além do prescrito. Duplo limiar no mesmo dia (bike longo de manhã + tiros curtos de corrida/natação à tarde) só para nível C, no máximo 1x/semana.
NÍVEIS DO ATLETA:
- A (iniciante ou <6 h/sem): consistência acima de tudo; no máximo 2 sessões de qualidade por semana somando as 3 modalidades; brick curto (bike + 10-15 min de corrida fácil); natação com muita técnica.
- B (intermediário, 6-10 h): 3 sessões de qualidade/semana (1 por modalidade), sendo 1-2 no formato sub-limiar; 1 brick/semana; 1 longão de bike e 1 de corrida.
- C (avançado, >10 h): 4-5 sessões de qualidade, pode usar 1 dia de duplo limiar; bricks longos na fase específica.
REGRAS DE CARGA:
- Ciclos 3:1 (3 semanas subindo, 1 de recuperação com -25 a -35% de volume).
- Volume semanal sobe no máximo ~10%; corrida é a modalidade de maior risco de lesão: crescer devagar, longão ≤ 30% do volume semanal de corrida, nunca 2 dias fortes de corrida seguidos. Use a bike para volume aeróbico extra.
- Dias fortes separados por dias fáceis; nada forte no dia seguinte ao longão.
NATAÇÃO: frequência importa mais que duração (3x/semana melhora, 2x mantém). Toda sessão tem educativos (técnica). Base do ritmo é o CSS (velocidade crítica): teste 400 m e 200 m forte; CSS = 200 / (T400 - T200) m/s. Séries de CSS: 8-15x100 no ritmo CSS com 10-15 s; resistência: 4-6x300-400 Z2-Z3. Inclua águas abertas/visada na fase específica se possível.
BIKE: maior parte em Z2 (cadência 85-95); limiar 2-4x8-20 min Z4; sweet spot/Z3 longo para 70.3/Ironman; VO2 5x3-5 min Z5 na construção para provas curtas. Longão no fim de semana.
CORRIDA: frequência 3-4x/semana em Z2; 1 sessão de qualidade (sub-limiar ou tempo); strides 4-6x20 s após corridas fáceis; longão progressivo.
BRICK (bike→corrida): especificidade comprovada para a transição; corrida curta depois da bike (10-30 min), no ritmo de prova na fase específica.
FORÇA: 2x/semana na base e construção, 1x/semana no específico, 0-1 leve no polimento. Começar 2-3 semanas com 8-12 reps (técnica), depois força pesada 3-4 séries de 3-6 reps (≥85% 1RM) + pliometria leve; benefícios em economia de corrida aparecem com ≥10 semanas. Exercícios-base: agachamento ou leg press, terra romeno/stiff, avanço/afundo, panturrilha em pé e sentado (sóleo), elevação de quadril, core anti-rotação, remada e manguito rotador. Faça a força no mesmo dia de uma sessão forte (depois dela) ou em dia fácil, nunca na véspera de um treino-chave.
TESTES: se não houver dados confiáveis, na semana 1 marque testes: CSS (natação), 20 min de bike (FTP ≈ 95% da potência média, ou FC média dos últimos 20 min = FC de limiar) e 30 min de corrida (FC média dos últimos 20 min = FC de limiar). Repita a cada 6-8 semanas.
POLIMENTO: 10-14 dias antes da prova (7 para sprint), volume -40 a -60%, frequência quase igual, mantenha alguns estímulos curtos de intensidade.
RECUPERAÇÃO: sono <6 h, sleep score <60, Body Battery <40, HRV abaixo do habitual ou cansaço ≥4 → transforme o treino forte do dia em Z1-Z2 ou descanso.`;

/* Instruções fixas do chat do coach (system em cache). Os dados do atleta vão na mensagem. */
const CHAT_SYS = () => `Você é o coach de triatlo dentro do app Transição. Responda em português do Brasil, curto e direto (até 6 frases, sem emoji), com números quando ajudar.
A cada mensagem do atleta chegam "Dados de hoje" entre colchetes: use-os, não invente números.
MOTIVAÇÃO: quando fizer sentido, reconheça as evoluções comprovadas com energia e números (sem exagerar).
RECUPERAÇÃO: sono < 6 h, sleep score < 60, HRV caindo, Body Battery < 40 ou cansaço ≥ 4 → sugira reduzir a intensidade do dia. Se o atleta mandar esses números (texto ou print do relógio), chame registrar_recuperacao e comente em 1–2 frases o impacto no treino de hoje.
TREINOS: treino feito sem relógio → registrar_treino (pergunte o esforço 1–10 se faltar). Esforço de treino já sincronizado → avaliar_esforco.
PESO: se informar o peso, registrar_peso. Comente de forma neutra e ligada ao desempenho; perda acima de ~1% do peso por semana é rápida demais para quem treina: recomende comer mais e procurar nutricionista.
ALIMENTAÇÃO: quando contar o que come, estime carboidrato, proteína e gordura, compare com os alvos (proteína ~1,6 g/kg; carboidrato 5–8 g/kg conforme o volume do dia), dê 2–3 ajustes práticos com alimentos brasileiros comuns (arroz, feijão, ovos, frango, iogurte, banana, tapioca, pão) e o que comer antes/durante/depois do treino. Chame registrar_alimentacao. Foque em abastecer o treino; nada de dietas restritivas. Objetivo de perda de peso → recomende nutricionista.
PLANO: use as ferramentas para ver atividades e semanas do plano. Só altere o plano se o atleta pedir ou concordar. Siga o método abaixo em toda recomendação.
DOR OU DESCONFORTO: não diagnostique. Faça 2–3 perguntas objetivas, uma por vez (onde e qual lado, intensidade 0–10, quando dói, há quanto tempo, se piorou após algum treino). Depois chame registrar_queixa, explique o ajuste em 2–3 frases, reduza a carga na modalidade que agrava (ajustar_dia_do_plano) e monte força de reabilitação progressiva com adicionar_treino_forca. Dor até 3/10 que não piora no dia seguinte é aceitável. Dor aguda, inchaço, estalo, dor em repouso ou piora por mais de 1 semana → fisioterapeuta ou médico do esporte. Em conversas seguintes, pergunte como a queixa evoluiu.
ACADEMIA sem dor: força específica para triatlo com adicionar_treino_forca.

${METODO}`;

/* Instruções fixas do plano: vão no "system" e ficam em cache na Anthropic (só a parte variável é cobrada inteira). */
const PLAN_SYS = `Você é um treinador de triatlo experiente acompanhando um atleta amador dia a dia, em português do Brasil.
Você planeja UMA semana por vez (segunda a domingo). Depois de cada treino feito ou perdido, o app te chama de novo para reajustar os dias restantes.

COMO AVALIAR E AJUSTAR:
- Compare planejado × feito: cumpriu? fez mais ou menos? esforço (1-10) acima do esperado para a zona? FC alta? dor?
- Treino perdido não se "paga" acumulando: redistribua com bom senso e mantenha o equilíbrio da semana (modalidades, dias fortes × fáceis).
- Esforço alto em treino fácil, dor, sono ruim ou cansaço → alivie. Tudo cumprido e com folga → progrida um pouco (respeitando +10%/semana).
- Nunca 2 dias fortes seguidos; nada forte depois do longão; corrida forte nunca em dias seguidos.
- Sessões com "movido_pelo_atleta": o atleta escolheu aquele dia. Mantenha a sessão nesse dia com "movido": true (pode ajustar volume/intensidade); só mude o dia se for claramente inseguro, e diga por quê na avaliação.

REGRAS:
- Respeite os dias disponíveis e as horas semanais. Dia indisponível = descanso (sessoes: []).
- Use rolo/esteira se o atleta tiver. Dê um pouco mais de frequência ao ponto fraco.
- Natação em metros com séries (ex: "10x100 no ritmo de prova, 15 s"). Bike e corrida em minutos com zona e esforço.
- TODA corrida (e a parte de corrida do brick) tem "pace" alvo em min/km, a partir dos ritmos reais do histórico e da zona. Nas etapas de corrida, cite o pace de cada parte (ex.: "6x3 min a 5:10/km, 1 min trote").
- Sem histórico ou sem testes: comece conservador e marque testes.
- Atleta amador: "titulo" sempre diz a modalidade e o que é, sem sigla solta (ex.: "Natação: teste de ritmo (400 m e 200 m)", não "Teste de CSS"). Em testes, as etapas explicam como fazer e o que anotar. Sigla técnica (CSS, FTP, Z2) só com explicação curta entre parênteses na primeira vez.
- Queixas: reduza impacto/volume na modalidade que agrava e inclua reabilitação progressiva na força (ex.: Aquiles → excêntrico/isométrico de panturrilha; dor ≤3/10 sem piora no dia seguinte é aceitável). Nunca diagnostique.

${METODO}

FORMATO: responda SÓ com JSON:
{"avaliacao":"2-3 frases ao atleta: como foram os últimos treinos (com números) e o que você ajustou. Sem treinos ainda: diga como vai começar.","resumo":"1 frase sobre a direção da semana","fase":"Base|Construção|Específico|Polimento","metodo":"1 frase: distribuição usada e por quê","distribuicao":{"leve":80,"moderado":15,"forte":5},"semana":{"foco":"curto","carga":"leve|moderada|alta|recuperação"},"dias":[{"data":"YYYY-MM-DD","sessoes":[{"sport":"swim|bike|run|brick|strength","titulo":"curto","movido":false,"min":60,"dist":"2.000 m | 30 km | vazio","pace":"6:10–6:30/km (só corrida/brick)","bike_min":0,"run_min":0,"zona":"Z2","etapas":[{"fase":"Aquecimento","min":10,"desc":"até 70 caracteres"}],"dica":"1 frase prática","exercicios":[{"nome":"","series":3,"reps":"15","carga":"","obs":""}]}]}]}
Descanso = sessoes: []. Brick: "min" é o total e "bike_min" + "run_min" a divisão. "exercicios" só em strength (4-7). "etapas" em toda sessão que não for força. Omita campos vazios.`;

/* ---------- plano por IA: a semana é gerada no domingo à noite e reajustada a cada treino feito ou perdido ---------- */
const WEEK_GEN_HOUR = 19; // domingo, a partir das 19h, gera a semana seguinte
const WEEK_GEN_TEXT = "Os treinos da semana são gerados no domingo, a partir das 19h, e reajustados a cada treino que você faz (ou perde).";
/** Janela a planejar: de hoje (ou amanhã, se já treinou) até domingo; no domingo à noite, a semana seguinte inteira. */
function planWindow(){
  const now = new Date(), hoje = new Date(now.toDateString());
  const treinouHoje = S.activities.some(a => dayKey(a.date) === dayKey(hoje) && a.sport !== "other");
  const domingoNoite = hoje.getDay() === 0 && now.getHours() >= WEEK_GEN_HOUR;
  const from = treinouHoje || domingoNoite ? addDays(hoje, 1) : hoje;
  const novaSemana = from.getDay() === 1 && dayKey(from) !== dayKey(mondayOf(hoje));
  return { hoje, from, to: addDays(mondayOf(from), 6), treinouHoje, domingoNoite, novaSemana, aberta: !novaSemana || domingoNoite };
}
function planStart(){ return mondayOf(new Date()); }
/** dia (YYYY-MM-DD) -> sessões, a partir da estrutura em semanas do plano */
function planDayMap(plan){
  const m = {}; if (!plan) return m;
  const st = new Date(plan.start + "T00:00:00");
  (plan.semanas||[]).forEach((w, wi) => (w.dias||[]).forEach(d => { if ((d.sessoes||[]).length) m[dayKey(addDays(st, wi*7 + d.dia))] = d.sessoes; }));
  return m;
}
function buildWeeks(start, map, oldWeeks, curWeek){
  const keys = Object.keys(map).sort(), last = keys.length ? new Date(keys.at(-1) + "T00:00:00") : start;
  const n = Math.max(1, Math.floor((mondayOf(last) - start) / (7*864e5)) + 1), cw = Math.floor((mondayOf(new Date()) - start) / (7*864e5));
  return Array.from({length:n}, (_, wi) => ({ n: wi+1, ...(wi >= cw && curWeek ? curWeek : { foco: oldWeeks?.[wi]?.foco || "", carga: oldWeeks?.[wi]?.carga || "" }),
    dias: Array.from({length:7}, (_, d) => ({ dia: d, sessoes: map[dayKey(addDays(start, wi*7 + d))] || [] })) }));
}
/** Planejado × feito nos últimos dias, para a IA avaliar antes de planejar */
function planVsDone(days){
  const map = planDayMap(S.plan), today = new Date(new Date().toDateString()), out = [];
  for (let off = -days; off <= 0; off++){
    const k = dayKey(addDays(today, off));
    const plan = (map[k] || []).filter(x => x.sport !== "rest").map(x => ({ sport: x.sport, titulo: x.titulo, min: x.min, zona: x.zona }));
    const feito = S.activities.filter(a => dayKey(a.date) === k).map(a => ({ sport: a.sport, nome: a.name, min: Math.round(a.mov/60), dist_km: a.dist ? +(a.dist/1000).toFixed(2) : null, fc_media: a.hr ? Math.round(a.hr) : null, esforco_1a10: a.rpe || null, tipo: a.tipo || null, dor: a.dor || null, obs: a.obs ? String(a.obs).slice(0, 140) : null }));
    if (plan.length || feito.length) out.push({ data: k, hoje: off === 0, planejado: plan, feito });
  }
  return out;
}
function recentActIds(){ const lim = addDays(new Date(), -14); return S.activities.filter(a => new Date(a.date) >= lim).map(a => a.id); }
/** Replanejar quando: acabou o horizonte, entrou treino novo, ou um treino planejado passou sem ser feito. */
function needsReplan(){
  if (!S.profile || S.busy.plan) return false;
  const w = planWindow(); if (!w.aberta) return false;
  if (!S.plan) return true;
  const todayK = dayKey(new Date());
  if (!S.plan.fim || S.plan.fim < dayKey(w.to)) return true;
  const seen = new Set(S.plan.basis || []);
  if (S.plan.basis && S.activities.some(a => a.sport !== "other" && new Date(a.date) >= addDays(new Date(), -3) && !seen.has(a.id))) return true;
  const gen = S.plan.genDay || todayK, map = planDayMap(S.plan);
  return Object.entries(map).some(([k, ss]) => k >= gen && k < todayK && ss.some(x => x.sport !== "rest" && !isDone(x, new Date(k + "T12:00:00"))));
}
let replanTriedAt = 0;
function maybeReplan(){
  if (!needsReplan() || Date.now() - replanTriedAt < 10*60e3) return;
  replanTriedAt = Date.now(); generatePlan({ auto: true });
}
async function generatePlan(opts = {}){
  if (!S.profile){ if (!opts.auto){ go("dados"); flash("dados","Preencha seu perfil antes de gerar o plano.", true); } return; }
  const sample = await cap("sample");
  if (!sample){ if (!opts.auto){ flash("plano","O gerador de plano está indisponível agora.", true); render(); } return; }
  if (S.busy.plan) return;
  busy("plan", true); render();
  const { hoje, from, to, treinouHoje, novaSemana, aberta } = planWindow();
  if (!aberta){ busy("plan", false); flash("plano", "Sua semana já terminou. " + WEEK_GEN_TEXT, false); return; }
  const nDias = Math.round((to - from) / 864e5) + 1;
  const dias = Array.from({length: nDias}, (_, i) => addDays(from, i));
  const fmtD = d => `${dayKey(d)} (${d.toLocaleDateString("pt-BR",{weekday:"long"})})`;
  const map = planDayMap(S.plan);
  const anteriores = Object.entries(map).filter(([k]) => k >= dayKey(from)).map(([data, ss]) => ({ data, sessoes: ss.map(x => ({ sport: x.sport, titulo: x.titulo, min: x.min, zona: x.zona, ...(x.movido ? { movido_pelo_atleta: true } : {}) })) }));
  const semanaAtual = (() => { const m = mondayOf(hoje), xs = S.activities.filter(a => new Date(a.date) >= m && a.sport !== "other"), by = sp => Math.round(xs.filter(a => a.sport === sp).reduce((t,a)=>t+a.mov,0)/60);
    return { desde: dayKey(m), treinos: xs.length, min_natacao: by("swim"), min_bike: by("bike"), min_corrida: by("run") + by("brick"), min_forca: by("strength") }; })();
  const prompt = `${novaSemana ? "TAREFA: domingo à noite, monte a semana que começa amanhã inteira, olhando como foi a semana que terminou." : "TAREFA: semana em andamento, replaneje só os dias que faltam a partir do que foi feito até agora."}
Hoje: ${hoje.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}.${treinouHoje ? " Já treinou hoje; comece amanhã." : ""}
Dias a planejar (exatamente ${nDias}, em ordem): ${dias.map(fmtD).join(", ")}.
Prova: ${JSON.stringify(raceForAI())} · faltam ${daysToRace()} dias · fase ${JSON.stringify(phaseFor(daysToRace()))} · nível no método ${athleteTier()}
Atleta: ${JSON.stringify(profileForAI())}
Preferência por dia: ${({ "1":"no máximo 1 modalidade por dia", "2":"no máximo 2 sessões por dia", "1+gym":"1 modalidade por dia; força pode ser no mesmo dia", "todas":"pode combinar várias sessões no dia" })[S.profile?.porDia] || "não informada"} · fim de semana/feriado: ${S.profile?.fds === "Sim" ? "pode juntar modalidades (longão, brick)" : "mesma regra"}
Queixas ativas: ${JSON.stringify(complaintsForAI())}
Planejado × feito (7 dias): ${JSON.stringify(planVsDone(7))}
Semana até agora: ${JSON.stringify(semanaAtual)}
Previsto antes para estes dias: ${JSON.stringify(anteriores)}
Histórico: ${JSON.stringify(summaryForAI())}
${S.zones ? "Zonas: " + S.zones : ""}
Recuperação (7 dias): ${JSON.stringify((S.checkins||[]).slice(-7))}
Condicionamento: ${JSON.stringify(fitnessForAI())}`;
  try {
    const r = await sample.json(prompt, { modelTier: "complex", system: PLAN_SYS });
    if (!r || !Array.isArray(r.dias)) throw { code:"invalid_json" };
    const fromK = dayKey(from), toK = dayKey(to);
    Object.keys(map).forEach(k => { if (k >= fromK) delete map[k]; });
    r.dias.forEach(d => { if (d?.data >= fromK && d.data <= toK) map[d.data] = (d.sessoes || []).filter(x => x && x.sport !== "rest"); });
    const start = S.plan?.start ? new Date(S.plan.start + "T00:00:00") : planStart();
    const { dias: _d, semana, ...meta } = r;
    S.plan = { ...meta, start: dayKey(start), inicio: S.plan?.inicio || dayKey(hoje), fim: toK, rolling: true,
      semanas: buildWeeks(start, map, S.plan?.semanas, semana), genDay: dayKey(hoje), basis: recentActIds(),
      createdAt: S.plan?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    S.week = Math.max(0, Math.min(Math.floor((mondayOf(hoje) - start) / (7*864e5)), S.plan.semanas.length - 1));
    await save("plan", S.plan);
    flash("plano", novaSemana ? "Treinos da semana gerados." : opts.auto ? "Treinos restantes da semana reajustados a partir do que você fez." : "Treinos da semana planejados.", false);
    coachNote(true);
  } catch (e) {
    flash("plano", e?.code === "ai_off" ? "A IA está desligada: falta configurar a chave ANTHROPIC_API_KEY na Vercel." : e?.code === "not_granted" ? "Você precisa permitir que esta página use o Claude para gerar o plano." :
      e?.code === "rate_limited" ? "Muitas gerações em sequência. Espere um minuto e tente de novo." :
      e?.code === "invalid_json" ? "O plano veio incompleto. Tente gerar de novo." : "Não consegui gerar o plano (" + (e?.code || "erro") + ").", true);
  }
  busy("plan", false); render();
}
function planDate(w, d){ return addDays(new Date(S.plan.start + "T00:00:00"), w*7 + d); }
function activeComplaints(){ return (S.profile?.complaints || []).filter(c => !c.resolvido); }
/* Treino realizado = atividade que cumpre uma sessão do plano naquele dia. O resto é "atividade fora do plano". */
const sportFits = (sess, a) => a.sport === sess.sport || (sess.sport === "brick" && (a.sport === "bike" || a.sport === "run" || a.sport === "brick"));
let _mm = { key:"", sessToAct:new Map(), actToSess:new Map() };
function planMatches(){
  const key = (S.plan?.updatedAt || S.plan?.createdAt || "") + (S.plan?.editedAt || "") + "|" + S.activities.length + "|" + (S.activities[0]?.id || "") + "|" + S.activities.filter(a => a.planRef).length;
  if (_mm.key === key) return _mm;
  const sessToAct = new Map(), actToSess = new Map();
  if (S.plan){
    const today = dayKey(new Date()), byDay = {};
    S.activities.forEach(a => (byDay[dayKey(a.date)] ||= []).push(a));
    S.plan.semanas.forEach((w, wi) => (w.dias||[]).forEach(d => {
      const date = planDate(wi, d.dia), k = dayKey(date);
      if (k > today || (S.plan.inicio && k < S.plan.inicio)) return;
      const acts = (byDay[k] || []).filter(a => a.sport !== "other");
      (d.sessoes||[]).forEach((sess, i) => {
        if (sess.sport === "rest") return;
        const ref = `${wi}.${d.dia}.${i}`;
        let a = acts.find(x => x.planRef && x.planRef === `${wi}-${d.dia}-${i}` && !actToSess.has(x.id));
        if (!a) a = acts.find(x => !actToSess.has(x.id) && !x.planRef && sportFits(sess, x));
        if (a){ sessToAct.set(ref, a.id); actToSess.set(a.id, ref); }
      });
    }));
  }
  _mm = { key, sessToAct, actToSess };
  return _mm;
}
const isPlanned = a => planMatches().actToSess.has(a.id);
function isDone(sess, date){
  if (!sess || sess.sport === "rest") return false;
  const ref = planRefOf(sess); if (ref) return planMatches().sessToAct.has(ref);
  const k = dayKey(date); return S.activities.some(a => dayKey(a.date) === k && sportFits(sess, a));
}
function adherence(){
  if (!S.plan) return null;
  let due = 0, done = 0; const today = new Date(); today.setHours(23,59,59);
  S.plan.semanas.forEach((w, wi) => (w.dias||[]).forEach(d => {
    const date = planDate(wi, d.dia); if (date > today || (S.plan.inicio && dayKey(date) < S.plan.inicio)) return;
    (d.sessoes||[]).forEach(s => { if (s.sport === "rest") return; due++; if (isDone(s, date)) done++; });
  }));
  return due ? Math.round(done/due*100) : null;
}

/* ---------- coach ---------- */
async function coachNote(force){
  if (!S.profile || (!S.activities.length && !S.plan)) return;
  if (!force && S.profile.noteObj && S.profile.noteAt && (Date.now() - new Date(S.profile.noteAt)) < 6*3600e3) return;
  const sample = await cap("sample"); if (!sample) return;
  busy("note", true); render();
  try {
    const r = await sample.json(`Você é o treinador de triatlo de ${S.profile.nick || "um atleta"}. Hoje é ${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}.
Prova: ${JSON.stringify(raceForAI())}
Perfil: ${JSON.stringify(profileForAI())}
Dados: ${JSON.stringify(summaryForAI())}
Condicionamento (modelo de carga): ${JSON.stringify(fitnessForAI())}
Antes (8 semanas atrás) vs agora (últimas 4 semanas): ${JSON.stringify(compareRows().map(r => ({ indicador: r.k, antes: r.a ? r.f(r.a) : null, agora: r.b ? r.f(r.b) : null })))}
Recuperação (check-ins recentes): ${JSON.stringify((S.checkins||[]).slice(-7))}
Próximo treino: ${JSON.stringify(nextSession()?.sessions || [])}
Evoluções comprovadas: ${JSON.stringify(highlights().map(x => x.t))}
Se houver evolução comprovada, o primeiro ponto deve reconhecer isso com entusiasmo e o número (tipo "bom"). Não elogie o que não está nos dados.
Use só os números acima; se um dado não existir, não cite. Português do Brasil, frases curtas, sem emoji, sem jargão sem explicação.
Responda SÓ com JSON:
{"resumo":"1 frase: como está hoje",
 "pontos":[{"titulo":"2 a 4 palavras","texto":"1 frase com o número que comprova (ex.: Corrida subiu de 8,0 para 12,4 km/semana)","tipo":"bom|atencao|neutro"}],
 "foco":"1 frase: o que fazer no próximo treino (e como adaptar se o sono/cansaço de hoje estiver ruim)"}
"pontos" tem de 2 a 4 itens. O "resumo" deve ser simples, como: "Você está construindo base: treina mais horas que há 2 meses, mas a natação ainda está parada." Não repita a tabela de números; interprete.`, { modelTier:"quick" });
    S.profile = { ...S.profile, noteObj: r, note: [r.resumo, ...(r.pontos||[]).map(p => p.texto), r.foco].filter(Boolean).join(" "), noteAt: new Date().toISOString() };
    save("profile", S.profile);
  } catch {}
  busy("note", false); render();
}
function changeSentence(r){
  if (!r.a && r.b) return { t: r.k, d: `começou agora: ${r.f(r.b)}`, k: "bom" };
  if (r.a && !r.b) return { t: r.k, d: `parou: era ${r.f(r.a)}`, k: "at" };
  const pct = (r.b - r.a) / r.a * 100, better = r.up ? pct > 0 : pct < 0;
  if (Math.abs(pct) < 2) return { t: r.k, d: `estável em ${r.f(r.b)}`, k: "ne" };
  const verb = r.up ? (pct > 0 ? "subiu" : "caiu") : (pct < 0 ? "melhorou" : "piorou");
  return { t: r.k, d: `${verb} de ${r.f(r.a)} para ${r.f(r.b)} (${pct > 0 ? "+" : "−"}${fmtNum(Math.abs(pct),0)}%)`, k: better ? "bom" : "at" };
}
function coachReadHTML(p, rows){
  const perfil = [p.level ? `Atleta ${p.level}` : "Atleta", p.peso ? `${fmtNum(p.peso,1)} kg` : null, p.hours ? `${fmtNum(p.hours,1)} h/semana disponíveis` : null, p.fraco && p.fraco !== "Nenhum" ? `ponto fraco: ${p.fraco.toLowerCase()}` : null].filter(Boolean).join(" · ");
  const ch = rows.map(changeSentence).slice(0, 6);
  const o = p.noteObj;
  return `<div class="cr">
    <div class="cr-block"><div class="eyebrow">Quem é você hoje</div><p class="cr-perfil">${esc(perfil)}${S.activities.length && dataQuality().enough ? ` · condicionamento ${fmtNum(score(fitnessSeries(42).at(-1).ctl),1)}/100` : ""}</p></div>
    ${ch.length ? `<div class="cr-block"><div class="eyebrow">O que mudou nas últimas 4 semanas</div><ul class="cn-list">${ch.map(c => `<li class="t-${c.k}"><b>${esc(c.t)}</b><span>${esc(c.d)}</span></li>`).join("")}</ul></div>` : ""}
    ${o?.resumo ? `<div class="cr-block"><div class="eyebrow">Análise</div><p class="cn-sum">${esc(o.resumo)}</p>${(o.pontos||[]).filter(x => x.tipo === "atencao").slice(0,2).map(x => `<p class="cr-att"><b>${esc(x.titulo)}:</b> ${esc(x.texto)}</p>`).join("")}</div>` : ""}
    ${o?.foco ? `<div class="cn-foco"><span class="eyebrow">Foco do próximo treino</span><p>${esc(o.foco)}</p></div>` : !o && S.busy.note ? `<p class="note">Analisando sua evolução…</p>` : !o ? `<p class="note">Clique em Atualizar para o coach analisar seus números.</p>` : ""}
    ${p.noteAt && o ? `<div class="note">Análise atualizada ${agoText(p.noteAt)}</div>` : ""}
  </div>`;
}
function coachNoteHTML(p){
  const o = p.noteObj;
  if (!o || !Array.isArray(o.pontos)) return `<p style="margin:0">${esc(p.note)}</p>`;
  return `<div class="cnote">
    ${o.resumo ? `<p class="cn-sum">${esc(o.resumo)}</p>` : ""}
    <ul class="cn-list">${o.pontos.slice(0,4).map(x => `<li class="t-${x.tipo === "bom" ? "bom" : x.tipo === "atencao" ? "at" : "ne"}"><b>${esc(x.titulo || "")}</b><span>${esc(x.texto || "")}</span></li>`).join("")}</ul>
    ${o.foco ? `<div class="cn-foco"><span class="eyebrow">Foco do próximo treino</span><p>${esc(o.foco)}</p></div>` : ""}
    ${p.noteAt ? `<div class="note">Atualizado ${agoText(p.noteAt)}</div>` : ""}
  </div>`;
}
function todaySessions(){
  if (!S.plan) return [];
  const diff = Math.floor((mondayOf(new Date()) - new Date(S.plan.start + "T00:00:00")) / (7*864e5));
  const w = S.plan.semanas[diff]; if (!w) return [];
  const d = (w.dias||[]).find(x => x.dia === (new Date().getDay()+6)%7);
  return d ? d.sessoes || [] : [];
}
const chatTools = [
  { name:"listar_atividades", description:"Lista atividades reais do atleta. Use para responder sobre treinos específicos.",
    inputSchema:{ type:"object", properties:{ sport:{type:"string", enum:["swim","bike","run","all"]}, dias:{type:"integer", description:"últimos N dias"} } },
    execute: ({ sport = "all", dias = 30 }) => { const since = addDays(new Date(), -Math.min(dias, 365));
      return S.activities.filter(a => new Date(a.date) >= since && (sport === "all" || a.sport === sport)).slice(0, 80)
        .map(a => { const o = { data: dayKey(a.date), categoria: isPlanned(a) ? "treino do plano" : "atividade fora do plano", sport: a.sport, nome: a.name, dist: fmtDist(a.sport, a.dist), tempo: fmtDur(a.mov), fc: a.hr, ritmo: a.sport==="run"?paceRun(a.dist,a.mov):a.sport==="swim"?paceSwim(a.dist,a.mov):speedBike(a.dist,a.mov), esforco: a.rpe, carga: Math.round(loadOf(a)) };
          for (const k of ["tipo","local","cumpriu","feel","clima","watts","cadencia","terreno","series","forca","pre","carbo_g","agua_ml","dor","obs"]) if (a[k] != null && a[k] !== "") o[k] = a[k];
          return o; }); } },
  { name:"ver_semana_do_plano", description:"Retorna uma semana do plano (1 a 4).",
    inputSchema:{ type:"object", properties:{ semana:{type:"integer"} }, required:["semana"] },
    execute: ({ semana }) => S.plan ? (S.plan.semanas[semana-1] || "semana inexistente") : "sem plano gerado" },
  { name:"ajustar_dia_do_plano", description:"Substitui as sessões de um dia do plano. Use só quando o atleta pedir ou concordar com uma mudança.",
    inputSchema:{ type:"object", properties:{ semana:{type:"integer"}, dia:{type:"integer", description:"0=segunda ... 6=domingo"},
      sessoes:{ type:"array", items:{ type:"object", properties:{ sport:{type:"string"}, titulo:{type:"string"}, min:{type:"integer"}, dist:{type:"string"}, zona:{type:"string"}, detalhe:{type:"string"} } } } }, required:["semana","dia","sessoes"] },
    execute: ({ semana, dia, sessoes }) => {
      if (!S.plan) throw new Error("sem plano");
      const w = S.plan.semanas[semana-1]; if (!w) throw new Error("semana inexistente");
      const d = (w.dias ||= []).find(x => x.dia === dia);
      if (d) d.sessoes = sessoes; else w.dias.push({ dia, sessoes });
      save("plan", S.plan); S.chatChangedPlan = true;
      return "ok, plano atualizado";
    } },
  { name:"registrar_queixa", description:"Registra ou atualiza uma dor/desconforto relatado pelo atleta, depois de perguntar os detalhes.",
    inputSchema:{ type:"object", properties:{ local:{type:"string", description:"ex: tendão de Aquiles direito"}, intensidade:{type:"integer", description:"0 a 10"},
      quando:{type:"string", description:"quando dói: início do treino, durante, depois, manhã seguinte, ao subir escada…"}, desde:{type:"string"}, agrava:{type:"string", description:"modalidades ou movimentos que pioram"}, obs:{type:"string"} }, required:["local","intensidade"] },
    execute: (q) => {
      S.profile = S.profile || {}; const list = S.profile.complaints ||= [];
      const ex = list.find(c => !c.resolvido && c.local.toLowerCase() === String(q.local).toLowerCase());
      const entry = { ...q, data: dayKey(new Date()) };
      if (ex){ ex.historico = [...(ex.historico||[]), { data: entry.data, intensidade: q.intensidade }].slice(-20); Object.assign(ex, entry); }
      else list.push({ ...entry, id: "q" + Date.now(), historico: [{ data: entry.data, intensidade: q.intensidade }] });
      save("profile", S.profile); S.chatChangedBody = true;
      return "registrado";
    } },
  { name:"adicionar_treino_forca", description:"Adiciona uma sessão de força/academia ao plano num dia específico (mantém as outras sessões do dia).",
    inputSchema:{ type:"object", properties:{ semana:{type:"integer"}, dia:{type:"integer", description:"0=segunda ... 6=domingo"}, titulo:{type:"string"}, min:{type:"integer"}, detalhe:{type:"string"},
      exercicios:{ type:"array", items:{ type:"object", properties:{ nome:{type:"string"}, series:{type:"integer"}, reps:{type:"string"}, carga:{type:"string"}, obs:{type:"string"} }, required:["nome"] } } }, required:["semana","dia","titulo","exercicios"] },
    execute: ({ semana, dia, titulo, min, detalhe, exercicios }) => {
      if (!S.plan) throw new Error("sem plano gerado; peça ao atleta para gerar o plano primeiro");
      const w = S.plan.semanas[semana-1]; if (!w) throw new Error("semana inexistente");
      let d = (w.dias ||= []).find(x => x.dia === dia); if (!d){ d = { dia, sessoes:[] }; w.dias.push(d); }
      d.sessoes = (d.sessoes||[]).filter(s => s.sport !== "rest");
      d.sessoes.push({ sport:"strength", titulo, min: min || 40, detalhe: detalhe || "", exercicios });
      save("plan", S.plan); S.chatChangedPlan = true;
      return "sessão adicionada";
    } },
  { name:"registrar_recuperacao", description:"Salva dados de recuperação que o atleta informou (sleep score, horas de sono, Body Battery, HRV, FC de repouso, estresse, cansaço). Use sempre que ele mandar esses números, por texto ou print.",
    inputSchema:{ type:"object", properties:{ data:{type:"string", description:"YYYY-MM-DD; omita para hoje"}, sono:{type:"number", description:"horas"}, score:{type:"integer", description:"sleep score 0-100"},
      bb:{type:"integer", description:"Body Battery 0-100"}, hrv:{type:"integer", description:"ms"}, rhr:{type:"integer", description:"FC de repouso"}, stress:{type:"integer", description:"estresse 0-100"}, qual:{type:"integer", description:"qualidade do sono 1-5"}, cans:{type:"integer", description:"cansaço 1-5"}, obs:{type:"string"} } },
    execute: (x) => { const c = saveRecovery(x); S.chatNotes.push("Recuperação salva"); return c; } },
  { name:"registrar_treino", description:"Registra um treino feito sem relógio, contado pelo atleta. Pergunte o esforço (1-10) se ele não disser.",
    inputSchema:{ type:"object", properties:{ sport:{type:"string", enum:["run","bike","swim","strength","brick","other"]}, data:{type:"string", description:"YYYY-MM-DD; omita para hoje"},
      min:{type:"integer"}, dist_m:{type:"number", description:"distância em metros"}, rpe:{type:"integer", description:"esforço percebido 1-10"}, sensacao:{type:"string"},
      tipo:{type:"string", description:"ex: rodagem leve, longão, intervalado, limiar, técnica, força pesada"}, local:{type:"string"}, series:{type:"string"},
      forca:{type:"array", items:{type:"object", properties:{ nome:{type:"string"}, series:{type:"integer"}, reps:{type:"string"}, kg:{type:"number"} }}},
      dor:{type:"object", properties:{ onde:{type:"string"}, nivel:{type:"integer"}, quando:{type:"string"} }}, carbo_g:{type:"integer"}, obs:{type:"string", description:"o que foi feito"} }, required:["sport","min"] },
    execute: (x) => { const a = addManualWorkout({ ...x, date: x.data, dist: x.dist_m, feel: x.sensacao });
      if (!a) throw new Error("dados inválidos"); S.chatNotes.push("Treino registrado"); return { salvo: true, carga_pts: Math.round(loadOf(a)) }; } },
  { name:"avaliar_esforco", description:"Salva o esforço percebido (1-10) de um treino já sincronizado. Identifique pela data e modalidade.",
    inputSchema:{ type:"object", properties:{ data:{type:"string", description:"YYYY-MM-DD"}, sport:{type:"string"}, rpe:{type:"integer"} }, required:["rpe"] },
    execute: ({ data, sport, rpe }) => {
      const a = S.activities.find(x => (!data || dayKey(x.date) === data) && (!sport || x.sport === sport)); if (!a) throw new Error("treino não encontrado");
      a.rpe = Math.max(1, Math.min(10, rpe)); persistActivities(); S.chatNotes.push("Esforço salvo"); return { treino: a.name, data: dayKey(a.date), rpe: a.rpe }; } },
  { name:"registrar_peso", description:"Registra o peso (kg) que o atleta informou, para o acompanhamento semanal.",
    inputSchema:{ type:"object", properties:{ kg:{type:"number"}, data:{type:"string", description:"YYYY-MM-DD; omita para hoje"} }, required:["kg"] },
    execute: ({ kg, data }) => { const w = addWeight(kg, data); if (!w) throw new Error("peso inválido"); S.chatNotes.push("Peso registrado"); return { salvo: w, resumo: weightStats() }; } },
  { name:"registrar_alimentacao", description:"Salva o que o atleta disse que comeu (um dia ou uma refeição) com a sua estimativa de macros.",
    inputSchema:{ type:"object", properties:{ data:{type:"string"}, descricao:{type:"string"}, kcal:{type:"integer"}, carbo_g:{type:"integer"}, proteina_g:{type:"integer"}, gordura_g:{type:"integer"}, dica:{type:"string", description:"principal ajuste sugerido"} }, required:["descricao"] },
    execute: (x) => { addDietEntry({ data: x.data, texto: x.descricao, est: { kcal: x.kcal, carbo_g: x.carbo_g, proteina_g: x.proteina_g, gordura_g: x.gordura_g }, dicas: x.dica ? [x.dica] : [] }); S.chatNotes.push("Alimentação registrada"); return "ok"; } }
];
let chatCtl = null;
async function sendChat(text){
  text = text.trim(); if (!text || S.busy.chat) return;
  const sample = await cap("sample");
  if (!sample){ S.chat.push({ r:"sys", t:"O coach está indisponível agora." }); render(); return; }
  const img = S.pendingImg; S.pendingImg = null;
  S.chat.push({ r:"u", t: text + (img ? "\n[print anexado]" : "") }); S.chat.push({ r:"a", t:"" });
  busy("chat", true); render(); scrollChat();
  const ctx = `[Dados de hoje (${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})})
Prova: ${JSON.stringify(raceForAI())} · fase ${JSON.stringify(phaseFor(daysToRace()))} · nível ${athleteTier()}
Atleta: ${JSON.stringify(profileForAI())}
Histórico: ${JSON.stringify(summaryForAI())}
Plano: ${S.plan ? `fase ${S.plan.fase}, aderência ${adherence() ?? "—"}%. Hoje: ${JSON.stringify(todaySessions().map(x => ({ sport: x.sport, titulo: x.titulo, min: x.min, zona: x.zona })))}` : "nenhum plano gerado ainda"}
Queixas: ${JSON.stringify(complaintsForAI())}
Condicionamento: ${JSON.stringify(fitnessForAI())}
Recuperação (7 dias): ${JSON.stringify((S.checkins||[]).slice(-7))}
Evoluções comprovadas: ${JSON.stringify(highlights().map(x => x.t))}
Peso semanal: ${JSON.stringify((S.weights||[]).slice(-8).map(w => [w.data, w.kg]))}
Alimentação: alvos de hoje ${JSON.stringify(dietTargets())}; recentes ${JSON.stringify((S.diet||[]).slice(-3).map(d => ({ data: d.data, texto: d.texto.slice(0, 200), est: d.est })))}]`;
  const hist = S.chat.filter(m => m.r !== "sys").slice(0, -2).slice(-12);
  const msgs = [];
  for (const m of hist){ const role = m.r === "u" ? "user" : "assistant"; if (msgs.length && msgs[msgs.length-1].role === role) msgs[msgs.length-1].content += "\n" + m.t; else if (m.t) msgs.push({ role, content: m.t }); }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length && msgs[msgs.length-1].role === "user") msgs.push({ role:"assistant", content:"Certo." });
  msgs.push({ role:"user", content: ctx + "\n\n" + text + (img ? "\n\n(O atleta anexou um print, provavelmente do Garmin Connect, app Saúde ou de uma refeição. Leia os números e registre com a ferramenta certa.)" : "") });
  chatCtl = new AbortController();
  const bubble = S.chat[S.chat.length-1];
  try {
    S.chatNotes = [];
    const r = await sample(msgs, { cache:false, system: CHAT_SYS(), signal: chatCtl.signal, tools: chatTools, ...(img ? { images: [img] } : {}),
      onText: ({ text }) => { bubble.t = text; const el = $("#msgs .msg.a:last-child"); if (el) el.textContent = text; scrollChat(); } });
    bubble.t = r.text;
    for (const n of new Set(S.chatNotes)) S.chat.push({ r:"sys", t: n + "." }); S.chatNotes = [];
    if (S.chatChangedPlan){ S.chat.push({ r:"sys", t:"Plano atualizado pelo coach." }); S.chatChangedPlan = false; }
    if (S.chatChangedBody){ S.chat.push({ r:"sys", t:"Queixa registrada no seu perfil." }); S.chatChangedBody = false; }
  } catch (e) {
    bubble.t = e?.text || "";
    S.chat.push({ r:"sys", t: e?.code === "not_granted" ? "Sessão expirada. Entre de novo." : e?.code === "rate_limited" ? "Muitas mensagens seguidas. Espere um pouco." : e?.code === "cancelled" ? "Resposta interrompida." : "Não consegui responder (" + (e?.code || "erro") + ")." });
  }
  S.chat = S.chat.filter(m => m.r === "sys" || m.t);
  busy("chat", false);
  save("chat", { messages: S.chat.slice(-40) });
  render(); scrollChat();
}
const scrollChat = () => { const m = $("#msgs"); if (m) m.scrollTop = m.scrollHeight; };

/* ---------- UI helpers ---------- */
function busy(k, v){ S.busy[k] = v; }
function flash(where, text, err){ S.msg[where] = { text, err }; render(); }
function go(v){ S.view = v; render(); scrollTo(0,0); }
function msgHTML(k){ const m = S.msg[k]; return m ? `<div class="status ${m.err ? "err" : "ok"}">${esc(m.text)}</div>` : ""; }

function spark(sport){
  const w = weeklyBuckets(12), vals = w.map(x => x[sport].t/60), max = Math.max(...vals, 1);
  const W = 240, H = 46, bw = W/12;
  const bars = vals.map((v, i) => { const h = Math.max(v ? 3 : 1.5, v/max*(H-6)); return `<rect x="${(i*bw+2).toFixed(1)}" y="${(H-h).toFixed(1)}" width="${(bw-4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--${sport})" opacity="${i === 11 ? 1 : .38}"><title>${fmtDate(w[i].start)}: ${Math.round(v)} min</title></rect>`; }).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Minutos por semana, últimas 12 semanas">${bars}</svg>`;
}
function sportTile(sport){
  const k = sportStats(sport, 28), wk = weeklyBuckets(1)[0][sport];
  const vol = sport === "swim" ? `${fmtNum(k.perWeek,0)}<small>m/sem</small>` : `${fmtNum(k.perWeek/1000,1)}<small>km/sem</small>`;
  const pace = sport === "swim" ? paceSwim(k.d,k.t) : sport === "run" ? paceRun(k.d,k.t) : speedBike(k.d,k.t);
  return `<div class="sport c-${sport}">
    <div class="k"><span class="tag c-${sport}">${SPORTS[sport]}</span><span class="eyebrow">média 4 sem</span></div>
    <div class="big">${vol}</div>
    <div class="sub"><span>Ritmo <b>${pace}</b></span><span>Esta semana <b>${fmtDist(sport, wk.d)}</b></span><span>Maior <b>${fmtDist(sport, k.longest.dist)}</b></span></div>
    ${spark(sport)}
  </div>`;
}
const ZONA_TXT = { Z1:"recuperação, bem leve", Z2:"leve, dá para conversar", Z3:"moderado, ritmo de prova longa", Z4:"forte, no limiar", Z5:"muito forte, VO2máx" };
function splitSteps(t){
  return String(t||"").split(/\s*(?:;|•|\n|\s\+\s|\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ0-9]))\s*/).map(x => x.replace(/\.$/, "").trim()).filter(Boolean);
}
const EX_ALT = [
  [/agach|leg ?press|hack|goblet|smith.*agach/i, ["Agachamento livre com barra","Agachamento no Smith","Leg press 45°","Goblet squat (halter)","Hack machine","Agachamento búlgaro"]],
  [/terra|stiff|romeno|flexora|good ?morning/i, ["Stiff com barra","Stiff com halteres","Terra romeno unilateral","Mesa flexora","Good morning","Ponte unilateral no chão"]],
  [/afundo|avan[cç]o|passada|b[uú]lgaro|step/i, ["Afundo com halteres","Passada andando","Agachamento búlgaro","Step-up no banco","Afundo no Smith","Afundo reverso"]],
  [/quadril|hip ?thrust|ponte|gl[uú]te|abdu/i, ["Hip thrust com barra","Hip thrust na máquina","Ponte de glúteo no chão","Coice no cabo","Abdução na máquina","Caminhada lateral com elástico"]],
  [/panturr|s[oó]leo|g[eê]meo/i, ["Panturrilha em pé no Smith","Panturrilha no leg press","Panturrilha unilateral no degrau com halter","Panturrilha sentado (sóleo)","Panturrilha excêntrica no degrau"]],
  [/remada|row/i, ["Remada curvada com barra","Remada baixa no cabo","Remada unilateral com halter","Remada na máquina","Remada no TRX"]],
  [/puxada|barra fixa|pulldown|pull/i, ["Puxada frente","Barra fixa (com ajuda)","Pulldown braço reto","Puxada com elástico"]],
  [/prancha|core|pallof|dead ?bug|bird|abdom/i, ["Prancha","Prancha lateral","Pallof press","Dead bug","Bird dog","Abdominal com roda"]],
  [/manguito|rota[cç][aã]o|face ?pull|ombro|y-t-w/i, ["Rotação externa no cabo","Rotação externa com elástico","Face pull","Y-T-W no banco inclinado","Desenvolvimento com halteres leve"]],
  [/salto|pliom|pular|skipping|caixa/i, ["Saltos na caixa","Salto vertical","Pular corda","Skipping alto","Saltos laterais","Salto unilateral"]],
  [/supino|flex[aã]o|empurr|desenvolv/i, ["Supino com halteres","Flexão de braço","Supino na máquina","Desenvolvimento com halteres","Flexão inclinada"]],
  [/extensora/i, ["Cadeira extensora","Agachamento sissy","Leg press pés baixos","Wall sit (isometria na parede)"]],
];
function exAlternatives(name){
  const hit = EX_ALT.find(([re]) => re.test(name));
  return hit ? hit[1].filter(n => n.toLowerCase() !== String(name).toLowerCase()) : [];
}
function planRefOf(sess){
  if (!S.plan) return null;
  for (let wi = 0; wi < S.plan.semanas.length; wi++) for (const d of (S.plan.semanas[wi].dias||[])) { const i = (d.sessoes||[]).indexOf(sess); if (i >= 0) return `${wi}.${d.dia}.${i}`; }
  return null;
}
function sessByRef(ref){ const [wi, dia, i] = ref.split(".").map(Number); return (S.plan?.semanas[wi]?.dias||[]).find(d => d.dia === dia)?.sessoes?.[i]; }
function swapPanelHTML(x, ref, ei){
  const alts = [...new Set([...exAlternatives(x.nome), ...(S.swap.ai || [])])];
  return `<div class="swappanel" role="group" aria-label="Alternativas para ${esc(x.nome)}">
    <div class="note">Escolha um substituto com a mesma função:</div>
    <div class="chips">${alts.map(a => `<button type="button" data-swappick="${esc(a)}">${esc(a)}</button>`).join("") || `<span class="note">Sem alternativas prontas para este exercício.</span>`}</div>
    <div class="row"><button type="button" class="btn ghost sm" data-swapai ${S.swap.loading ? "disabled" : ""}>${S.swap.loading ? '<span class="spin"></span> Buscando' : "Mais opções (IA)"}</button>
      <input class="swapcustom" placeholder="Ou digite outro exercício" aria-label="Outro exercício"><button type="button" class="btn ghost sm" data-swapcustom>Usar</button>
      <button type="button" class="btn ghost sm" data-swapclose>Cancelar</button></div>
  </div>`;
}
function applySwap(nome){
  if (!S.swap || !nome) return;
  const sess = sessByRef(S.swap.ref), x = sess?.exercicios?.[S.swap.ei]; if (!x) return;
  if (!x.trocado) x.trocado = x.nome;
  x.nome = nome; if (x.trocado === nome) delete x.trocado;
  S.swap = null; save("plan", S.plan); flash(S.view, `Exercício trocado para ${nome}.`, false);
}
async function swapAI(){
  const sess = sessByRef(S.swap.ref), x = sess?.exercicios?.[S.swap.ei]; if (!x) return;
  const sample = await cap("sample"); if (!sample) return;
  S.swap.loading = true; render();
  try {
    const r = await sample.json(`Sugira 5 exercícios de academia que substituem "${x.nome}" (${[x.series && x.reps ? x.series+"x"+x.reps : "", x.carga].filter(Boolean).join(", ")}) num treino de força para triatleta, com o mesmo padrão de movimento e músculos. Variedade de equipamentos (máquina, halter, cabo, peso corporal, elástico). ${activeComplaints().length ? "Atleta com queixas: " + activeComplaints().map(c => c.local).join(", ") + "; evite agravar." : ""} Responda só com um array JSON de nomes curtos em português.`, { modelTier:"quick" });
    if (S.swap) S.swap.ai = Array.isArray(r) ? r.map(String).slice(0, 6) : [];
  } catch { flash(S.view, "Não consegui buscar mais opções agora.", true); }
  if (S.swap) S.swap.loading = false; render();
}
/** Minutos de bike e de corrida de uma sessão (brick = bike + corrida; usa bike_min/run_min ou as etapas). */
function sportMinutes(s){
  const m = Number(s.min) || 0;
  if (s.sport !== "brick") return { [s.sport]: m };
  let bike = Number(s.bike_min) || 0, run = Number(s.run_min) || 0;
  if (!bike && !run){
    for (const e of s.etapas || []){ const t = `${e.fase || ""} ${e.desc || ""}`.toLowerCase(); if (/corr|run|trote|pace|\/km/.test(t)) run += Number(e.min) || 0; else bike += Number(e.min) || 0; }
    if (!bike && !run){ run = Math.round(m * 0.2); bike = m - run; }
  }
  return { bike, run };
}
/** Linha curta do treino: 45 min · 1.200 m · Z1 · recuperação, bem leve */
function sessMeta(s){
  const z = String(s.zona || "").toUpperCase().match(/Z[1-5]/)?.[0];
  const br = s.sport === "brick" ? sportMinutes(s) : null;
  return [s.min ? `${s.min} min` : "", br ? `bike ${br.bike} + corrida ${br.run} min` : "", s.dist ? String(s.dist) : "", s.pace ? `pace ${String(s.pace).replace(/^pace\s*/i, "")}` : "", z ? `${z} · ${ZONA_TXT[z]}` : (s.zona || "")].filter(Boolean).join(" · ");
}
/** Card compacto; o passo a passo abre no painel de detalhes ao tocar. */
function sessHTML(s, date){
  const sp = s.sport || "other", done = date && isDone(s, date), ref = planRefOf(s), meta = [SPORTS[sp], sessMeta(s)].filter(Boolean).join(" · ");
  const inner = `<div class="t">${esc(s.titulo || SPORTS[sp])}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ""}${s.movido ? `<div class="m">movido por você</div>` : ""}`;
  return ref ? `<button type="button" class="sess sessbtn c-${sp}${done ? " done" : ""}" data-open="${ref}" data-date="${date ? dayKey(date) : ""}" aria-haspopup="dialog">${inner}<span class="more" aria-hidden="true">Ver treino ›</span></button>`
             : `<div class="sess c-${sp}${done ? " done" : ""}">${inner}</div>`;
}
/** Painel com o treino completo: etapas, dica, exercícios (com troca) e mudar de dia. */
function sessSheetHTML(){
  const ref = S.openSess, s = ref && sessByRef(ref);
  if (!s) return "";
  const [wi, dia] = ref.split(".").map(Number), date = planDate(wi, dia), sp = s.sport || "other", done = isDone(s, date);
  const etapas = Array.isArray(s.etapas) && s.etapas.length
    ? s.etapas.map(e => `<li><b>${esc(e.fase || "")}</b>${e.min ? ` <span class="mono">${e.min} min</span>` : ""}${e.desc ? `<span>${esc(e.desc)}</span>` : ""}</li>`).join("")
    : (s.sport === "strength" ? "" : splitSteps(s.detalhe).map(x => `<li><span>${esc(x)}</span></li>`).join(""));
  const ex = Array.isArray(s.exercicios) && s.exercicios.length ? `<h3 class="shh">Exercícios</h3><ul class="ex">${s.exercicios.map((x, ei) => {
    const open = S.swap && S.swap.ref === ref && S.swap.ei === ei;
    return `<li><span>${esc(x.nome)}${x.trocado ? ` <small class="note">(no lugar de ${esc(x.trocado)})</small>` : ""}</span><b>${esc([x.series && x.reps ? `${x.series}×${x.reps}` : x.series || x.reps, x.carga].filter(Boolean).join(" · "))}</b>${x.obs ? `<em>${esc(x.obs)}</em>` : ""}
      <button type="button" class="swapbtn" data-swap="${ref}" data-ei="${ei}" aria-expanded="${!!open}">Trocar</button>
      ${open ? swapPanelHTML(x, ref, ei) : ""}</li>`; }).join("")}</ul>` : "";
  const movable = !done && dayKey(date) >= dayKey(new Date());
  return `<div class="sheet-bg" data-closesheet></div>
  <div class="sheet c-${sp}" role="dialog" aria-modal="true" aria-labelledby="sheet_t">
    <div class="sheet-h"><div><div class="eyebrow">${SPORTS[sp]} · ${(t => t.charAt(0).toUpperCase()+t.slice(1))(date.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"short"}))}${done ? " · feito ✓" : ""}</div>
      <h2 id="sheet_t">${esc(s.titulo || SPORTS[sp])}</h2>${sessMeta(s) ? `<div class="note">${esc(sessMeta(s))}</div>` : ""}</div>
      <button type="button" class="btn ghost sm" data-closesheet aria-label="Fechar">✕</button></div>
    ${etapas ? `<h3 class="shh">Passo a passo</h3><ol class="steps">${etapas}</ol>` : ""}
    ${s.sport === "strength" && s.detalhe ? `<p class="d">${esc(s.detalhe)}</p>` : ""}
    ${s.dica ? `<div class="tip">${esc(s.dica)}</div>` : ""}${ex}
    ${movable ? `<div class="mvrow"><button type="button" class="btn ghost sm" data-move="${ref}" aria-expanded="${S.move === ref}">Mudar dia</button>${s.movido ? `<span class="note">movido por você</span>` : ""}</div>${S.move === ref ? movePanelHTML(ref) : ""}` : ""}
  </div>`;
}
/* ---------- mudar treino de dia (o atleta mexe no plano) ---------- */
function movePanelHTML(ref){
  const [wi, dia] = ref.split(".").map(Number), todayK = dayKey(new Date()), w = S.plan.semanas[wi];
  const opts = Array.from({length:7}, (_, d) => d).filter(d => d !== dia && dayKey(planDate(wi, d)) >= todayK);
  if (!opts.length) return `<div class="swappanel"><span class="note">Não há outro dia livre nesta semana.</span></div>`;
  const what = d => (w.dias.find(x => x.dia === d)?.sessoes || []).filter(x => x.sport !== "rest").map(x => SPORTS[x.sport]).join(" + ");
  const lbl = d => `${DOW[d]} ${planDate(wi, d).getDate()}`;
  const withS = opts.filter(d => what(d));
  return `<div class="swappanel"><div class="note">Mover este treino para:</div>
    <div class="chips">${opts.map(d => `<button type="button" class="chip" data-moveto="${d}" data-ref="${ref}">${lbl(d)}${what(d) ? ` <small>· já tem ${esc(what(d))}</small>` : " <small>· livre</small>"}</button>`).join("")}</div>
    ${withS.length ? `<div class="note">Ou trocar o dia inteiro com:</div><div class="chips">${withS.map(d => `<button type="button" class="chip" data-swapday="${d}" data-ref="${ref}">${lbl(d)} <small>(${esc(what(d))})</small></button>`).join("")}</div>` : ""}
    <div><button type="button" class="btn ghost sm" data-moveclose>Cancelar</button></div></div>`;
}
function planDay(wi, d){ const w = S.plan.semanas[wi]; let x = w.dias.find(y => y.dia === d); if (!x){ x = { dia: d, sessoes: [] }; w.dias.push(x); } x.sessoes ||= []; return x; }
function movePlanned(ref, toDia, swapDay){
  const [wi, dia, i] = ref.split(".").map(Number), from = planDay(wi, dia), to = planDay(wi, toDia);
  if (swapDay){ const a = from.sessoes, b = to.sessoes; from.sessoes = b; to.sessoes = a; [...a, ...b].forEach(x => { if (x.sport !== "rest") x.movido = true; }); }
  else { const [s] = from.sessoes.splice(i, 1); if (!s) return; s.movido = true; to.sessoes = [...to.sessoes.filter(x => x.sport !== "rest"), s]; }
  S.plan.editedAt = new Date().toISOString(); S.move = null; S.openSess = null; save("plan", S.plan);
  flash(S.view, swapDay ? `Dias trocados: ${DOW[dia]} ⇄ ${DOW[toDia]}.` : `Treino movido para ${DOW[toDia]} ${planDate(wi, toDia).getDate()}.`, false);
}
function complaintsHTML(withActions){
  const list = activeComplaints();
  if (!list.length) return "";
  return `<div class="body-list">${list.map(c => { const h = c.historico || []; const prev = h.length > 1 ? h[h.length-2].intensidade : null;
    const trend = prev == null ? "" : c.intensidade < prev ? "melhorando" : c.intensidade > prev ? "piorando" : "estável";
    return `<div class="cq"><div><b>${esc(c.local)}</b> <span class="mono">${esc(c.intensidade)}/10</span>${trend ? ` <span class="trend t-${trend}">${trend}</span>` : ""}<div class="note">${esc([c.quando, c.desde ? "desde " + c.desde : "", c.agrava ? "piora com " + c.agrava : ""].filter(Boolean).join(" · "))}</div></div>
    ${withActions ? `<button class="btn ghost" data-resolve="${esc(c.id)}">Resolvida</button>` : ""}</div>`; }).join("")}</div>`;
}
const RACE_DIST = { sprint:["750 m","20 km","5 km"], olimpico:["1,5 km","40 km","10 km"], "703":["1,9 km","90 km","21,1 km"], ironman:["3,8 km","180 km","42,2 km"] };
const raceAt = () => new Date(`${S.race.date}T${S.race.time || "06:30"}:00`);
function daysToRace(){ return S.race?.date ? Math.ceil((raceAt() - new Date()) / 864e5) : null; }
const raceLabel = () => S.race.label ? `${S.race.label}${RACES[S.race.type] ? " · " + RACES[S.race.type].split(" (")[1].replace(")", "") : ""}` : RACES[S.race.type] ? RACES[S.race.type].split(" (")[0] : "Distância a definir";
function raceForAI(){ return { nome: S.race.name, data: S.race.date, distancia: RACES[S.race.type] ? (S.race.label ? `${S.race.label} = ${RACES[S.race.type]}` : RACES[S.race.type]) : "a definir (assuma olímpico até ser definida)", local: S.race.place || "", dias_ate_a_prova: daysToRace() }; }
function countdownHTML(big){
  return `<section class="cd${big ? " big" : ""}" aria-label="Tempo até a prova">
    <img class="race-logo" src="data:image/jpeg;base64,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" alt="All Limits · Lagoa dos Ingleses" width="420" height="229">
    <div class="cd-meta"><div class="eyebrow">Largada</div><h2 class="cd-name">${esc(S.race.name || "Prova da equipe")}</h2>
      <dl class="cd-info">
        <div><dt>Data</dt><dd>${(d => d.charAt(0).toUpperCase() + d.slice(1))(raceAt().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}))}</dd></div>
        <div><dt>Largada</dt><dd>${esc((S.race.time || "06:30").replace(":", "h"))}</dd></div>
        <div><dt>Prova</dt><dd>${esc(S.race.label || raceLabel())}</dd></div>
        ${RACE_DIST[S.race.type] ? `<div class="wide"><dt>Distâncias</dt><dd class="cd-dist"><span><i style="background:var(--swim)"></i>Natação ${RACE_DIST[S.race.type][0]}</span><span><i style="background:var(--bike)"></i>Bike ${RACE_DIST[S.race.type][1]}</span><span><i style="background:var(--run)"></i>Corrida ${RACE_DIST[S.race.type][2]}</span></dd></div>` : ""}
        ${S.race.place ? `<div class="wide"><dt>Local</dt><dd>${esc(S.race.place)}</dd></div>` : ""}
      </dl></div>
    <div class="cd-clock mono" data-cd>${cdParts().map(([v,l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div></section>`;
}
function cdParts(){
  let s = Math.max(0, Math.floor((raceAt() - new Date())/1000));
  const d = Math.floor(s/86400); s %= 86400; const h = Math.floor(s/3600); s %= 3600; const m = Math.floor(s/60); s %= 60;
  return [[d,"dias"],[String(h).padStart(2,"0"),"horas"],[String(m).padStart(2,"0"),"min"],[String(s).padStart(2,"0"),"seg"]];
}
setInterval(() => { document.querySelectorAll("[data-cd]").forEach(el => { const p = cdParts(); el.querySelectorAll("b").forEach((b, i) => { if (b.textContent != p[i][0]) b.textContent = p[i][0]; }); }); }, 1000);

/* ---------- condicionamento (modelo de carga: forma = média 42 dias, fadiga = média 7 dias) ---------- */
const IF_DEFAULT = { run:.78, bike:.70, swim:.75, strength:.60, other:.55 };
function loadOf(a){
  const h = a.mov/3600; if (!h) return 0;
  const ifac = a.rpe ? 0.45 + 0.055 * a.rpe : a.hr ?Math.min(1.15, Math.max(.5, a.hr / 168)) : (IF_DEFAULT[a.sport] ?? .55);
  return h * ifac * ifac * 100;
}
/* Condicionamento = função pura dos treinos registrados, nunca do relógio nem da tela.
   Uma única série diária: começa no 1º treino (tudo zerado antes dele) e termina no dia do último treino.
   Mesmos treinos → mesmo número, em qualquer tela, recarga ou dia. Só muda quando entra/sai um treino
   ou quando a duração, FC ou esforço de um treino mudam. */
let _fit = { key: null, series: [] };
function fitnessAll(){
  const xs = S.activities.filter(a => a.sport !== "other" && a.mov > 0);
  const key = xs.map(a => `${a.id}|${dayKey(a.date)}|${a.mov}|${a.hr || ""}|${a.rpe || ""}|${a.sport}`).sort().join(";");
  if (_fit.key === key) return _fit.series;
  const daily = new Map();
  for (const a of xs){ const k = dayKey(a.date); daily.set(k, (daily.get(k) || 0) + loadOf(a)); }
  const keys = [...daily.keys()].sort(), out = [];
  if (keys.length){
    const first = new Date(keys[0] + "T00:00:00"), last = new Date(keys.at(-1) + "T00:00:00");
    let ctl = 0, atl = 0;
    for (let d = first; d <= last; d = addDays(d, 1)){
      const l = daily.get(dayKey(d)) || 0;
      ctl += (l - ctl) / 42; atl += (l - atl) / 7;
      out.push({ d, ctl, atl, tsb: ctl - atl, load: l });
    }
  }
  _fit = { key, series: out };
  return out;
}
/** Últimos `days` dias da série (até o dia do último treino), completando com zeros antes do 1º treino. */
function fitnessSeries(days = 120){
  const all = fitnessAll();
  if (!all.length) return [];
  if (all.length >= days) return all.slice(-days);
  const pad = Array.from({ length: days - all.length }, (_, i) => ({ d: addDays(all[0].d, -(days - all.length) + i), ctl: 0, atl: 0, tsb: 0, load: 0 }));
  return [...pad, ...all];
}
const fitnessAsOf = () => fitnessAll().at(-1)?.d || null;
function formState(tsb){
  if (tsb > 5) return { t:"Descansado", c:"var(--swim)", d:"Pronto para treinar forte ou competir." };
  if (tsb >= -10) return { t:"Equilibrado", c:"var(--ok)", d:"Carga e recuperação em equilíbrio." };
  if (tsb >= -25) return { t:"Construindo", c:"var(--warn)", d:"Fadiga produtiva: está ganhando forma." };
  return { t:"Sobrecarga", c:"var(--bad)", d:"Fadiga alta. Vale aliviar 1 ou 2 dias." };
}
function windowStats(fromDays, toDays){
  const a0 = addDays(new Date(), -fromDays), a1 = addDays(new Date(), -toDays), wk = (fromDays - toDays) / 7;
  const xs = S.activities.filter(a => { const d = new Date(a.date); return d >= a0 && d < a1; });
  const by = sp => { const ys = xs.filter(a => a.sport === sp); return { d: ys.reduce((s,a)=>s+a.dist,0), t: ys.reduce((s,a)=>s+a.mov,0), n: ys.length }; };
  const run = by("run"), bike = by("bike"), swim = by("swim");
  return { hours: xs.reduce((s,a)=>s+a.mov,0)/3600/wk, sessions: xs.length/wk, run, bike, swim, wk };
}
function compareRows(){
  const now = windowStats(28, 0), then = windowStats(84, 56);
  const pace = (m, s, per) => m > 0 && s > 0 ? s / (m/per) : null;
  const rows = [
    { k:"Horas por semana", a: then.hours, b: now.hours, f: v => fmtNum(v,1) + " h", up:true },
    { k:"Treinos por semana", a: then.sessions, b: now.sessions, f: v => fmtNum(v,1), up:true },
    { k:"Corrida por semana", a: then.run.d/1000/then.wk, b: now.run.d/1000/now.wk, f: v => fmtNum(v,1) + " km", up:true, c:"run" },
    { k:"Ritmo de corrida", a: pace(then.run.d, then.run.t, 1000), b: pace(now.run.d, now.run.t, 1000), f: v => `${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,"0")}/km`, up:false, c:"run" },
    { k:"Bike por semana", a: then.bike.d/1000/then.wk, b: now.bike.d/1000/now.wk, f: v => fmtNum(v,0) + " km", up:true, c:"bike" },
    { k:"Velocidade na bike", a: then.bike.t ? then.bike.d/1000/(then.bike.t/3600) : null, b: now.bike.t ? now.bike.d/1000/(now.bike.t/3600) : null, f: v => fmtNum(v,1) + " km/h", up:true, c:"bike" },
    { k:"Natação por semana", a: then.swim.d/then.wk, b: now.swim.d/now.wk, f: v => fmtNum(v,0) + " m", up:true, c:"swim" },
    { k:"Ritmo na natação", a: pace(then.swim.d, then.swim.t, 100), b: pace(now.swim.d, now.swim.t, 100), f: v => `${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,"0")}/100m`, up:false, c:"swim" }
  ];
  return rows.filter(r => (r.a || r.b));
}
function deltaHTML(r){
  if (r.a == null || r.b == null || !r.a) return `<span class="delta">—</span>`;
  const pct = (r.b - r.a) / r.a * 100; if (Math.abs(pct) < 2) return `<span class="delta flat">estável</span>`;
  const good = r.up ? pct > 0 : pct < 0;
  return `<span class="delta ${good ? "good" : "bad"}">${pct > 0 ? "▲" : "▼"} ${fmtNum(Math.abs(pct),0)}%</span>`;
}
function fitnessChart(series){
  const W = 720, H = 230, L = 34, R = 14, T = 14, B = 26, iw = W-L-R, ih = H-T-B;
  const max = Math.max(10, ...series.map(p => Math.max(p.ctl, p.atl))) * 1.12;
  const step = max > 80 ? 25 : max > 40 ? 15 : max > 20 ? 10 : 5;
  const x = i => L + i/(series.length-1)*iw, y = v => T + ih - v/max*ih;
  const path = k => series.map((p,i) => `${i?"L":"M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const area = `${path("ctl")}L${x(series.length-1).toFixed(1)},${T+ih}L${L},${T+ih}Z`;
  const grid = []; for (let v = 0; v <= max; v += step) grid.push(`<line x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${L-6}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="ax">${v}</text>`);
  const months = []; series.forEach((p,i) => { if (p.d.getDate() === 1) months.push(`<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${T}" y2="${T+ih}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${(x(i)+4).toFixed(1)}" y="${H-8}" class="ax">${p.d.toLocaleDateString("pt-BR",{month:"short"}).replace(".","")}</text>`); });
  const bars = series.map((p,i) => p.load ? `<rect x="${(x(i)-1.5).toFixed(1)}" y="${(T+ih - Math.min(ih*.35, p.load/250*ih*.35)).toFixed(1)}" width="3" height="${Math.min(ih*.35, p.load/250*ih*.35).toFixed(1)}" fill="var(--muted)" opacity=".35"/>` : "").join("");
  const last = series[series.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" role="img" aria-label="Forma e fadiga nos últimos ${series.length} dias">
    ${grid.join("")}${months.join("")}${bars}
    <path d="${area}" fill="var(--swim)" opacity=".12"/>
    <path d="${path("ctl")}" fill="none" stroke="var(--swim)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${path("atl")}" fill="none" stroke="var(--run)" stroke-width="1.6" stroke-dasharray="5 4" opacity=".9"/>
    <circle cx="${x(series.length-1)}" cy="${y(last.ctl)}" r="4.5" fill="var(--swim)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${x(series.length-1)-8}" y="${y(last.ctl)-10}" text-anchor="end" class="ax strong">${Math.round(last.ctl)}</text>
  </svg>`;
}
const score = ctl => Math.max(0, Math.min(100, ctl));
const REF_OLY = { swim:[4000,6000,"m"], bike:[90,150,"km"], run:[20,35,"km"] };  // referência semanal para amador em prova olímpica (8–10 h/sem)
function motivosHTML(now){
  const wk = 6, since = addDays(new Date(), -wk*7), xs = S.activities.filter(a => new Date(a.date) >= since);
  const days = new Set(xs.map(a => dayKey(a.date))).size;
  const per = sp => { const ys = xs.filter(a => a.sport === sp); const d = ys.reduce((s,a)=>s+a.dist,0)/wk; return { n: ys.length, v: sp === "swim" ? d : d/1000 }; };
  const loadBy = {}; xs.forEach(a => { loadBy[a.sport] = (loadBy[a.sport]||0) + loadOf(a); });
  const totLoad = Object.values(loadBy).reduce((a,b)=>a+b,0) || 1;
  const names = { swim:"Natação", bike:"Bike", run:"Corrida" };
  const sportRows = ["swim","bike","run"].map(sp => {
    const p = per(sp), [lo, hi, u] = REF_OLY[sp], pct = Math.min(100, p.v / ((lo+hi)/2) * 100);
    const verdict = p.v >= lo ? (p.v > hi*1.15 ? "acima da referência" : "dentro da referência") : p.v >= lo*0.5 ? "abaixo da referência" : "bem abaixo da referência";
    const txt = p.n === 0 ? `Nenhum treino de ${names[sp].toLowerCase()} nas últimas ${wk} semanas: é o ponto que mais puxa sua nota para baixo nessa modalidade.`
      : `${fmtNum(p.v, sp === "swim" ? 0 : 1)} ${u}/semana em média (${p.n} treino${p.n === 1 ? "" : "s"} em ${wk} semanas). Referência para olímpico: ${fmtNum(lo,0)}–${fmtNum(hi,0)} ${u}/semana, então você está ${verdict}.`;
    return `<div class="mot"><div class="row" style="justify-content:space-between"><b class="c-${sp}" style="color:var(--${sp})">${names[sp]}</b><span class="mono note">${fmtNum(pct,0)}% da referência · ${fmtNum(loadBy[sp]/totLoad*100||0,0)}% da sua carga</span></div>
      <div class="meter"><i style="width:${pct}%;background:var(--${sp})"></i></div><p>${txt}</p></div>`;
  }).join("");
  const nota = score(now.ctl), faixa = nota < 20 ? "início de preparação" : nota < 40 ? "base em construção" : nota < 60 ? "bom nível amador" : nota < 80 ? "muito bem preparado" : "nível de elite";
  const weakest = ["swim","bike","run"].map(sp => [sp, per(sp).v / ((REF_OLY[sp][0]+REF_OLY[sp][1])/2)]).sort((a,b) => a[1]-b[1])[0][0];
  return `<details class="motivos"><summary>Ver motivos da nota</summary>
    <p><b>${fmtNum(nota,1)} de 100 = ${faixa}.</b> A nota é a sua carga média diária dos últimos 42 dias. Para chegar bem a uma prova olímpica, um amador costuma estar entre 45 e 70.</p>
    <p><b>Constância:</b> você treinou em ${days} dos últimos ${wk*7} dias${days < wk*7*0.4 ? ". Treinar mais dias por semana, mesmo curto, é o jeito mais rápido de subir a nota." : "."}</p>
    ${sportRows}
    <p><b>O que fazer:</b> o maior ganho agora está na ${names[weakest].toLowerCase()}. ${now.tsb < -20 ? "Mas sua fadiga está alta: suba o volume depois de 2–3 dias leves." : "Aumente o volume dela aos poucos, no máximo 10% por semana."}</p>
    <p class="note">Referências por semana para amador em prova olímpica (8–10 h de treino): natação 4–6 km, bike 90–150 km, corrida 20–35 km.</p>
  </details>`;
}
function dataQuality(){
  const xs = S.activities; if (!xs.length) return { enough:false, msg:"Ainda não há treinos registrados. Sincronize o Strava ou registre um treino." };
  const first = xs.reduce((m,a) => a.date < m ? a.date : m, xs[0].date);
  const last = xs.reduce((m,a) => a.date > m ? a.date : m, xs[0].date);
  const days = Math.floor((new Date(last) - new Date(first)) / 864e5);
  const est = xs.filter(a => !a.hr && !a.rpe && a.mov).length;
  const enough = xs.length >= 4 && days >= 14;
  return { enough, n: xs.length, days, est, msg: enough ? "" : `Precisamos de pelo menos 4 treinos ao longo de 2 semanas para calcular sem chutar. Hoje há ${xs.length} treino${xs.length === 1 ? "" : "s"} em ${days} dia${days === 1 ? "" : "s"}.` };
}
function howCalcHTML(dq){
  return `<details class="howcalc"><summary>Como calculamos</summary>
    <ol>
      <li><b>Carga de cada treino</b> = horas × intensidade² × 100. A intensidade vem da sua <b>FC média ÷ 168 bpm</b> (FC de limiar de referência) ou do <b>esforço 1–10</b> que você informou.</li>
      <li><b>Condicionamento</b> = média da carga diária dos últimos 42 dias, com mais peso nos dias recentes. Escala de 0 a 100, em que 100 é a carga média diária de um atleta profissional.</li>
      <li><b>Só muda com treino novo:</b> o cálculo vai do seu 1º treino até o último registrado. Recarregar a página ou passar o dia não altera o número; ele é recalculado quando entra um treino ou quando você corrige duração, FC ou esforço.</li>
      <li><b>Fadiga</b> = a mesma média nos últimos 7 dias. <b>Equilíbrio</b> = condicionamento − fadiga: positivo é descansado, muito negativo é sobrecarga.</li>
    </ol>
    ${dq.est ? `<p class="note warnline" style="margin:8px 0 0">${dq.est} treino${dq.est === 1 ? "" : "s"} sem FC nem esforço usa${dq.est === 1 ? "" : "m"} a intensidade média da modalidade. Avalie o esforço deles na aba Treinos para deixar o número exato.</p>` : `<p class="note" style="margin:8px 0 0">Todos os treinos têm FC ou esforço informado.</p>`}
  </details>`;
}
function fitnessForAI(){
  const dq = dataQuality(); if (!dq.enough) return { indisponivel: dq.msg };
  const s = fitnessSeries(60), n = s[s.length-1], a = s[s.length-29];
  return { condicionamento_0a100: +score(n.ctl).toFixed(1), condicionamento_4_semanas_atras: +score(a.ctl).toFixed(1), fadiga: +n.atl.toFixed(1), equilibrio: +n.tsb.toFixed(1), estado: formState(n.tsb).t, treinos_com_intensidade_estimada: dq.est };
}
function nextSession(){
  if (!S.plan) return null;
  const start = new Date(S.plan.start + "T00:00:00"), now = new Date();
  for (let off = 0; off < 21; off++){
    const date = addDays(new Date(now.toDateString()), off);
    const wi = Math.floor((mondayOf(date) - start) / (7*864e5)); const w = S.plan.semanas[wi]; if (!w) continue;
    const d = (w.dias||[]).find(x => x.dia === (date.getDay()+6)%7);
    const ss = (d?.sessoes||[]).filter(s => s.sport !== "rest" && !(off === 0 && isDone(s, date)));
    if (ss.length) return { date, off, sessions: ss };
  }
  return null;
}
const relDay = off => off === 0 ? "Hoje" : off === 1 ? "Amanhã" : null;
function agoText(d){ const n = Math.floor((new Date(new Date().toDateString()) - new Date(new Date(d).toDateString()))/864e5); return n === 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`; }
/* ---------- calorias da semana em copos de chope ---------- */
const MET = { run: 9.8, bike: 7.5, swim: 7, brick: 8.5, strength: 5, other: 3.5 };
const KCAL_CHOPE = 125; // copo de chope de 300 ml
function weekKcal(){
  const kg = Number(S.profile?.peso) || 75, since = mondayOf(new Date());
  return Math.round(S.activities.filter(a => new Date(a.date) >= since).reduce((t, a) => t + (a.kcal || (MET[a.sport] ?? 4) * kg * a.mov/3600), 0));
}
function beerHTML(){
  const kcal = weekKcal(), n = Math.floor(kcal / KCAL_CHOPE);
  const cups = n ? "🍺".repeat(Math.min(n, 24)) + (n > 24 ? ` <span class="mono">+${n-24}</span>` : "") : "";
  return `<section class="panel beer"><div class="ph"><h2>Cota da cerveja</h2><span class="note">semana atual</span></div>
    ${n ? `<p style="margin:0">De acordo com a sua semana (<b>${fmtNum(kcal,0)} kcal</b> gastas treinando), você pode beber <b>${n} copo${n === 1 ? "" : "s"} de chope</b>.</p><div class="cups" aria-label="${n} copos">${cups}</div>`
        : `<p style="margin:0">${kcal ? `Só ${fmtNum(kcal,0)} kcal até agora: ainda não deu nem um copo.` : "Nenhum treino nesta semana ainda: a cota de chope está zerada."} Bora treinar que a cerveja tá esperando.</p>`}
    <p class="note" style="margin:8px 0 0">1 copo de chope (300 ml) ≈ ${KCAL_CHOPE} kcal. Calorias estimadas pela duração, modalidade e seu peso.</p></section>`;
}
function lastWorkoutHTML(){
  const extra = S.activities.find(x => !isPlanned(x));
  const extraLine = extra ? `<div class="extra-line"><span class="eyebrow">Última atividade fora do plano</span><span>${SPORTS[extra.sport] === "Outro" ? esc(extra.name) : SPORTS[extra.sport]}${extra.dist ? ` · ${fmtDist(extra.sport, extra.dist)}` : ""} · ${fmtDur(extra.mov)} · ${agoText(extra.date)}</span></div>` : "";
  const a = S.activities.find(isPlanned);
  if (!a) return `<p class="muted" style="margin:0">${S.plan ? "Nenhum treino do plano concluído ainda." : "Gere o plano para começar a contar os treinos."}</p>${extraLine}`;
  return lastWorkoutBody(a) + extraLine;
}
function lastWorkoutBody(a){
  if (!a) return `<p class="muted" style="margin:0">Nenhum treino importado ainda.</p><div><button class="btn ghost" data-go="dados">Conectar dados</button></div>`;
  const pace = a.sport==="run"?paceRun(a.dist,a.mov):a.sport==="swim"?paceSwim(a.dist,a.mov):a.sport==="bike"?speedBike(a.dist,a.mov):null;
  const srcName = { strava:"Strava", garmin:"Garmin", apple:"Apple Watch", manual:"manual" }[a.src] || "";
  return `<div class="row" style="justify-content:space-between"><span class="tag c-${a.sport}">${SPORTS[a.sport]}</span><span class="note">${agoText(a.date)} · ${fmtDate(a.date)}${srcName ? " · " + srcName : ""}</span></div>
    <h3 style="margin-top:10px">${esc(a.name)}</h3>
    <div class="kv">${a.dist ? `<div><span>Distância</span><b>${fmtDist(a.sport, a.dist)}</b></div>` : ""}<div><span>Tempo</span><b>${fmtDur(a.mov)}</b></div>${pace ? `<div><span>${a.sport==="bike"?"Velocidade":"Ritmo"}</span><b>${pace}</b></div>` : ""}${a.hr ? `<div><span>FC média</span><b>${Math.round(a.hr)} bpm</b></div>` : ""}<div><span>Carga</span><b>${Math.round(loadOf(a))} pts</b></div>${a.rpe ? `<div><span>Esforço</span><b>${a.rpe}/10</b></div>` : ""}</div>
    ${a.obs ? `<p class="note" style="margin:10px 0 0">${esc(a.obs)}</p>` : ""}
    ${!a.rpe ? `<div class="rate"><div class="note">Como foi o esforço? (1 muito leve, 10 máximo)</div><div class="rpe">${Array.from({length:10},(_,i)=>i+1).map(n => `<button type="button" data-rpe="${n}" data-id="${esc(a.id)}" title="${RPE[n]}"><span>${n}</span></button>`).join("")}</div></div>` : ""}`;
}
function nextWorkoutHTML(){
  if (!S.plan) return `<p class="muted" style="margin:0">Seus treinos da semana ainda não foram gerados.</p><p class="note" style="margin:0">${WEEK_GEN_TEXT}</p><div><button class="btn" data-act="plan" ${S.busy.plan ? "disabled" : ""}>${S.busy.plan ? '<span class="spin"></span> Gerando' : "Gerar treinos da semana"}</button></div>`;
  const n = nextSession(), av = S.plan.avaliacao ? `<p class="note" style="margin:0 0 12px"><b>Leitura do coach:</b> ${esc(S.plan.avaliacao)}</p>` : "";
  if (!n) return `${av}<p class="muted" style="margin:0">${S.busy.plan ? "Avaliando seus últimos treinos para montar a semana…" : "Semana concluída."}</p><p class="note" style="margin:0">${WEEK_GEN_TEXT}</p>`;
  return `${av}<div class="note" style="margin-bottom:10px">${relDay(n.off) || n.date.toLocaleDateString("pt-BR",{weekday:"long"})} · ${n.date.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}</div>
    <div class="today-list">${n.sessions.map(s => sessHTML(s, null)).join("")}</div>`;
}
/* ---------- registros manuais (treino sem relógio, recuperação) ---------- */
const RPE = ["", "Muito leve", "Leve", "Moderado", "Um pouco forte", "Forte", "Forte", "Muito forte", "Muito forte", "Quase máximo", "Máximo"];
function persistActivities(){ return save("activities", { list: S.activities, zones: S.zones, syncedAt: S.lastSync || null, sources: S.sources || {} }); }
const TIPOS = { run:["Rodagem leve","Longão","Intervalado","Limiar / tempo","Fartlek","Subidas","Regenerativo","Teste","Prova"],
  bike:["Rodagem leve","Longão","Intervalado","Limiar / sweet spot","Subidas","Cadência / técnica","Regenerativo","Teste","Prova"],
  swim:["Técnica / educativos","Contínuo","Séries CSS","Velocidade","Águas abertas","Regenerativo","Teste CSS","Prova"],
  strength:["Força pesada","Força de resistência","Pliometria","Core / estabilidade","Reabilitação","Mobilidade"],
  brick:["Brick curto","Brick longo","Simulado de prova"], other:["Caminhada","Outro esporte","Mobilidade / alongamento"] };
const LOCAIS = { run:["Rua","Esteira","Pista","Trilha"], bike:["Rua / estrada","Rolo","Bike indoor / spinning","MTB"], swim:["Piscina 25 m","Piscina 50 m","Águas abertas"], strength:["Academia","Casa","Ao ar livre"], brick:["Rua","Rolo + esteira","Rolo + rua"], other:["—"] };
const ZONA_RPE = r => !r ? "" : r <= 2 ? "Z1" : r <= 4 ? "Z2" : r <= 6 ? "Z3" : r <= 8 ? "Z4" : "Z5";
function plannedFor(dateKey){
  if (!S.plan) return [];
  const date = new Date(dateKey + "T12:00:00"), wi = Math.floor((mondayOf(date) - new Date(S.plan.start + "T00:00:00"))/(7*864e5));
  const d = (S.plan.semanas[wi]?.dias||[]).find(x => x.dia === (date.getDay()+6)%7);
  return (d?.sessoes||[]).filter(s => s.sport !== "rest").map((s, i) => ({ ...s, ref: `${wi}-${d.dia}-${i}` }));
}
function addManualWorkout(x){
  let { sport, date, min, dist, rpe, feel, hr, obs, nome } = x;
  sport = SPORTS[sport] ? sport : sportOf(sport);
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayKey(new Date());
  const hora = { "Manhã":"07:00", "Tarde":"14:00", "Noite":"19:30" }[x.periodo] || "07:00";
  const a = normalize({ id: "m" + Date.now() + Math.floor(Math.random()*1e3), date: `${d}T${hora}:00`, sport_type: sport === "brick" ? "run" : sport, name: nome || `${x.tipo || SPORTS[sport]}${x.local && x.local !== "—" ? " · " + x.local : ""}`,
    distance: Number(dist)||0, moving_time: (Number(min)||0)*60, average_heartrate: Number(hr) || null });
  if (!a) return null;
  a.sport = sport; a.rpe = rpe ? Math.max(1, Math.min(10, Math.round(rpe))) : null; a.feel = feel || ""; a.obs = (obs||"").slice(0, 500);
  const extra = ["tipo","local","periodo","clima","cumpriu","planRef","fcmax","watts","cadencia","terreno","elev","estilo","acessorios","series","forca","pre","carbo_g","agua_ml","dor","bike_min","run_min","sono_ant"];
  for (const k of extra) if (x[k] != null && x[k] !== "" && !(Array.isArray(x[k]) && !x[k].length)) a[k] = x[k];
  if (x.elev) a.elev = Number(x.elev) || 0;
  if (a.dor?.onde){
    const list = (S.profile ||= {}).complaints ||= [];
    const ex = list.find(c => !c.resolvido && c.local.toLowerCase() === a.dor.onde.toLowerCase());
    const h = { data: d, intensidade: a.dor.nivel };
    if (ex){ ex.intensidade = a.dor.nivel; ex.historico = [...(ex.historico||[]), h].slice(-20); ex.quando = a.dor.quando || ex.quando; }
    else list.push({ id: "q" + Date.now(), local: a.dor.onde, intensidade: a.dor.nivel, quando: a.dor.quando || "durante o treino", agrava: SPORTS[sport], data: d, historico: [h] });
    save("profile", S.profile);
  }
  mergeActivities([a], "manual"); persistActivities(); saveTeam();
  return a;
}
function saveRecovery(entry){
  const data = entry.data && /^\d{4}-\d{2}-\d{2}$/.test(entry.data) ? entry.data : dayKey(new Date());
  const prev = (S.checkins||[]).find(x => x.data === data) || {};
  const clean = Object.fromEntries(Object.entries(entry).filter(([k, v]) => v !== null && v !== undefined && v !== ""));
  const c = { ...prev, ...clean, data };
  S.checkins = [...(S.checkins||[]).filter(x => x.data !== data), c].sort((a,b) => a.data.localeCompare(b.data)).slice(-90);
  save("checkins", { list: S.checkins });
  return c;
}
function rpeChips(name, value){
  return `<div class="rpe" role="radiogroup" aria-label="Esforço percebido">${Array.from({length:10}, (_, i) => i+1).map(n =>
    `<label title="${RPE[n]}"><input type="radio" name="${name}" value="${n}" ${value == n ? "checked" : ""}><span>${n}</span></label>`).join("")}</div>
    <div class="rpe-scale note"><span>muito leve</span><span>moderado</span><span>máximo</span></div>`;
}
const LOG_SPORTS = ["run","bike","swim","strength","brick"];
function logFormHTML(){
  const sp = S.logSport || "run", date = S.logDate || dayKey(new Date());
  const show = (...s) => s.includes(sp) ? "" : "hidden";
  return `<section class="panel logbox"><div class="ph"><h2>Registrar treino</h2><button class="btn ghost sm" type="button" data-act="hidelog">Fechar</button></div>
    <form id="logform" class="logf">
      <fieldset><legend>O treino</legend>
        <div class="sportpick" role="radiogroup" aria-label="Modalidade">${LOG_SPORTS.map(s => `<label class="c-${s}"><input type="radio" name="l_sport" value="${s}" ${s === sp ? "checked" : ""}><span>${SPORTS[s]}</span></label>`).join("")}</div>
        <div class="f">
          <div class="fld"><label for="l_date">Data</label><input id="l_date" type="date" value="${date}" max="${dayKey(new Date())}"></div>
          <div class="fld"><label>Período</label>${pills("l_periodo", ["Manhã","Tarde","Noite"], "Manhã")}</div>
        </div>
      </fieldset>
      <fieldset><legend>Volume <span class="note">(tudo opcional)</span></legend><div class="f">
        <div class="fld"><label for="l_min">Duração (min)</label><input id="l_min" type="number" inputmode="numeric" min="0" max="900" placeholder="45"></div>
        <div class="fld" ${show("run","bike","swim","brick")}><label for="l_dist">Distância ${sp === "swim" ? "(m)" : "(km)"}</label><input id="l_dist" type="number" inputmode="decimal" min="0" step="${sp === "swim" ? 25 : 0.01}" placeholder="${sp === "swim" ? "2000" : "10"}"></div>
        <div class="fld" ${show("run","bike","brick")}><label for="l_elev">Subida (m)</label><input id="l_elev" type="number" inputmode="numeric" min="0" placeholder="120"></div>
        <div class="fld" ${show("run","bike","brick")}><label for="l_cad">Cadência média</label><input id="l_cad" type="number" inputmode="numeric" min="0" max="250" placeholder="${sp === "run" ? "passos/min" : "rpm"}"></div>
      </div></fieldset>
      <fieldset><legend>Como foi <span class="note">(opcional)</span></legend><div class="f">
        <div class="fld full"><span class="lblq"><label>Esforço: quão difícil foi? <span class="note" id="l_zone"></span></label>${qtip("1–2 bem leve, 3–4 confortável (dá para conversar), 5–6 moderado, 7–8 forte, 9–10 no limite. Ajuda o coach a ajustar os próximos treinos.")}</span>${rpeChips("l_rpe", null)}</div>
        <div class="fld full"><label for="l_obs">Observação</label><textarea id="l_obs" rows="2" placeholder="Algo que o coach deve saber"></textarea></div>
      </div></fieldset>
      <div class="logfoot"><div class="preview" id="l_preview" aria-live="polite">${logPreviewHTML()}</div>
        <div class="row"><button class="btn" type="submit">Salvar treino</button><span class="note">Também dá para contar no chat.</span></div></div>
    </form></section>`;
}
function strengthRow(){
  return `<div class="exrow"><input name="ex_nome" placeholder="Exercício" aria-label="Exercício" list="ex_list"><input name="ex_series" type="number" min="1" max="20" placeholder="Séries" aria-label="Séries"><input name="ex_reps" placeholder="Reps" aria-label="Repetições"><input name="ex_kg" type="number" min="0" step="0.5" placeholder="kg" aria-label="Carga em kg"></div>
    <datalist id="ex_list">${["Agachamento","Leg press","Terra romeno / stiff","Afundo","Elevação de quadril","Panturrilha em pé","Panturrilha sentado","Remada","Puxada","Supino","Prancha","Pallof press","Rotação externa (manguito)","Saltos na caixa"].map(x => `<option value="${x}">`).join("")}</datalist>`;
}
function readLog(){
  const v = id => $("#" + id)?.value?.trim?.() ?? "";
  const n = id => { const x = parseFloat(v(id)); return isNaN(x) ? null : x; };
  const sp = pick("l_sport") || "run";
  const min = n("l_min");
  const dv = n("l_dist") || 0, dist = sp === "swim" ? (dv > 0 && dv < 20 ? dv*1000 : dv) : dv*1000;
  const forca = sp === "strength" ? [...document.querySelectorAll("#l_ex .exrow")].map(r => ({ nome: r.querySelector('[name="ex_nome"]').value.trim(), series: +r.querySelector('[name="ex_series"]').value || null, reps: r.querySelector('[name="ex_reps"]').value.trim(), kg: +r.querySelector('[name="ex_kg"]').value || null })).filter(x => x.nome) : [];
  const dor = pick("l_dor") === "Sim" && v("l_dor_onde") ? { onde: v("l_dor_onde"), nivel: n("l_dor_nivel") ?? 3, quando: pick("l_dor_quando") } : null;
  return { sport: sp, date: v("l_date"), periodo: pick("l_periodo"), tipo: v("l_tipo"), local: v("l_local"), planRef: v("l_plan"), cumpriu: pick("l_cumpriu"),
    min, dist, elev: n("l_elev"), terreno: pick("l_terreno"), watts: n("l_watts"), cadencia: n("l_cad"), estilo: sp === "swim" ? pick("l_estilo") : "",
    acessorios: [...document.querySelectorAll('input[name="l_acess"]:checked')].map(x => x.value), series: v("l_series"), forca,
    rpe: +(pick("l_rpe") || 0), feel: pick("l_feel"), clima: pick("l_clima"), hr: n("l_hr"), fcmax: n("l_hrmax"), dor,
    pre: pick("l_pre"), carbo_g: n("l_carbo"), agua_ml: n("l_agua"), obs: v("l_obs") };
}
function logPreviewHTML(x){
  if (!x || !x.min) return `<span class="note">Com a duração, o app calcula a carga do treino.</span>`;
  const load = loadOf({ mov: x.min*60, rpe: x.rpe, hr: x.hr, sport: x.sport });
  const pace = x.dist ? (x.sport === "run" ? paceRun(x.dist, x.min*60) : x.sport === "swim" ? paceSwim(x.dist, x.min*60) : x.sport === "bike" ? speedBike(x.dist, x.min*60) : "") : "";
  const vol = x.forca?.length ? x.forca.reduce((s,e) => s + (e.series||0) * (parseInt(e.reps)||0) * (e.kg||0), 0) : 0;
  const cph = x.carbo_g && x.min ? Math.round(x.carbo_g / (x.min/60)) : null;
  const items = [
    ["Carga", `${Math.round(load)} pts`], x.rpe ? ["Zona", `${ZONA_RPE(x.rpe)} · ${RPE[x.rpe]}`] : null, pace ? [x.sport === "bike" ? "Velocidade" : "Ritmo", pace] : null,
    vol ? ["Volume de força", `${fmtNum(vol,0)} kg`] : null, cph != null ? ["Carbo por hora", `${cph} g/h`] : null
  ].filter(Boolean);
  const warn = [];
  if (cph != null && x.min >= 75 && cph < 30) warn.push("Para treinos acima de 75 min, mire em 30–60 g de carbo por hora.");
  if (x.dor && x.dor.nivel > 3) warn.push("Dor acima de 3/10: o coach vai sugerir ajuste no próximo treino.");
  if (x.rpe >= 7 && /leve|Regenerativo|Rodagem/.test(x.tipo)) warn.push("Esforço alto para um treino leve. Dias fáceis devem ser realmente fáceis.");
  return `<div class="kv" style="margin:0">${items.map(([k,v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>${warn.map(w => `<div class="note warnline">${esc(w)}</div>`).join("")}`;
}
function qtip(text){
  return `<span class="qwrap"><button type="button" class="qtip" aria-label="O que é isso?" aria-expanded="false">?</button><span class="qpop" role="tooltip" hidden>${text}</span></span>`;
}
function todayCheckin(){ return (S.checkins||[]).find(c => c.data === dayKey(new Date())); }
function checkinHTML(){
  const c = todayCheckin(), recent = (S.checkins||[]).slice(-7);
  const sl = recent.filter(x => x.sono); const avgSleep = sl.length ? sl.reduce((s,x)=>s+(+x.sono||0),0)/sl.length : null;
  if (c && !S.editCheckin) return `<section class="panel checkin done"><div class="ph"><h2>Recuperação de hoje</h2><button class="btn ghost" data-act="editcheckin">Editar</button></div>
    <div class="kv">${c.sono ? `<div><span>Sono</span><b>${fmtNum(c.sono,1)} h</b></div>` : ""}${c.score ? `<div><span>Sleep score</span><b>${c.score}</b></div>` : ""}${c.qual ? `<div><span>Qualidade</span><b>${c.qual}/5</b></div>` : ""}${c.hrv ? `<div><span>HRV</span><b>${c.hrv} ms</b></div>` : ""}${c.bb ? `<div><span>Body Battery</span><b>${c.bb}</b></div>` : ""}${c.rhr ? `<div><span>FC repouso</span><b>${c.rhr} bpm</b></div>` : ""}${c.stress ? `<div><span>Estresse</span><b>${c.stress}</b></div>` : ""}${c.cans ? `<div><span>Cansaço</span><b>${c.cans}/5</b></div>` : ""}${avgSleep ? `<div><span>Sono médio 7 dias</span><b>${fmtNum(avgSleep,1)} h</b></div>` : ""}</div>
    ${c.obs ? `<p class="note" style="margin:10px 0 0">${esc(c.obs)}</p>` : ""}</section>`;
  const v = c || {};
  return `<section class="panel checkin"><div class="ph"><h2>Check-in de hoje</h2><span class="note">Preencha o que tiver (Garmin, Apple Watch ou de cabeça) ou mande no chat: "sleep score 78, body battery 60".</span></div>
    <form class="ci" id="checkin">
      <div class="cigroup"><div class="cig-t">Sono</div>
        <div class="cirow">
          <div class="fld"><span class="lblq"><label for="ci_sono_h">Tempo dormido</label>${qtip("Quanto você dormiu de fato na última noite: primeiro as horas, depois os minutos. Ex: 7 h e 30 min.")}</span><div class="hm"><input id="ci_sono_h" type="number" inputmode="numeric" min="0" max="14" step="1" value="${v.sono != null && v.sono !== "" ? Math.floor(+v.sono) : ""}" placeholder="7" aria-label="Horas dormidas"><span>h</span><input id="ci_sono_m" type="number" inputmode="numeric" min="0" max="59" step="5" value="${v.sono != null && v.sono !== "" ? Math.round((+v.sono % 1) * 60) : ""}" placeholder="30" aria-label="Minutos dormidos"><span>min</span></div></div>
          <div class="fld"><span class="lblq"><label for="ci_qual">Como dormiu</label>${qtip("Sua sensação ao acordar: 1 = péssimo, 3 = normal, 5 = ótimo. Use se não tiver relógio.")}</span><input id="ci_qual" type="number" min="1" max="5" value="${esc(v.qual ?? "")}" placeholder="1 a 5"></div>
          <div class="fld"><span class="lblq"><label for="ci_score">Sleep score</label>${qtip("Nota de 0 a 100 que o Garmin dá para o seu sono (app Garmin Connect → Sono). No Apple Watch, use a nota do app de sono que você tiver.")}</span><input id="ci_score" type="number" min="0" max="100" value="${esc(v.score ?? "")}" placeholder="0 a 100"></div>
        </div></div>
      <div class="cigroup"><div class="cig-t">Recuperação</div>
        <div class="cirow">
          <div class="fld"><span class="lblq"><label for="ci_bb">Body Battery</label>${qtip("Energia do corpo de 0 a 100 medida pelo Garmin. Veja o valor ao acordar. Abaixo de 40 indica pouca recuperação.")}</span><input id="ci_bb" type="number" min="0" max="100" value="${esc(v.bb ?? "")}" placeholder="0 a 100"></div>
          <div class="fld"><span class="lblq"><label for="ci_hrv">HRV (ms)</label>${qtip("Variabilidade da frequência cardíaca durante o sono, em milissegundos. Compare com o seu normal: mais alto = recuperado; bem mais baixo = cansaço, estresse ou doença chegando.")}</span><input id="ci_hrv" type="number" min="0" max="250" value="${esc(v.hrv ?? "")}" placeholder="ex: 55"></div>
          <div class="fld"><span class="lblq"><label for="ci_rhr">FC de repouso</label>${qtip("Batimentos por minuto em repouso, ao acordar. Se subir 5 ou mais acima do seu normal, costuma ser sinal de fadiga.")}</span><input id="ci_rhr" type="number" min="30" max="120" value="${esc(v.rhr ?? "")}" placeholder="bpm"></div>
          <div class="fld"><span class="lblq"><label for="ci_cans">Cansaço</label>${qtip("Como o corpo está hoje: 1 = inteiro, 3 = normal, 5 = destruído. Pernas pesadas e dor muscular contam.")}</span><input id="ci_cans" type="number" min="1" max="5" value="${esc(v.cans ?? "")}" placeholder="1 a 5"></div>
        </div></div>
      <div class="cifoot">
        <p class="note" style="margin:0">Preencha só o que tiver. Toque no <span class="qinline">?</span> para entender cada campo.</p>
        <button class="btn" type="submit">Salvar check-in</button>
      </div>
    </form></section>`;
}
function chatBox(compact){
  const sugg = ["Sleep score 78 e Body Battery 60 hoje", "Fiz 40 min de corrida sem relógio, esforço 7", "Estou sentindo o tendão de Aquiles", "Hoje comi isso, está bom para o treino?"];
  const list = compact ? S.chat.slice(-4) : S.chat;
  return `<section class="panel chat${compact ? " compact" : ""}">
    ${compact ? `<div class="ph"><h2>Fale com o coach</h2>${S.chat.length > 4 ? `<button class="btn ghost" data-go="coach">Ver conversa completa</button>` : ""}</div>` : ""}
    <div class="msgs" id="msgs" aria-live="polite">${list.length ? list.map(m => `<div class="msg ${m.r === "u" ? "u" : m.r === "sys" ? "sys" : "a"}">${esc(m.t) || (S.busy.chat ? "…" : "")}</div>`).join("") :
      `<div class="msg sys">Pergunte sobre seus treinos, conte uma dor ou peça um treino de academia.</div>`}</div>
    ${!S.chat.length || compact ? `<div class="chips">${sugg.map(s => `<button data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
    ${S.pendingImg ? `<div class="attach">Print anexado: ${esc(S.pendingImg.name || "imagem")} <button class="btn ghost" type="button" data-act="clearimg">Remover</button></div>` : ""}
    <form class="composer" id="chatform">${S.canImg ? `<label class="btn ghost iconbtn" for="chatimg" title="Anexar print do relógio ou da refeição" aria-label="Anexar print"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-8 7"/></svg></label><input id="chatimg" type="file" accept="image/*" hidden>` : ""}<textarea id="chatin" placeholder="Escreva para o coach: dúvidas, sono, treino sem relógio, alimentação…" aria-label="Mensagem para o coach"></textarea>
      ${S.busy.chat ? `<button type="button" class="btn ghost" data-act="stop">Parar</button>` : `<button class="btn" type="submit">Enviar</button>`}</form>
  </section>`;
}

/* ---------- peso ---------- */
function addWeight(kg, data){
  kg = Math.round(Number(kg)*10)/10; if (!(kg > 25 && kg < 300)) return null;
  data = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : dayKey(new Date());
  S.weights = [...(S.weights||[]).filter(w => w.data !== data), { data, kg }].sort((a,b) => a.data.localeCompare(b.data)).slice(-200);
  save("weights", { list: S.weights });
  const last = S.weights[S.weights.length-1];
  if (S.profile && S.profile.peso !== last.kg){ S.profile.peso = last.kg; save("profile", S.profile); }
  return last;
}
function weightDue(){ const w = (S.weights||[]).at(-1); return !w || (new Date() - new Date(w.data + "T12:00:00")) > 6.5*864e5; }
function weightStats(){
  const ws = S.weights || []; if (!ws.length) return null;
  const first = ws[0], last = ws[ws.length-1];
  const fourAgo = [...ws].reverse().find(w => new Date(w.data) <= addDays(new Date(), -28));
  const weeks = Math.max(1, (new Date(last.data) - new Date(first.data)) / (7*864e5));
  return { first, last, total: last.kg - first.kg, m4: fourAgo ? last.kg - fourAgo.kg : null, perWeek: ws.length > 1 ? (last.kg - first.kg)/weeks : null,
    imc: S.profile?.altura ? last.kg / ((S.profile.altura/100)**2) : null };
}
function weightChart(){
  const ws = (S.weights||[]).slice(-26); if (ws.length < 2) return `<p class="note" style="margin:0">O gráfico aparece a partir do segundo check-in.</p>`;
  const W = 560, H = 170, L = 38, R = 14, T = 14, B = 24, iw = W-L-R, ih = H-T-B;
  const vals = ws.map(w => w.kg), lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const t0 = new Date(ws[0].data), t1 = new Date(ws.at(-1).data), span = Math.max(1, t1 - t0);
  const x = w => L + (new Date(w.data) - t0)/span*iw, y = v => T + ih - (v-lo)/(hi-lo)*ih;
  const step = (hi-lo) > 8 ? 2 : 1; const grid = [];
  for (let v = lo; v <= hi; v += step) grid.push(`<line x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${L-6}" y="${(y(v)+4).toFixed(1)}" text-anchor="end" class="ax">${v}</text>`);
  const path = ws.map((w,i) => `${i?"L":"M"}${x(w).toFixed(1)},${y(w.kg).toFixed(1)}`).join("");
  return `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" class="fchart" style="min-width:320px" role="img" aria-label="Peso por semana">${grid.join("")}
    <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="2"/>
    ${ws.map((w,i) => `<circle cx="${x(w).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="${i === ws.length-1 ? 4.5 : 3}" fill="${i === ws.length-1 ? "var(--ink)" : "var(--surface)"}" stroke="var(--ink)" stroke-width="1.6"><title>${fmtDate(w.data+"T12:00:00")}: ${fmtNum(w.kg,1)} kg</title></circle>`).join("")}
    <text x="${L}" y="${H-6}" class="ax">${fmtDate(ws[0].data+"T12:00:00")}</text><text x="${W-R}" y="${H-6}" text-anchor="end" class="ax">${fmtDate(ws.at(-1).data+"T12:00:00")}</text></svg></div>`;
}
const signed = (v, d=1) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v), d)} kg`;
function weightCardHTML(){
  const st = weightStats();
  return `<section class="panel stack"><div class="ph" style="margin:0"><h2>Peso</h2><span class="note">check-in semanal</span></div>
    ${st ? `<div class="kv" style="margin:0"><div><span>Atual</span><b>${fmtNum(st.last.kg,1)} kg</b></div><div><span>Início (${fmtDate(st.first.data+"T12:00:00")})</span><b>${fmtNum(st.first.kg,1)} kg</b></div><div><span>Variação total</span><b>${signed(st.total)}</b></div><div><span>Últimas 4 semanas</span><b>${signed(st.m4)}</b></div>${st.imc ? `<div><span>IMC</span><b>${fmtNum(st.imc,1)}</b></div>` : ""}</div>` : ""}
    ${weightChart()}
    ${weightFormHTML()}</section>`;
}
function weightFormHTML(){
  return `<form class="row" id="weighform"><input id="w_kg" type="number" step="0.1" min="25" max="300" required placeholder="kg hoje" aria-label="Peso de hoje em kg" style="width:130px"><button class="btn${weightDue() ? "" : " ghost"}" type="submit">Registrar peso</button>${!weightDue() ? `<span class="note">Próximo check-in a partir de ${fmtDate(addDays(new Date((S.weights.at(-1).data)+"T12:00:00"), 7))}</span>` : ""}</form>`;
}

/* ---------- alimentação ---------- */
function dayMinutes(date){
  const k = dayKey(date);
  const done = S.activities.filter(a => dayKey(a.date) === k).reduce((s,a)=>s+a.mov/60,0);
  let planned = 0;
  if (S.plan){ const wi = Math.floor((mondayOf(date) - new Date(S.plan.start + "T00:00:00"))/(7*864e5)); const d = (S.plan.semanas[wi]?.dias||[]).find(x => x.dia === (date.getDay()+6)%7);
    planned = (d?.sessoes||[]).filter(s => s.sport !== "rest").reduce((s,x)=>s+(Number(x.min)||0),0); }
  return Math.max(done, planned);
}
function dietTargets(){
  const kg = Number(S.profile?.peso); if (!kg) return null;
  const min = dayMinutes(new Date());
  const cPerKg = min < 45 ? 5 : min < 90 ? 6 : min < 150 ? 7 : 8;
  return { minutos_treino_hoje: Math.round(min), carbo_g: Math.round(kg*cPerKg), carbo_g_kg: cPerKg, proteina_g: Math.round(kg*1.6), proteina_faixa: `${Math.round(kg*1.4)}–${Math.round(kg*2)} g`, agua_l: +(kg*0.035 + min/60*0.6).toFixed(1) };
}
function addDietEntry(e){
  const entry = { id: "d" + Date.now(), data: e.data && /^\d{4}-\d{2}-\d{2}$/.test(e.data) ? e.data : dayKey(new Date()), texto: String(e.texto||"").slice(0, 2000), foto: !!e.foto, itens: e.itens || [], confianca: e.confianca || "", est: e.est || {}, dicas: e.dicas || [], resumo: e.resumo || "", perguntas: e.perguntas || [] };
  S.diet = [...(S.diet||[]), entry].slice(-40);
  save("diet", { list: S.diet });
  return entry;
}
async function analyzeDiet(text){
  text = text.trim(); const img = S.dietImg;
  if (!text && !img){ flash("dieta", "Escreva o que comeu ou envie a foto do prato.", true); return; }
  const sample = await cap("sample");
  if (!sample){ flash("dieta", "A análise está indisponível agora.", true); return; }
  busy("diet", true); render();
  try {
    const r = await sample.json(`Você é nutricionista esportivo de triatlo. Analise o que o atleta comeu e responda em português do Brasil.
Atleta: peso ${S.profile?.peso || "não informado"} kg, altura ${S.profile?.altura || "não informada"} cm, nível ${S.profile?.level || "?"}.
Alvos de hoje (já calculados pelo volume de treino): ${JSON.stringify(dietTargets())}
Treino de hoje no plano: ${JSON.stringify(todaySessions())}
Prova: ${JSON.stringify(raceForAI())}
${img ? "FOTO DO PRATO ANEXADA: identifique cada alimento, estime as porções em gramas (use o tamanho do prato e dos talheres como referência) e diga o nível de confiança.\n" : ""}O que comeu (texto do atleta): """${(text || "(só a foto)").slice(0, 3000)}"""
Regras: foque em abastecer o treino e a recuperação; nada de dietas restritivas ou cortes grandes de calorias; use alimentos brasileiros comuns; se faltar quantidade, estime porções médias e diga isso.
Responda só com JSON: {"itens":[{"alimento":"arroz branco","porcao":"150 g","carbo_g":42,"proteina_g":4}],"confianca":"alta|média|baixa","resumo":"1-2 frases","est":{"kcal":0,"carbo_g":0,"proteina_g":0,"gordura_g":0},"dicas":["3 a 4 ajustes práticos e específicos, ex.: 'Some 1 concha de feijão e 3 colheres de arroz no almoço (+45 g de carbo)'"],"treino":"o que comer antes e depois do próximo treino, 1 frase","perguntas":["até 2 perguntas para melhorar a análise"]}`, { modelTier:"default", ...(img ? { images:[img] } : {}) });
    addDietEntry({ texto: text || "Foto do prato", foto: !!img, itens: Array.isArray(r.itens) ? r.itens.slice(0, 20) : [], confianca: r.confianca || "", est: r.est, dicas: r.dicas, resumo: [r.resumo, r.treino].filter(Boolean).join(" "), perguntas: r.perguntas });
    S.dietImg = null; if (S.dietImgUrl){ URL.revokeObjectURL(S.dietImgUrl); S.dietImgUrl = null; }
    S.msg.dieta = null;
  } catch (e) {
    flash("dieta", e?.code === "not_granted" ? "Sessão expirada. Entre de novo." : e?.code === "invalid_json" ? "A análise veio incompleta. Tente de novo." : "Não consegui analisar (" + (e?.code || "erro") + ").", true);
  }
  busy("diet", false); render();
}
function macroBar(label, val, target, unit, color){
  const pct = target ? Math.min(130, (val||0)/target*100) : 0;
  return `<div class="macro"><div class="row" style="justify-content:space-between"><span>${label}</span><span class="mono">${val != null ? Math.round(val) : "—"} / ${target ?? "—"} ${unit}</span></div>
    <div class="mbar"><i style="width:${Math.min(100,pct)}%;background:${color}"></i>${pct > 100 ? `<b style="left:${100/1.3}%"></b>` : ""}</div></div>`;
}
function viewDieta(){
  const p = S.profile || {}, t = dietTargets(), last = (S.diet||[]).slice().reverse();
  const today = (S.diet||[]).filter(d => d.data === dayKey(new Date()));
  const sum = k => today.reduce((s,d)=>s+(Number(d.est?.[k])||0),0);
  return `<div class="hero"><div><div class="eyebrow">Alimentação</div><h1>Combustível para treinar</h1><p>Conte o que comeu (uma refeição ou o dia todo). O coach estima carboidrato e proteína, compara com o que seu treino de hoje pede e sugere ajustes.</p></div></div>
  ${msgHTML("dieta")}
  ${!p.peso ? `<div class="status err" style="margin-bottom:16px">Informe seu peso em Perfil e dados para calcular os alvos. <button class="btn ghost" data-go="dados">Informar peso</button></div>` : ""}
  <div class="grid2" style="margin-top:0">
    <section class="panel"><div class="ph"><h2>O que você comeu?</h2></div>
      <form id="dietform" class="stack">
        <div class="photo">${S.dietImgUrl ? `<img src="${S.dietImgUrl}" alt="Foto do prato"><button type="button" class="btn ghost sm" data-act="cleardietimg">Trocar foto</button>`
          : `<label class="photodrop" for="dietimg"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span><b>Tirar foto do prato</b><br><span class="note">A IA identifica os alimentos e estima as porções</span></span></label>`}
          <input id="dietimg" type="file" accept="image/*" capture="environment" hidden></div>
        <textarea id="diettext" rows="4" placeholder="Opcional com foto. Ex: Café: 2 pães com ovo e café com leite. Almoço: arroz, feijão, frango e salada."></textarea>
        <div class="row"><button class="btn" type="submit" ${S.busy.diet ? "disabled" : ""}>${S.busy.diet ? '<span class="spin"></span> Analisando' : "Analisar"}</button><span class="note">Foto, texto ou os dois. Ex.: foto + "pós-treino, comi tudo".</span></div>
      </form></section>
    <section class="panel"><div class="ph"><h2>Hoje</h2><span class="note">${t ? `${t.minutos_treino_hoje} min de treino` : ""}</span></div>
      ${t ? `<div class="stack">${macroBar("Carboidrato", today.length ? sum("carbo_g") : null, t.carbo_g, "g", "var(--bike)")}${macroBar("Proteína", today.length ? sum("proteina_g") : null, t.proteina_g, "g", "var(--run)")}
        <div class="kv" style="margin-top:0"><div><span>Carbo alvo</span><b>${t.carbo_g_kg} g/kg</b></div><div><span>Proteína</span><b>${t.proteina_faixa}</b></div><div><span>Água</span><b>~${fmtNum(t.agua_l,1)} L</b></div>${p.peso && p.altura ? `<div><span>Peso / altura</span><b>${fmtNum(p.peso,1)} kg · ${p.altura} cm</b></div>` : ""}</div>
        <p class="note" style="margin:0">Estimativas para orientar o treino, não substituem nutricionista.</p></div>`
        : `<p class="muted" style="margin:0">Os alvos aparecem quando você informar o peso.</p>`}
    </section>
  </div>
  <div style="margin-top:16px">${weightCardHTML()}</div>
  ${last.length ? `<section class="panel" style="margin-top:16px"><div class="ph"><h2>Análises</h2></div><div class="stack">
    ${last.slice(0, 8).map(d => `<article class="meal"><div class="row" style="justify-content:space-between"><span class="eyebrow">${new Date(d.data+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"})}</span>
      <span class="mono note">${[d.est?.kcal ? `${d.est.kcal} kcal` : "", d.est?.carbo_g ? `C ${d.est.carbo_g} g` : "", d.est?.proteina_g ? `P ${d.est.proteina_g} g` : "", d.est?.gordura_g ? `G ${d.est.gordura_g} g` : ""].filter(Boolean).join(" · ")}</span></div>
      <p class="note" style="margin:6px 0">${esc(d.texto.slice(0, 220))}${d.texto.length > 220 ? "…" : ""}</p>
      ${d.itens?.length ? `<div class="tbl"><table class="items"><thead><tr><th>${d.foto ? "Na foto" : "Alimento"}</th><th class="num">Porção</th><th class="num">Carbo</th><th class="num">Prot.</th></tr></thead><tbody>${d.itens.map(i => `<tr><td>${esc(i.alimento)}</td><td class="num">${esc(i.porcao||"")}</td><td class="num">${i.carbo_g ?? "—"} g</td><td class="num">${i.proteina_g ?? "—"} g</td></tr>`).join("")}</tbody></table></div>${d.confianca ? `<div class="note">Confiança da estimativa: ${esc(d.confianca)}</div>` : ""}` : ""}
      ${d.resumo ? `<p style="margin:6px 0">${esc(d.resumo)}</p>` : ""}
      ${d.dicas?.length ? `<ul class="tips">${d.dicas.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${d.perguntas?.length ? `<div class="chips" style="margin:8px 0 0">${d.perguntas.map(q => `<button data-ask-go="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    </article>`).join("")}</div></section>` : ""}`;
}

/* ---------- views ---------- */
function viewPainel(){
  const p = S.profile;
  if (!p) return `
    ${countdownHTML(true)}
    <div class="empty"><div class="eyebrow">Primeiro acesso</div><h3>Faça seu cadastro para montar seu painel</h3>
      <p class="muted" style="margin:0;max-width:62ch">Leva 1 minuto: seu nível, horas disponíveis e dias de treino. Depois puxamos seus treinos (Strava, Garmin ou Apple Watch), calculamos seu condicionamento e geramos o plano até a prova.</p>
      <button class="btn" data-go="dados">Fazer cadastro</button></div>`;
  const dq = dataQuality(), enough = dq.enough;
  const series = enough ? fitnessSeries(120) : null;
  const now = series?.[series.length-1], ago = series?.[series.length-29];
  const st = now ? formState(now.tsb) : null;
  const change = now && ago && ago.ctl > 1 ? (now.ctl - ago.ctl) / ago.ctl * 100 : null;
  const rows = S.activities.length ? compareRows() : [];
  const adh = adherence(), ckDone = !!todayCheckin();
  const weighCard = weightDue() ? `<section class="panel weighdue"><div><h2>Check-in semanal de peso</h2><p class="note" style="margin:4px 0 0">${(S.weights||[]).length ? `Último: ${fmtNum(S.weights.at(-1).kg,1)} kg em ${fmtDate(S.weights.at(-1).data+"T12:00:00")}.` : "Registre hoje para começar o acompanhamento."} De preferência pela manhã, em jejum.</p></div>${weightFormHTML()}</section>` : "";
  return `
  ${countdownHTML(true)}
  <div class="hero"><div><div class="eyebrow">${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div><h1>Olá, ${esc(p.nick || "atleta")}</h1>
    <p>${[raceLabel(), adh != null ? `aderência ao plano ${adh}%` : null, S.lastSync ? `dados de ${agoText(S.lastSync)}` : null].filter(Boolean).join(" · ")}</p></div>
    <div class="row"><button class="btn" data-act="showlog">Registrar treino</button><button class="btn ghost" data-act="sync" ${S.busy.strava ? "disabled" : ""}>${S.busy.strava ? '<span class="spin"></span> Sincronizando' : "Atualizar Strava"}</button></div></div>
  ${msgHTML("painel")}
  ${S.showLog ? `<div style="margin-bottom:16px">${logFormHTML()}</div>` : ""}
  ${highlightsHTML()}
  ${beerHTML()}
  ${!ckDone ? `<div class="first">${checkinHTML()}</div>${weighCard}` : ""}

  <div class="fit">
    <section class="panel cond"><div class="ph"><h2>Condicionamento</h2><span class="note">índice 0–100${fitnessAsOf() ? ` · até o treino de ${fitnessAsOf().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}` : ""}</span></div>
      ${now ? `<div class="cond-main"><div class="big mono">${fmtNum(score(now.ctl),1)}</div><div><div class="note">de 100</div>${change != null ? `<div class="delta ${change >= 0 ? "good" : "bad"}">${change >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(change),1)}% em 4 semanas</div>` : ""}</div></div>
        <div class="meter" aria-hidden="true"><i style="width:${score(now.ctl)}%"></i></div>
        <div class="state" style="--c:${st.c}"><b>${st.t}</b><span>${st.d}</span></div>
        ${motivosHTML(now)}
        <div class="kv"><div><span>Fadiga (7 dias)</span><b>${fmtNum(now.atl,1)}</b></div><div><span>Equilíbrio</span><b>${now.tsb > 0 ? "+" : ""}${fmtNum(now.tsb,1)}</b></div><div><span>Carga da semana</span><b>${fmtNum(series.slice(-7).reduce((s,x)=>s+x.load,0),1)} pts</b></div></div>`
      : `<p class="muted" style="margin:0">${dq.msg}</p><div class="row"><button class="btn" data-act="showlog">Registrar treino</button><button class="btn ghost" data-act="sync">Atualizar Strava</button></div>`}
    </section>
    <section class="panel"><div class="ph"><h2>Forma e fadiga</h2>${series ? `<div class="legend"><span class="c-swim">Condicionamento (42 dias)</span><span class="c-run">Fadiga (7 dias)</span><span style="--c:var(--muted)">Carga do dia</span></div>` : ""}</div>
      ${series ? `<div class="chartbox">${fitnessChart(series)}</div>` : `<div class="empty" style="padding:20px"><span class="muted">O gráfico só aparece com dados reais suficientes. ${dq.msg}</span></div>`}
      ${howCalcHTML(dq)}
    </section>
  </div>

  ${ckDone ? `${weighCard}` : ""}
  <div class="grid2 even">
    <section class="panel"><div class="ph"><h2>Último treino</h2></div>${lastWorkoutHTML()}</section>
    <section class="panel"><div class="ph"><h2>Próximo treino</h2>${S.plan ? `<button class="btn ghost" data-go="treinos">Ver plano</button>` : ""}</div>${nextWorkoutHTML()}</section>
  </div>
  ${ckDone ? checkinHTML() : ""}

  <section class="panel" style="margin-top:16px"><div class="ph"><h2>Como você estava × como está</h2><span class="note">média por semana · 8 semanas atrás × últimas 4 semanas</span></div>
    <div class="tbl">${rows.length ? `<table class="cmp"><thead><tr><th>Indicador</th><th class="num">Antes</th><th class="num">Hoje</th><th class="num">Variação</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.c ? `<i class="dot" style="--c:var(--${r.c})"></i>` : ""}${r.k}</td><td class="num muted">${r.a ? r.f(r.a) : "—"}</td><td class="num">${r.b ? r.f(r.b) : "—"}</td><td class="num">${deltaHTML(r)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted" style="margin:0">Sem histórico suficiente para comparar.</p>`}</div>
  </section>
  <section class="panel coachread" style="margin-top:16px"><div class="ph"><h2>Leitura do coach</h2><button class="btn ghost sm" data-act="note" ${S.busy.note ? "disabled" : ""}>${S.busy.note ? '<span class="spin"></span> Analisando' : "Atualizar"}</button></div>
    ${coachReadHTML(p, rows)}
    ${activeComplaints().length ? `<div class="cr-block"><div class="eyebrow">Corpo</div>${complaintsHTML(false)}</div>` : ""}
  </section>

  <div style="margin-top:16px">${chatBox(true)}</div>`;
}
function doneHTML(a){
  if (!isPlanned(a)) return `<div class="doneitem extra c-${a.sport}"><b>${SPORTS[a.sport] === "Outro" ? esc(a.name) : SPORTS[a.sport]} · fora do plano</b> <span class="mono">${[a.dist ? fmtDist(a.sport, a.dist) : "", fmtDur(a.mov)].filter(Boolean).join(" · ")}</span></div>`;
  return `<div class="doneitem c-${a.sport}"><b>✓ ${SPORTS[a.sport]}</b> <span class="mono">${[a.dist ? fmtDist(a.sport, a.dist) : "", fmtDur(a.mov), a.rpe ? `esforço ${a.rpe}` : ""].filter(Boolean).join(" · ")}</span></div>`;
}
function viewTreinos(){
  const actions = `<div class="row"><button class="btn" data-act="showlog">Registrar treino</button><button class="btn ghost" data-act="sync" ${S.busy.strava ? "disabled" : ""}>${S.busy.strava ? '<span class="spin"></span> Sincronizando' : "Atualizar Strava"}</button></div>`;
  const head = `<div class="hero"><div><div class="eyebrow">Treinos${S.plan ? ` · fase ${esc(S.plan.fase || "")}` : ""}</div><h1>Planejado e feito</h1><p>${S.plan ? esc(S.plan.resumo || "") : "Seus treinos da semana, reajustados a cada treino feito, e tudo o que você já treinou."}</p></div>${actions}</div>
    ${msgHTML("treinos")}${msgHTML("plano")}
    ${S.showLog ? `<div style="margin-bottom:16px">${logFormHTML()}</div>` : ""}`;
  return head + calendarHTML() + planSectionHTML() + doneTableHTML() + metodoHTML();
}
function sessionsOn(date){
  if (!S.plan) return [];
  const k = dayKey(date); if (S.plan.inicio && k < S.plan.inicio) return [];
  const wi = Math.floor((mondayOf(date) - new Date(S.plan.start + "T00:00:00"))/(7*864e5));
  const d = (S.plan.semanas[wi]?.dias||[]).find(x => x.dia === (date.getDay()+6)%7);
  return (d?.sessoes||[]).filter(s => s.sport !== "rest");
}
function calendarHTML(){
  const today = new Date(new Date().toDateString()), todayK = dayKey(today);
  const base = S.calMonth ? new Date(S.calMonth + "-01T12:00:00") : new Date(today.getFullYear(), today.getMonth(), 1);
  const first = new Date(base.getFullYear(), base.getMonth(), 1), gridStart = mondayOf(first);
  const raceK = S.race.date, sel = S.calSel || todayK;
  const doneBy = {}; S.activities.forEach(a => (doneBy[dayKey(a.date)] ||= []).push(a));
  const cells = Array.from({length:42}, (_, i) => addDays(gridStart, i));
  const lastRow = cells.findLastIndex ? cells.findLastIndex(d => d.getMonth() === base.getMonth()) : 41;
  const rows = Math.ceil((lastRow + 1)/7);
  const planEnd = S.plan?.fim || (S.plan ? dayKey(addDays(new Date(S.plan.start+"T00:00:00"), 27)) : null);
  const selD = new Date(sel + "T12:00:00"), selPlan = sessionsOn(selD), selDone = doneBy[sel] || [];
  const dtr = daysToRace();
  return `<section class="panel cal" style="margin-bottom:16px">
    <div class="calhead">
      <div><div class="eyebrow">Hoje</div><b>${(t => t.charAt(0).toUpperCase()+t.slice(1))(today.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}))}</b></div>
      <div><div class="eyebrow">Planejado até</div><b>${S.plan ? new Date(planEnd+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short"}) : "não gerado"}</b></div>
      <div><div class="eyebrow">Prova</div><b>${new Date(raceK+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"})} · faltam ${dtr} dias</b></div>
    </div>
    <div class="calnav"><button class="btn ghost sm" data-calm="-1" aria-label="Mês anterior">‹</button><h3>${(t => t.charAt(0).toUpperCase()+t.slice(1))(base.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}))}</h3><button class="btn ghost sm" data-calm="1" aria-label="Próximo mês">›</button>${base.getMonth() !== today.getMonth() || base.getFullYear() !== today.getFullYear() ? `<button class="btn ghost sm" data-calm="0">Hoje</button>` : ""}</div>
    <div class="calgrid" role="grid">${DOW.map(d => `<div class="cdow">${d}</div>`).join("")}${cells.slice(0, rows*7).map(d => {
      const k = dayKey(d), out = d.getMonth() !== base.getMonth(), past = k < todayK, plan = sessionsOn(d), done = doneBy[k] || [];
      const inPlan = S.plan && k >= (S.plan.inicio || S.plan.start) && planEnd && k <= planEnd;
      // ✓ verde: treinou (e cumpriu o planejado); ✗ vermelho: tinha treino planejado e passou sem fazer
      const ok = k <= todayK && (plan.length ? plan.every(x => isDone(x, d)) : done.some(a => a.sport !== "other"));
      const miss = past && plan.length && !ok;
      const mark = ok ? `<span class="mark ok" aria-label="feito">✓</span>` : miss ? `<span class="mark miss" aria-label="não feito">✕</span>` : "";
      return `<button class="cday${out ? " out" : ""}${past ? " past" : ""}${k === todayK ? " today" : ""}${k === sel ? " sel" : ""}${k === raceK ? " race" : ""}${inPlan ? " inplan" : ""}" data-cald="${k}" aria-label="${d.toLocaleDateString("pt-BR")}">
        <span class="num">${d.getDate()}</span>${mark}
        ${k === raceK ? `<span class="flag">PROVA</span>` : ""}
        <span class="dots">${done.map(a => `<i class="dn" style="background:var(--${["swim","bike","run","brick"].includes(a.sport) ? a.sport : "ink"})"></i>`).join("")}${!past ? plan.map(p => `<i class="pl" style="border-color:var(--${["swim","bike","run"].includes(p.sport) ? p.sport : p.sport === "brick" ? "brick" : "ink"})"></i>`).join("") : ""}</span>
      </button>`; }).join("")}</div>
    <div class="legend" style="margin-top:10px"><span style="--c:var(--ok)">✓ treino feito</span><span style="--c:var(--bad)">✕ planejado e não feito</span><span style="--c:var(--ink)">● feito</span><span style="--c:var(--muted)">○ planejado</span><span style="--c:var(--run)">Natação / Bike / Corrida pelas cores</span></div>
    <div class="calday">
      <h3>${(t => t.charAt(0).toUpperCase()+t.slice(1))(selD.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}))}${sel === todayK ? " · hoje" : ""}${sel === raceK ? " · dia da prova" : ""}</h3>
      ${sel < todayK
        ? (selDone.length ? `<div class="today-list">${selDone.map(doneHTML).join("")}</div>` : `<p class="note" style="margin:0">Nenhum treino registrado neste dia.</p>`)
        : (selPlan.length ? `<div class="today-list">${selPlan.map(s => sessHTML(s, sel === todayK ? selD : null)).join("")}</div>${selDone.length ? `<div class="lbl">Feito</div>${selDone.map(doneHTML).join("")}` : ""}`
          : `<p class="note" style="margin:0">${!S.plan ? "Gere o plano para ver os treinos." : planEnd && sel > planEnd ? "A definir. " + WEEK_GEN_TEXT : "Descanso."}</p>`)}
    </div>
  </section>`;
}
function actRowsHTML(xs, planned){
  return `<div class="tbl"><table><thead><tr><th>Data</th><th>Modalidade</th><th>${planned ? "Treino do plano" : "Atividade"}</th><th class="num">Distância</th><th class="num">Tempo</th><th class="num">Ritmo</th><th class="num">Esforço</th><th>Origem</th><th></th></tr></thead><tbody>
    ${xs.map(a => { const ref = planMatches().actToSess.get(a.id), sess = ref ? sessByRef(ref) : null;
      return `<tr><td class="mono">${fmtDate(a.date)}</td><td><span class="tag c-${a.sport}">${SPORTS[a.sport]}</span></td><td class="name">${esc(a.name)}${sess ? `<div class="note">✓ ${esc(sess.titulo || SPORTS[sess.sport])}</div>` : ""}${a.obs ? `<div class="note">${esc(a.obs.slice(0,90))}</div>` : ""}</td>
      <td class="num">${a.dist ? fmtDist(a.sport,a.dist) : "—"}</td><td class="num">${fmtDur(a.mov)}</td><td class="num">${a.sport==="run"?paceRun(a.dist,a.mov):a.sport==="swim"?paceSwim(a.dist,a.mov):a.sport==="bike"?speedBike(a.dist,a.mov):"—"}</td>
      <td class="num">${a.rpe ? `${a.rpe}/10` : `<select class="rpesel" data-rpesel="${esc(a.id)}" aria-label="Avaliar esforço"><option value="">avaliar</option>${Array.from({length:10},(_,i)=>`<option>${i+1}</option>`).join("")}</select>`}</td>
      <td class="note">${({ strava:"Strava", garmin:"Garmin", apple:"Apple Watch", manual:"Manual" })[a.src] || "—"}</td>
      <td>${a.src === "manual" ? `<button class="btn ghost sm" data-del="${esc(a.id)}" aria-label="Apagar">Apagar</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>`;
}
function doneTableHTML(){
  const planned = S.activities.filter(isPlanned).slice(0, 30), extra = S.activities.filter(a => !isPlanned(a)).slice(0, 30);
  const nP = S.activities.filter(isPlanned).length, nE = S.activities.length - nP;
  return `<section class="panel" style="margin-top:16px"><div class="ph"><h2>Treinos realizados</h2><span class="note">${nP} do plano · aderência ${adherence() ?? "—"}%</span></div>
    ${planned.length ? actRowsHTML(planned, true) : `<p class="note" style="margin:0">${S.plan ? "Quando você fizer um treino planejado, ele aparece aqui. O app reconhece pela modalidade e pelo dia; no registro manual, escolha o treino do plano." : "Gere o plano para começar a contar os treinos."}</p>`}
  </section>
  <section class="panel" style="margin-top:16px"><div class="ph"><h2>Atividades fora do plano</h2><span class="note">${nE} no histórico · caminhadas, treinos extras, outros esportes</span></div>
    ${extra.length ? actRowsHTML(extra, false) : `<p class="note" style="margin:0">Nada fora do plano.</p>`}
  </section>`;
}
function planSectionHTML(){
  if (!S.plan) return `<div class="empty"><h3>Nenhum plano gerado</h3><p class="muted" style="margin:0">${S.activities.length ? `Temos ${S.activities.length} treinos no histórico para calibrar.` : "Sem histórico, a primeira semana começa conservadora e com testes."} ${WEEK_GEN_TEXT}</p>
      <button class="btn" data-act="plan" ${S.busy.plan ? "disabled" : ""}>${S.busy.plan ? '<span class="spin"></span> Gerando (leva ~1 min)' : "Gerar treinos da semana"}</button></div>`;
  const w = S.plan.semanas[S.week] || S.plan.semanas[0];
  const curIdx = Math.floor((mondayOf(new Date()) - new Date(S.plan.start + "T00:00:00")) / (7*864e5));
  const days = Array.from({length:7}, (_, i) => (w.dias||[]).find(d => d.dia === i) || { dia:i, sessoes:[] });
  const todayKey = dayKey(new Date());
  const mins = (w.dias||[]).flatMap(d => d.sessoes||[]).reduce((m, s) => { if (s.sport && s.sport !== "rest") for (const [k, v] of Object.entries(sportMinutes(s))) m[k] = (m[k]||0) + v; return m; }, {});
  const total = Object.values(mins).reduce((a,b)=>a+b,0);
  const doneBy = {}; S.activities.forEach(a => { (doneBy[dayKey(a.date)] ||= []).push(a); });
  return `<section class="panel"><div class="ph"><h2>${esc(w.foco || "Semana " + (S.week+1))}</h2><button class="btn ghost" data-act="plan" ${S.busy.plan ? "disabled" : ""}>${S.busy.plan ? '<span class="spin"></span> Reajustando' : "Reajustar semana"}</button></div>
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="weektabs">${S.plan.semanas.map((x, i) => `<button data-week="${i}" aria-pressed="${i === S.week}">S${i+1}${i === curIdx ? " · atual" : ""}</button>`).join("")}</div>
      <div class="legend"><span class="c-swim">Natação ${mins.swim||0} min</span><span class="c-bike">Bike ${mins.bike||0} min</span><span class="c-run">Corrida ${mins.run||0} min</span>${mins.strength ? `<span class="c-strength">Força ${mins.strength} min</span>` : ""}<span style="--c:var(--ink)">Total ${fmtDur(total*60)} · carga ${esc(w.carga || "—")}</span></div>
    </div>
    <div class="week">${days.map(d => { const date = planDate(S.week, d.dia); const ss = (d.sessoes||[]).filter(s => s.sport !== "rest");
      const done = doneBy[dayKey(date)] || [];
      return `<div class="day${dayKey(date) === todayKey ? " today" : ""}"><div class="dh"><span>${DOW[d.dia]}</span><span>${date.getDate()}/${date.getMonth()+1}</span></div>
      <div class="lbl">Planejado</div>
      ${ss.length ? ss.map(s => sessHTML(s, date <= new Date() ? date : null)).join("") : S.plan.fim && dayKey(date) > S.plan.fim ? `<div class="sess c-rest"><div class="t">A definir</div></div>` : `<div class="sess c-rest"><div class="t">Descanso</div></div>`}
      ${done.length ? `<div class="lbl">Feito</div>${done.map(doneHTML).join("")}` : ""}</div>`; }).join("")}</div>
    <p class="note" style="margin:14px 0 0"><b>${WEEK_GEN_TEXT}</b> Sessões ficam verdes quando um treino da mesma modalidade é feito no dia.</p></section>`;
}
function pills(name, opts, value){
  return `<div class="days pills" role="radiogroup">${opts.map(o => `<label><input type="radio" name="${name}" value="${esc(o)}" ${value === o ? "checked" : ""}>${esc(o)}</label>`).join("")}</div>`;
}
const pick = name => document.querySelector(`input[name="${name}"]:checked`)?.value || "";
function metodoHTML(){
  const ph = phaseFor(daysToRace()), tier = athleteTier(), d = S.plan?.distribuicao;
  const tierTxt = { A:"Iniciante ou menos de 6 h/semana: consistência, no máximo 2 treinos de qualidade por semana.", B:"Intermediário (6–10 h): 1 treino de qualidade por modalidade, limiar controlado, 1 brick por semana.", C:"Avançado (10 h+): 4–5 treinos de qualidade, pode usar duplo limiar 1x por semana." }[tier];
  return `<details class="panel metodo" style="margin-top:16px"><summary><b>Como o plano é montado</b> <span class="note">fase ${ph.fase} · nível ${tier}</span></summary>
    <div class="grid2 even" style="margin-top:14px">
      <div class="stack">
        ${S.plan?.metodo ? `<p style="margin:0">${esc(S.plan.metodo)}</p>` : ""}
        ${d ? `<div><div class="eyebrow" style="margin-bottom:6px">Distribuição de intensidade deste bloco</div><div class="mate"><div class="bars" style="height:12px"><i style="width:${d.leve}%;background:var(--ok)"></i><i style="width:${d.moderado}%;background:var(--warn)"></i><i style="width:${d.forte}%;background:var(--bad)"></i></div>
          <div class="legend"><span style="--c:var(--ok)">Fácil ${d.leve}%</span><span style="--c:var(--warn)">Moderado ${d.moderado}%</span><span style="--c:var(--bad)">Forte ${d.forte}%</span></div></div></div>` : ""}
        <p style="margin:0"><b>Fase ${ph.fase}:</b> ${esc(ph.nota)}.</p>
        <p style="margin:0"><b>Seu nível:</b> ${tierTxt}</p>
      </div>
      <ul class="tips">
        <li><b>Base piramidal, polarizado perto da prova:</b> 75–80% do tempo fácil. Dias fáceis são realmente fáceis.</li>
        <li><b>Norueguês adaptado:</b> tiros no limiar controlados (esforço 6–7/10), terminando com sensação de que daria mais.</li>
        <li><b>Natação:</b> frequência acima de volume, técnica em toda sessão, séries no ritmo CSS.</li>
        <li><b>Brick</b> semanal (bike → corrida) para a transição.</li>
        <li><b>Força pesada 2x por semana</b> (3–6 repetições) para economia de corrida e prevenção de lesão.</li>
        <li><b>Ciclos 3:1</b> e polimento de 10–14 dias com volume −40 a −60%.</li>
      </ul>
    </div></details>`;
}
function viewCoach(){
  const sugg = ["Como foi minha última semana?", "Estou sentindo o tendão de Aquiles", "Monte um treino de academia para hoje", "Estou cansado, ajuste o treino de amanhã"];
  return `<div class="hero"><div><div class="eyebrow">Coach</div><h1>Converse sobre seus treinos</h1><p>O coach lê seus dados e seu plano. Conte uma dor ou peça academia: ele pergunta o necessário, registra e monta a sessão de força no plano.</p></div>
    ${S.chat.length ? `<button class="btn ghost" data-act="clearchat">Limpar conversa</button>` : ""}</div>
  ${activeComplaints().length ? `<section class="panel" style="margin-bottom:16px"><div class="ph"><h2>Queixas em acompanhamento</h2><span class="note">Não substitui avaliação de fisioterapeuta</span></div>${complaintsHTML(true)}</section>` : ""}
  ${chatBox(false)}`;
}
function viewEquipe(){
  const team = S.team.slice().sort((a,b) => (b.week?.hours||0) - (a.week?.hours||0));
  const me = S.uid;
  const r = S.race;
  return `${countdownHTML(true)}
  <div class="hero"><div><div class="eyebrow">Participantes · ${team.length} de 4</div><h1>Quem larga junto</h1><p>Placar, evolução e conquistas de cada um até a largada. Aqui aparece só o resumo de treino; dores, peso, sono, alimentação e conversas ficam privados.</p></div></div>
  ${msgHTML("equipe")}
  ${S.isOwner ? `<details class="panel" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:600">Editar a prova do grupo</summary>
    <form class="f" id="raceform" style="margin-top:14px">
      <div class="fld"><label for="r_name">Nome da prova</label><input id="r_name" value="${esc(r.name)}"></div>
      <div class="fld"><label for="r_type">Distância</label><select id="r_type"><option value="">A definir</option>${Object.entries(RACES).map(([k,v]) => `<option value="${k}" ${r.type===k?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="fld"><label for="r_label">Nome da distância (opcional)</label><input id="r_label" value="${esc(r.label || "")}" placeholder="Ex: High Limits"></div>
      <div class="fld"><label for="r_date">Data</label><input id="r_date" type="date" value="${esc(r.date)}"></div>
      <div class="fld"><label for="r_time">Horário da largada</label><input id="r_time" type="time" value="${esc(r.time || "06:30")}"></div>
      <div class="fld full"><label for="r_place">Local</label><input id="r_place" value="${esc(r.place || "")}" placeholder="Cidade, lagoa, etc."></div>
      <div class="fld full"><div class="row"><button class="btn" type="submit">Salvar para todos</button><span class="note">Depois de mudar data ou distância, cada um gera o plano de novo.</span></div></div>
    </form></details>` : ""}
  ${team.length ? competitionHTML(team, me) : `<div class="empty"><h3>Ninguém por aqui ainda</h3><p class="muted" style="margin:0">Cada participante aparece depois de concluir o cadastro.</p></div>`}`;
}
const P = (t, k) => t.periods?.[S.period || "semana"]?.[k];
const BOARDS = [
  { k:"points", t:"Pontos", v: t => P(t,"points") ?? 0, f: v => `${fmtNum(v,0)} pts` },
  { k:"forma", t:"Condicionamento", v: t => t.forma ?? 0, f: v => fmtNum(v,1) },
  { k:"evol", t:"Evolução", v: t => { const f = P(t,"forma"), i = P(t,"forma_ini"); return f != null && i ? (f - i)/i*100 : 0; }, f: v => `${v > 0 ? "+" : ""}${fmtNum(v,1)}%` },
  { k:"hours", t:"Horas", v: t => P(t,"hours") ?? 0, f: v => `${fmtNum(v,1)} h` },
  { k:"sessions", t:"Treinos", v: t => P(t,"sessions") ?? 0, f: v => `${v}` },
  { k:"swim", t:"Natação", v: t => P(t,"swim_m") ?? 0, f: v => `${fmtNum(v,0)} m` },
  { k:"bike", t:"Bike", v: t => P(t,"bike_km") ?? 0, f: v => `${fmtNum(v,1)} km` },
  { k:"run", t:"Corrida", v: t => P(t,"run_km") ?? 0, f: v => `${fmtNum(v,1)} km` },
  { k:"const", t:"Constância", v: t => t.streakWeeks ?? 0, f: v => `${v} sem` }
];
function miniWeeks(t){
  const ws = t.weeks12 || []; if (!ws.length) return "";
  const tot = ws.map(w => w.s + w.b + w.r + w.o), max = Math.max(60, ...tot), W = 240, H = 44, bw = W/ws.length;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Minutos por semana nas últimas 12 semanas">${ws.map((w,i) => {
    let y = H; return [["s","swim"],["b","bike"],["r","run"],["o","muted"]].map(([k,c]) => { const h = w[k]/max*(H-4); y -= h; return h > 0 ? `<rect x="${(i*bw+1.5).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw-3).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--${c})"/>` : ""; }).join("") + `<title>${tot[i]} min</title>`; }).join("")}</svg>`;
}
function competitionHTML(team, me){
  const b0 = BOARDS.find(b => b.k === (S.board || "points")) || BOARDS[0];
  const board = rankStarted() ? b0 : { ...b0, v: () => 0 }; // antes do início, ninguém pontua
  const ranked = team.slice().sort((a,b) => board.v(b) - board.v(a));
  const pod = ranked.slice(0, 3);
  const feed = team.flatMap(t => (t.recent||[]).map(r => ({ ...r, nick: t.nick, uid: t.__id }))).sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
  const kudosCount = key => S.kudos.reduce((n, k) => n + (k.to?.[key] ? 1 : 0), 0);
  const gave = key => !!S.kudos.find(k => k.__id === me)?.to?.[key];
  const verb = { swim:"nadou", bike:"pedalou", run:"correu", strength:"treinou força", brick:"fez um brick", other:"treinou" };
  return `
  <section class="panel" style="margin-bottom:16px"><div class="ph"><h2>Placar</h2>
      <div class="seg" role="group" aria-label="Período">${Object.entries(PERIODS).map(([k,v]) => `<button data-period="${k}" aria-pressed="${(S.period || "semana") === k}">${v}</button>`).join("")}</div></div>
    ${rankStarted() ? "" : `<p class="status" style="margin:0 0 14px">O ranking começa a contar em ${new Date(RANK_START + "T12:00:00").toLocaleDateString("pt-BR")}. Até lá, ninguém pontua.</p>`}
    <div class="weektabs" style="margin-bottom:16px">${BOARDS.map(b => `<button data-board="${b.k}" aria-pressed="${b.k === board.k}">${b.t}</button>`).join("")}</div>
    <p class="note" style="margin:0 0 14px">${board.k === "forma" ? "Condicionamento atual de cada um (0–100)." : board.k === "const" ? "Semanas seguidas com 4 ou mais treinos." : board.k === "evol" ? `Variação do condicionamento desde o início do período (${periodStart(S.period || "semana").toLocaleDateString("pt-BR")}).` : `${PERIODS[S.period || "semana"]}: desde ${periodStart(S.period || "semana").toLocaleDateString("pt-BR")}.`}</p>
    <div class="podium">${pod.map((t, i) => `<div class="pod p${i+1}"><div class="medal">${i+1}º</div><b>${esc(t.nick)}${t.__id === me ? " (você)" : ""}</b><span class="mono">${board.f(board.v(t))}</span></div>`).join("")}</div>
    ${ranked.length > 3 ? `<ol class="rank" start="4">${ranked.slice(3).map(t => `<li><span>${esc(t.nick)}${t.__id === me ? " (você)" : ""}</span><span class="mono">${board.f(board.v(t))}</span></li>`).join("")}</ol>` : ""}
    ${board.k === "points" ? `<p class="note" style="margin:12px 0 0">Pontos = 10 por hora treinada + 5 por treino (até 2 por dia) + 20 se fez as 3 modalidades no período. Premia constância, não só volume.</p>` : ""}
    ${team.some(t => !t.periods) ? `<p class="note" style="margin:8px 0 0">Quem ainda não abriu o app nesta versão aparece com zero até entrar de novo.</p>` : ""}
  </section>
  <div class="team">${ranked.map(t => { const w = t.week || {}, ev = t.forma4 ? +((t.forma - t.forma4)/t.forma4*100).toFixed(1) : null;
    return `<article class="mate${t.__id === me ? " me" : ""}">
      <div class="row" style="justify-content:space-between"><h3>${esc(t.nick)}${t.__id === me ? ' <span class="note">(você)</span>' : ""}</h3><span class="mono">${rankStarted() ? t.points ?? 0 : 0} pts</span></div>
      <div class="note">${esc(t.level || "")}${t.adherence != null ? ` · aderência ${t.adherence}%` : ""}${t.streakDays ? ` · ${t.streakDays} dias seguidos` : ""}</div>
      <div class="kv" style="margin:0"><div><span>Condicionamento</span><b>${t.forma != null ? fmtNum(t.forma,1) : "—"}${ev != null ? ` <small class="delta ${ev >= 0 ? "good" : "bad"}">${ev >= 0 ? "▲" : "▼"}${Math.abs(ev)}%</small>` : ""}</b></div><div><span>Semana</span><b>${fmtNum(w.hours||0,1)} h · ${w.sessions ?? 0} treinos</b></div></div>
      ${miniWeeks(t)}
      <div class="legend"><span class="c-swim">${fmtNum(w.swim_m||0,0)} m</span><span class="c-bike">${fmtNum(w.bike_km||0,1)} km</span><span class="c-run">${fmtNum(w.run_km||0,1)} km</span></div>
      ${(t.badges||[]).length ? `<div class="badges">${t.badges.map(b => `<span class="badge" title="${esc(b.d)}">${esc(b.t)}</span>`).join("")}</div>` : ""}
    </article>`; }).join("")}</div>
  <section class="panel" style="margin-top:16px"><div class="ph"><h2>Últimos treinos do grupo</h2><span class="note">dê um aplauso para incentivar</span></div>
    ${feed.length ? `<div class="feed">${feed.map(f => { const key = `${f.uid}_${f.id}`.replace(/[^A-Za-z0-9_-]/g, ""), n = kudosCount(key);
      return `<div class="fitem"><span class="tag c-${f.sport}">${SPORTS[f.sport]}</span><div class="ftext"><b>${esc(f.nick)}</b> ${verb[f.sport] || "treinou"}${f.dist ? ` ${fmtDist(f.sport, f.dist)}` : ""} em ${fmtDur(f.mov)}${f.tipo ? ` · ${esc(f.tipo)}` : ""}<div class="note">${agoText(f.date)}</div></div>
      ${f.uid !== me ? `<button class="btn ghost sm kudo${gave(key) ? " on" : ""}" data-kudo="${key}" aria-pressed="${gave(key)}">👏 ${n || ""}</button>` : `<span class="note mono">👏 ${n}</span>`}</div>`; }).join("")}</div>`
      : `<p class="note" style="margin:0">Os treinos aparecem aqui quando alguém sincroniza ou registra.</p>`}
  </section>`;
}
function viewOnboarding(){
  return `${countdownHTML(true)}
  <div class="hero onb"><span class="logo-mark lg" style="width:120px;height:120px" aria-hidden="true"></span><div><div class="eyebrow">Primeiro acesso · 1 minuto</div><h1>Monte seu perfil de atleta</h1><p>Com essas respostas, seus treinos e o coach ficam ajustados para você. Depois disso você vai direto para o painel.</p></div></div>
  ${S.noDb ? `<div class="status err" style="margin-bottom:16px">Não consegui conectar ao banco de dados. Recarregue a página.</div>` : ""}
  ${msgHTML(S.view)}${S.view !== "dados" ? msgHTML("dados") : ""}
  <div class="grid2" style="margin-top:0">
    <section class="panel"><div class="ph"><h2>Seu perfil</h2></div>${profileFormHTML(true)}</section>
    <section class="panel stack"><div class="ph" style="margin:0"><h2>Seus treinos</h2></div>
      <p class="muted" style="margin:0">Cada participante conecta <b>o próprio Strava</b>. Usa Garmin ou Apple Watch? Eles enviam os treinos ao Strava, e o app lê de lá.</p>
      <div class="row">${stravaActionHTML()}</div>
      <p class="muted" style="margin:0">Treina sem relógio? Sem problema: você registra os treinos na aba Treinos e avalia o esforço de 1 a 10.</p>
    </section>
  </div>`;
}
function viewDados(){
  return `<div class="hero"><div><div class="eyebrow">Configurações</div><h1>Perfil, conexões e registros</h1><p>Edite seu cadastro, suas fontes de treino e tudo o que você já informou ao app.</p></div></div>
  ${S.noDb ? `<div class="status err" style="margin-bottom:16px">Não consegui conectar ao banco de dados. Recarregue a página.</div>` : ""}
  ${msgHTML("dados")}
  <div class="grid2" style="margin-top:0">
  <section class="panel"><div class="ph"><h2>Perfil de atleta</h2></div>${profileFormHTML(false)}</section>
  <div class="stack">${connectionsHTML()}${dataPanelHTML()}</div></div>
  ${registeredHTML()}`;
}
function dataPanelHTML(){
  return `<section class="panel stack"><div class="ph" style="margin:0"><h2>Seus dados</h2><span class="savestate" data-st="${S.saveState?.k || "idle"}">${esc(S.saveState?.t || "Tudo salvo")}</span></div>
    <p class="note" style="margin:0">Tudo o que você preenche é salvo na hora na base do app, na sua pasta: perfil, treinos, plano, check-ins, peso, alimentação e conversa. Ninguém do grupo vê seus detalhes; só o organizador do app tem acesso, para backup. No grupo aparece apenas o resumo da semana.</p>
    <div class="row"><button class="btn ghost" data-act="exportme">Baixar meus dados (.json)</button>
    ${S.isOwner ? `<button class="btn ghost" data-act="exportgroup" ${S.busy.export ? "disabled" : ""}>${S.busy.export ? '<span class="spin"></span> Exportando' : "Exportar dados do grupo"}</button>` : ""}</div></section>`;
}
function registeredHTML(){
  const del = (kind, id, label = "Apagar") => `<button class="btn ghost sm" data-regdel="${kind}:${esc(id)}">${label}</button>`;
  const comp = S.profile?.complaints || [];
  const ck = (S.checkins||[]).slice(-10).reverse(), wt = (S.weights||[]).slice(-10).reverse(), dt = (S.diet||[]).slice(-10).reverse();
  const empty = t => `<p class="note" style="margin:0">${t}</p>`;
  return `<section class="panel" style="margin-top:16px"><div class="ph"><h2>O que você já informou</h2><span class="note">Corrija ou apague registros. O coach e o plano usam estes dados.</span></div>
    <div class="grid2 even" style="margin-top:0">
      <div><div class="eyebrow" style="margin-bottom:6px">Dores e lesões</div><div class="reglist">${comp.length ? comp.map(c => `<div class="reg"><div><b>${esc(c.local)}</b> <span class="mono note">${c.intensidade != null ? c.intensidade + "/10" : ""}</span><div class="note">${c.resolvido ? "resolvida em " + fmtDate(c.resolvido+"T12:00:00") : "em acompanhamento"}</div></div><div class="row">${!c.resolvido ? del("resolve", c.id, "Resolvida") : ""}${del("comp", c.id)}</div></div>`).join("") : empty("Nenhuma registrada.")}</div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Recuperação (sono, Body Battery…)</div><div class="reglist">${ck.length ? ck.map(c => `<div class="reg"><div><b>${fmtDate(c.data+"T12:00:00")}</b><div class="note mono">${[c.sono ? c.sono+" h" : "", c.score ? "score "+c.score : "", c.bb ? "BB "+c.bb : "", c.hrv ? "HRV "+c.hrv : "", c.cans ? "cansaço "+c.cans+"/5" : ""].filter(Boolean).join(" · ")}</div></div>${del("ck", c.data)}</div>`).join("") : empty("Nenhum check-in ainda.")}</div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Peso</div><div class="reglist">${wt.length ? wt.map(w => `<div class="reg"><div><b>${fmtNum(w.kg,1)} kg</b><div class="note">${fmtDate(w.data+"T12:00:00")}</div></div>${del("wt", w.data)}</div>`).join("") : empty("Nenhuma pesagem ainda.")}</div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Alimentação</div><div class="reglist">${dt.length ? dt.map(d => `<div class="reg"><div><b>${fmtDate(d.data+"T12:00:00")}</b><div class="note">${esc(d.texto.slice(0,80))}${d.texto.length > 80 ? "…" : ""}</div></div>${del("diet", d.id)}</div>`).join("") : empty("Nenhum registro ainda.")}</div></div>
    </div>
    <div class="row" style="margin-top:14px"><span class="note">Conversa com o coach: ${S.chat.length} mensagens.</span>${S.chat.length ? `<button class="btn ghost sm" data-act="clearchat">Apagar conversa</button>` : ""}</div>
  </section>`;
}
function profileFormHTML(onboarding){
  const p = S.profile || {}, days = p.days || [0,1,2,3,5,6];
  return `
    <form class="f" id="profile">
      <div class="fld"><label for="nick">Como quer ser chamado</label><input id="nick" required value="${esc(p.nick||"")}" placeholder="Ex: Henrique"></div>
      <div class="fld"><label for="level">Nível</label><select id="level">${["iniciante","intermediário","avançado"].map(x => `<option ${p.level===x?"selected":""}>${x}</option>`).join("")}</select></div>
      <div class="fld full"><label>Prova alvo (definida para o grupo)</label><div class="status">${esc(S.race.name)} · ${new Date(S.race.date+"T12:00:00").toLocaleDateString("pt-BR")} · ${esc(raceLabel())}</div></div>
      <div class="fld"><label for="peso">Peso (kg)</label><input id="peso" type="number" min="30" max="200" step="0.1" value="${esc(p.peso||"")}" placeholder="72,5"></div>
      <div class="fld"><label for="altura">Altura (cm)</label><input id="altura" type="number" min="120" max="230" value="${esc(p.altura||"")}" placeholder="178"></div>
      <div class="fld"><label for="hours">Horas disponíveis por semana</label><input id="hours" type="number" min="2" max="25" step="0.5" value="${esc(p.hours||8)}"></div>
      <div class="fld"><label for="pool">Acesso à água</label><select id="pool">${["piscina 25 m","piscina 50 m","águas abertas","piscina e águas abertas"].map(x => `<option ${p.pool===x?"selected":""}>${x}</option>`).join("")}</select></div>
      <div class="fld full"><label>Dias disponíveis</label><div class="days">${DOW.map((d,i) => `<label><input type="checkbox" name="day" value="${i}" ${days.includes(i)?"checked":""}>${d}</label>`).join("")}</div></div>
      <div class="fld full"><label>Está com alguma lesão?</label>${pills("q_lesao", ["Não","Sim"], p.lesao || "Não")}
        <input id="q_lesao_qual" placeholder="Onde? Ex: joelho direito, tendão de Aquiles" value="${esc(p.lesaoQual||"")}" ${p.lesao === "Sim" ? "" : "hidden"}></div>
      <div class="fld full"><label>Qual é seu ponto fraco?</label>${pills("q_fraco", ["Natação","Bike","Corrida","Nenhum"], p.fraco || "")}</div>
      <div class="fld"><label>Possui rolo de treino?</label>${pills("q_rolo", ["Sim","Não"], p.rolo || "")}</div>
      <div class="fld"><label>Corre na esteira ou na rua?</label>${pills("q_corre", ["Rua","Esteira","Os dois"], p.corre || "")}</div>
      <div class="fld full"><label>Em um dia comum, quero treinar:</label>
        <div class="days pills">${[["1","Só 1 modalidade"],["2","Até 2 modalidades"],["1+gym","1 modalidade + academia"],["todas","Todas que o plano pedir"]].map(([v,l]) => `<label><input type="radio" name="q_pordia" value="${v}" ${p.porDia === v ? "checked" : ""}>${l}</label>`).join("")}</div></div>
      <div class="fld full"><label>Sábado, domingo e feriados: posso treinar todas as modalidades no mesmo dia?</label>${pills("q_fds", ["Sim","Não"], p.fds || "")}</div>
      <div class="fld full"><div class="row"><button class="btn" type="submit">${onboarding ? "Concluir cadastro" : "Salvar perfil"}</button>${!onboarding ? '<span class="note">Gere um novo plano após mudanças grandes.</span>' : ""}</div></div>
    </form>`;
}
function connectionsHTML(){
  return `<section class="panel"><div class="ph"><h2>Conexões</h2></div>
    ${sourceCard("strava", "STR", "#FC4C02", "Strava", "Cada participante conecta a própria conta do Strava. Garmin e Apple Watch enviam os treinos ao Strava automaticamente; daqui o app lê tudo.",
      stravaActionHTML())}
    <details class="more"><summary>Importar arquivos do Garmin ou Apple Watch</summary>
    ${sourceCard("garmin", "GRM", "#007CC3", "Garmin",
      `<b>Automático:</b> no app Garmin Connect, Mais → Configurações → Aplicativos conectados → Strava. Depois é só sincronizar o Strava aqui.<br><b>Arquivos:</b> envie .fit, .tcx, .gpx (Garmin Connect → atividade → ⚙ → Exportar original), o CSV da lista de atividades ou o .zip da exportação completa da conta.`,
      `<label class="btn ghost" for="f_garmin" style="cursor:pointer">${S.busy.import_garmin ? '<span class="spin"></span> Lendo' : "Importar arquivos"}</label><input id="f_garmin" data-src="garmin" type="file" multiple accept=".fit,.tcx,.gpx,.csv,.zip" hidden>`)}
    ${sourceCard("apple", "", "", "Apple Watch",
      `<b>Automático:</b> no app Strava do iPhone, Configurações → Aplicativos, serviços e dispositivos → Saúde → ative o envio de treinos. Depois sincronize o Strava aqui.<br><b>Arquivo:</b> no iPhone, app Saúde → sua foto → Exportar todos os dados de saúde. Envie o export.zip (ou o export.xml de dentro dele). Lemos só os treinos do último ano.`,
      `<label class="btn ghost" for="f_apple" style="cursor:pointer">${S.busy.import_apple ? '<span class="spin"></span> Lendo' : "Importar exportação"}</label><input id="f_apple" data-src="apple" type="file" accept=".zip,.xml,.gpx" hidden>`)}
    </details>
    <p class="note" style="margin:8px 0 0">${S.activities.length ? `${S.activities.length} atividades salvas${S.lastSync ? ` · última sincronização ${new Date(S.lastSync).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}` : ""}.` : "Nenhuma atividade salva."}</p>
  </section>`;
}

function sourceCard(key, abbr, color, title, note, action){
  const when = S.sources?.[key] || (key === "strava" ? S.lastSync : null);
  const n = S.activities.filter(a => a.src === key || (a.also||[]).includes(key)).length;
  const logo = key === "apple" ? `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="1" width="8" height="2" rx="1" fill="currentColor"/><rect x="8" y="21" width="8" height="2" rx="1" fill="currentColor"/></svg>` : abbr;
  return `<div class="source"><div class="logo" style="${color ? `color:${color}` : ""}">${logo}</div>
    <div><div class="row" style="gap:8px"><h3>${title}</h3>${when ? `<span class="tag" style="--c:var(--ok)">conectado</span>` : ""}</div>
    <div class="note" style="margin-top:4px">${note}</div>
    ${when ? `<div class="note mono" style="margin-top:6px">${n} treinos · atualizado ${new Date(when).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div>` : ""}</div>
    ${action}</div>`;
}
function render(){
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.v === S.view));
  const app = $("#app");
  const keepChat = $("#chatin")?.value || "";
  const hadFocus = document.activeElement?.id === "chatin";
  const y = window.scrollY;
  const onboarding = S.ready && !S.profile;
  $("#tabs").hidden = !S.ready || onboarding; $("#menubtn").hidden = $("#tabs").hidden;
  const rb = document.querySelector(".reloadbtn"); if (rb){ rb.hidden = !S.ready || !S.db; rb.disabled = !!S.busy.reload; }
  app.innerHTML = !S.ready ? app.innerHTML : onboarding ? viewOnboarding() : ({ painel:viewPainel, treinos:viewTreinos, coach:viewCoach, dieta:viewDieta, equipe:viewEquipe, dados:viewDados })[S.view]();
  let sh = $("#sheet"); if (!sh){ sh = document.createElement("div"); sh.id = "sheet"; document.body.append(sh); }
  sh.innerHTML = S.ready && S.openSess ? sessSheetHTML() : ""; document.body.classList.toggle("sheet-open", !!sh.innerHTML);
  const t = $("#chatin"); if (t){ t.value = keepChat; if (hadFocus) t.focus({ preventScroll:true }); scrollChat(); }
  if (S.view === "painel") window.scrollTo(0, y);
}

/** Re-render vindo de atualização em segundo plano: só redesenha se o dado mudou e preserva o que a pessoa está digitando. */
function bgRender(prev, next){
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  const key = el => el.id || (el.name && (el.type === "checkbox" || el.type === "radio") ? `${el.name}|${el.value}` : el.name);
  const keep = [...document.querySelectorAll("#app input, #app textarea, #app select")].filter(el => el.type !== "file" && key(el))
    .map(el => [key(el), el.type === "checkbox" || el.type === "radio" ? el.checked : el.value]);
  const focus = document.activeElement && key(document.activeElement), y = window.scrollY;
  render();
  const els = new Map([...document.querySelectorAll("#app input, #app textarea, #app select")].map(el => [key(el), el]));
  keep.forEach(([k, v]) => { const el = els.get(k); if (!el) return; if (typeof v === "boolean") el.checked = v; else el.value = v; });
  if (focus) els.get(focus)?.focus({ preventScroll:true });
  window.scrollTo(0, y);
}

/* ---------- eventos ---------- */
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b){ setMenu(false); go(b.dataset.v); } });
/* menu do celular: header compacto (logo + nome) e ☰ que abre abas, Recarregar e Sair */
function setMenu(open){ const h = $("header.top"); h.classList.toggle("open", open); $("#menubtn").setAttribute("aria-expanded", String(open)); $("#menubtn").setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu"); }
$("#menubtn").addEventListener("click", () => setMenu(!$("header.top").classList.contains("open")));
document.addEventListener("click", e => { if ($("header.top").classList.contains("open") && !e.target.closest("header.top")) setMenu(false); });
document.addEventListener("click", e => {
  const qt = e.target.closest(".qtip");
  document.querySelectorAll(".qtip[aria-expanded='true']").forEach(b => { if (b !== qt){ b.setAttribute("aria-expanded","false"); b.nextElementSibling.hidden = true; } });
  if (qt){ const open = qt.getAttribute("aria-expanded") !== "true"; qt.setAttribute("aria-expanded", String(open)); qt.nextElementSibling.hidden = !open; e.preventDefault(); return; }
  const g = e.target.closest("[data-go]"); if (g){ go(g.dataset.go); return; }
  const w = e.target.closest("[data-week]"); if (w){ S.week = +w.dataset.week; render(); return; }
  const q = e.target.closest("[data-ask]"); if (q){ sendChat(q.dataset.ask); return; }
  const qg = e.target.closest("[data-ask-go]"); if (qg){ go("coach"); sendChat(qg.dataset.askGo); return; }
  const sw = e.target.closest("[data-swap]"); if (sw){ const same = S.swap && S.swap.ref === sw.dataset.swap && S.swap.ei === +sw.dataset.ei; S.swap = same ? null : { ref: sw.dataset.swap, ei: +sw.dataset.ei }; render(); return; }
  const sp = e.target.closest("[data-swappick]"); if (sp){ applySwap(sp.dataset.swappick); return; }
  if (e.target.closest("[data-swapai]")){ swapAI(); return; }
  if (e.target.closest("[data-swapcustom]")){ const v = e.target.closest(".swappanel")?.querySelector(".swapcustom")?.value.trim(); if (v) applySwap(v); return; }
  if (e.target.closest("[data-swapclose]")){ S.swap = null; render(); return; }
  const op = e.target.closest("[data-open]"); if (op){ S.openSess = op.dataset.open; S.move = null; S.swap = null; render(); return; }
  if (e.target.closest("[data-closesheet]")){ S.openSess = null; S.move = null; S.swap = null; render(); return; }
  const mo = e.target.closest("[data-move]"); if (mo){ S.move = S.move === mo.dataset.move ? null : mo.dataset.move; render(); return; }
  const mt = e.target.closest("[data-moveto]"); if (mt){ movePlanned(mt.dataset.ref, +mt.dataset.moveto, false); return; }
  const sd = e.target.closest("[data-swapday]"); if (sd){ movePlanned(sd.dataset.ref, +sd.dataset.swapday, true); return; }
  if (e.target.closest("[data-moveclose]")){ S.move = null; render(); return; }
  const cm = e.target.closest("[data-calm]"); if (cm){ const n = +cm.dataset.calm, t = new Date(); const b = S.calMonth ? new Date(S.calMonth+"-01T12:00:00") : new Date(t.getFullYear(), t.getMonth(), 1); const nb = n === 0 ? new Date(t.getFullYear(), t.getMonth(), 1) : new Date(b.getFullYear(), b.getMonth()+n, 1); S.calMonth = `${nb.getFullYear()}-${String(nb.getMonth()+1).padStart(2,"0")}`; render(); return; }
  const cd = e.target.closest("[data-cald]"); if (cd){ S.calSel = cd.dataset.cald; render(); return; }
  const pd = e.target.closest("[data-period]"); if (pd){ S.period = pd.dataset.period; render(); return; }
  const bd = e.target.closest("[data-board]"); if (bd){ S.board = bd.dataset.board; render(); return; }
  const kd = e.target.closest("[data-kudo]"); if (kd && S.db && S.uid){
    const mine = S.kudos.find(k => k.__id === S.uid) || { __id: S.uid, to: {} }; const to = { ...(mine.to||{}) };
    if (to[kd.dataset.kudo]) delete to[kd.dataset.kudo]; else to[kd.dataset.kudo] = true;
    S.kudos = [...S.kudos.filter(k => k.__id !== S.uid), { __id: S.uid, to }]; render();
    S.db.collection("kudos").doc(S.uid).set({ to }).catch(() => {}); return; }
  const rd = e.target.closest("[data-regdel]"); if (rd){
    const [kind, id] = rd.dataset.regdel.split(/:(.*)/s);
    if (kind === "resolve"){ const c = (S.profile.complaints||[]).find(x => x.id === id); if (c){ c.resolvido = dayKey(new Date()); save("profile", S.profile); } render(); return; }
    if (rd.dataset.confirm !== "1"){ rd.dataset.confirm = "1"; rd.textContent = "Confirmar"; return; }
    if (kind === "comp"){ S.profile.complaints = (S.profile.complaints||[]).filter(x => x.id !== id); save("profile", S.profile); }
    if (kind === "ck"){ S.checkins = (S.checkins||[]).filter(x => x.data !== id); save("checkins", { list: S.checkins }); }
    if (kind === "wt"){ S.weights = (S.weights||[]).filter(x => x.data !== id); save("weights", { list: S.weights }); const l = S.weights.at(-1); if (l && S.profile){ S.profile.peso = l.kg; save("profile", S.profile); } }
    if (kind === "diet"){ S.diet = (S.diet||[]).filter(x => x.id !== id); save("diet", { list: S.diet }); }
    render(); return; }
  const del = e.target.closest("[data-del]"); if (del){
    if (del.dataset.confirm !== "1"){ del.dataset.confirm = "1"; del.textContent = "Confirmar"; return; }
    S.activities = S.activities.filter(x => x.id !== del.dataset.del); persistActivities(); saveTeam(); render(); return; }
  const rp = e.target.closest("[data-rpe]"); if (rp){ const act = S.activities.find(x => x.id === rp.dataset.id); if (act){ act.rpe = +rp.dataset.rpe; persistActivities(); render(); } return; }
  const rs = e.target.closest("[data-resolve]"); if (rs){ const c = (S.profile?.complaints||[]).find(x => x.id === rs.dataset.resolve); if (c){ c.resolvido = dayKey(new Date()); save("profile", S.profile); render(); } return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  ({ sync: syncStrava, plan: generatePlan, note: () => coachNote(true), stop: () => chatCtl?.abort(),
     editcheckin: () => { S.editCheckin = true; render(); },
     showlog: () => { S.showLog = true; if (S.view !== "treinos") S.view = "treinos"; render(); setTimeout(() => { $("#l_min")?.focus(); $(".logbox")?.scrollIntoView({ block:"start", behavior:"smooth" }); }, 0); },
     hidelog: () => { S.showLog = false; render(); },
     clearimg: () => { S.pendingImg = null; render(); },
     exportme: exportMine, exportgroup: exportGroup, reload: reloadAll, stravaon: () => TRI.connectStrava(), stravaoff: async () => { await TRI.disconnectStrava(); flash(S.view, "Strava desconectado.", false); },
     cleardietimg: () => { S.dietImg = null; if (S.dietImgUrl) URL.revokeObjectURL(S.dietImgUrl); S.dietImgUrl = null; render(); setTimeout(() => $("#dietimg")?.click(), 0); },
     addexrow: () => { $("#l_ex")?.insertAdjacentHTML("beforeend", strengthRow()); },
     clearchat: () => { S.chat = []; save("chat", { messages: [] }); render(); } })[a.dataset.act]?.();
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "chatform"){ const t = $("#chatin"); const v = t.value; t.value = ""; sendChat(v); }
  if (e.target.id === "profile"){
    const days = [...document.querySelectorAll('input[name="day"]:checked')].map(x => +x.value);
    S.profile = { ...(S.profile||{}), nick: $("#nick").value.trim(), level: $("#level").value,
      peso: parseFloat($("#peso").value) || null, altura: parseFloat($("#altura").value) || null,
      hours: +$("#hours").value, pool: $("#pool").value, days,
      lesao: pick("q_lesao") || "Não", lesaoQual: pick("q_lesao") === "Sim" ? $("#q_lesao_qual").value.trim() : "",
      fraco: pick("q_fraco"), rolo: pick("q_rolo"), corre: pick("q_corre"), porDia: pick("q_pordia"), fds: pick("q_fds"), updatedAt: new Date().toISOString() };
    delete S.profile.obs;
    if (S.profile.lesao === "Sim" && S.profile.lesaoQual && !activeComplaints().some(c => c.local.toLowerCase() === S.profile.lesaoQual.toLowerCase())){
      (S.profile.complaints ||= []).push({ id: "q" + Date.now(), local: S.profile.lesaoQual, intensidade: null, data: dayKey(new Date()), quando: "informado no cadastro", historico: [] });
    }
    const first = !S.profileSaved && !S.profile.createdAt;
    if (first) S.profile.createdAt = new Date().toISOString();
    S.profileSaved = true;
    save("profile", S.profile); saveTeam();
    if (S.profile.peso && (S.weights||[]).at(-1)?.kg !== S.profile.peso) addWeight(S.profile.peso);
    if (first){
      S.msg.painel = { text: "Cadastro feito. Puxando seus treinos e montando o plano…", err:false };
      go("painel");
      (async () => { if (!S.activities.length) await syncStrava(); if (!S.plan) await generatePlan(); S.msg.painel = null; coachNote(true); render(); })();
    } else flash("dados", "Perfil salvo.", false);
  }
  if (e.target.id === "checkin"){
    const n = id => { const x = parseFloat($("#" + id).value); return isNaN(x) ? null : x; };
    const sh = n("ci_sono_h"), sm = n("ci_sono_m");
    const c = { sono: sh == null && sm == null ? null : Math.round(((sh || 0) + (sm || 0) / 60) * 100) / 100, score: n("ci_score"), qual: n("ci_qual"), hrv: n("ci_hrv"), bb: n("ci_bb"), rhr: n("ci_rhr"), cans: n("ci_cans") };
    if (Object.values(c).every(v => v == null)){ flash("painel", "Preencha pelo menos um campo do check-in.", true); return; }
    saveRecovery(c); S.editCheckin = false; render();
    coachNote(true);
  }
  if (e.target.id === "dietform"){ analyzeDiet($("#diettext").value); }
  if (e.target.id === "weighform"){ const w = addWeight($("#w_kg").value); flash(S.view, w ? `Peso registrado: ${fmtNum(w.kg,1)} kg.` : "Informe um peso válido em kg.", !w); }
  if (e.target.id === "logform"){
    const x = readLog();
    if (x.sport === "strength" && !x.obs && x.forca.length) x.obs = x.forca.map(f => `${f.nome} ${f.series||""}x${f.reps||""}${f.kg ? " " + f.kg + " kg" : ""}`).join("; ");
    const a = addManualWorkout(x);
    if (!a){ flash(S.view, "Não consegui salvar: confira a data.", true); return; }
    S.showLog = false; S.logSport = null; S.logDate = null;
    flash(S.view, `Treino salvo: ${[SPORTS[x.sport], x.min ? `${x.min} min` : "", x.rpe ? `esforço ${x.rpe}/10` : ""].filter(Boolean).join(", ")}.`, false);
    replanTriedAt = 0; if (needsReplan()) maybeReplan(); else coachNote(true);
  }
  if (e.target.id === "raceform"){
    const r = { name: $("#r_name").value.trim() || "Prova da equipe", date: $("#r_date").value || RACE_DEFAULT.date, time: $("#r_time").value || "06:30", type: $("#r_type").value, label: $("#r_label").value.trim(), place: $("#r_place").value.trim() };
    S.race = r; render();
    if (S.db) S.db.doc("config/race").set(r).then(() => flash("equipe", "Prova atualizada para todos.", false)).catch(err => flash("equipe", "Só o dono do app pode alterar a prova (" + (err?.code || "erro") + ").", true));
  }
});
function updateLogPreview(){ const p = $("#l_preview"); if (!p) return; const x = readLog(); p.innerHTML = logPreviewHTML(x); const z = $("#l_zone"); if (z) z.textContent = x.rpe ? `${ZONA_RPE(x.rpe)} · ${RPE[x.rpe]}` : ""; }
document.addEventListener("input", e => { if (e.target.closest?.("#logform")) updateLogPreview(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.openSess){ S.openSess = null; S.move = null; S.swap = null; render(); return; } if (e.target.id === "chatin" && e.key === "Enter" && !e.shiftKey){ e.preventDefault(); $("#chatform").requestSubmit(); } });
document.addEventListener("change", async e => {
  if (e.target.dataset?.rpesel && e.target.value){ const act = S.activities.find(x => x.id === e.target.dataset.rpesel); if (act){ act.rpe = +e.target.value; persistActivities(); render(); } return; }
  if (e.target.name === "q_lesao"){ const q = $("#q_lesao_qual"); if (q){ q.hidden = e.target.value !== "Sim"; if (!q.hidden) q.focus(); } return; }
  if (e.target.name === "l_sport"){ S.logSport = e.target.value; S.logDate = $("#l_date")?.value; render(); return; }
  if (e.target.id === "l_date"){ S.logSport = pick("l_sport"); S.logDate = e.target.value; render(); return; }
  if (e.target.name === "l_dor"){ const b = $("#l_dorbox"); if (b) b.hidden = e.target.value !== "Sim"; }
  if (e.target.id === "l_plan" && e.target.value){ const s = plannedFor($("#l_date").value).find(p => p.ref === e.target.value); const m = $("#l_min"); if (s?.min && m && !m.value) m.value = s.min; }
  if (e.target.closest?.("#logform")) updateLogPreview();
  if (e.target.id === "dietimg" && e.target.files[0]){ S.dietImg = e.target.files[0]; if (S.dietImgUrl) URL.revokeObjectURL(S.dietImgUrl); S.dietImgUrl = URL.createObjectURL(S.dietImg); e.target.value = ""; const t = $("#diettext")?.value; render(); if (t) $("#diettext").value = t; return; }
  if (e.target.id === "chatimg" && e.target.files[0]){ S.pendingImg = e.target.files[0]; e.target.value = ""; render(); return; }
  const src = e.target.dataset?.src;
  if (!src || !e.target.files.length) return;
  const files = [...e.target.files]; e.target.value = "";
  importFiles(files, src);
});

/* ---------- boot ---------- */
/* recarrega do banco tudo o que está salvo (perfil, treinos, plano, check-ins, peso, alimentação, conversa, grupo e prova) */
async function loadMine(){
  const base = S.db.collection("data/users/" + S.uid);
  const [p, a, pl, c, ck, dt, wt] = await Promise.all(["profile","activities","plan","chat","checkins","diet","weights"].map(n => base.doc(n).get().catch(() => null)));
  S.profile = p?.exists ? p.data() : S.profile; if (p?.exists) S.profileSaved = true;
  if (a?.exists){ const d = a.data(); S.activities = d.list || []; S.zones = d.zones || null; S.lastSync = d.syncedAt || null; S.sources = d.sources || null; }
  if (pl?.exists) S.plan = pl.data();
  if (c?.exists) S.chat = c.data().messages || [];
  if (ck?.exists) S.checkins = ck.data().list || [];
  if (dt?.exists) S.diet = dt.data().list || [];
  if (wt?.exists) S.weights = wt.data().list || [];
  if (S.plan){ const i = Math.floor((mondayOf(new Date()) - new Date(S.plan.start + "T00:00:00")) / (7*864e5)); S.week = Math.max(0, Math.min(i, S.plan.semanas.length-1)); }
}
async function reloadAll(){
  if (!S.db || S.busy.reload) return;
  busy("reload", true); setSaveState({ k:"saving", t:"Recarregando…" }); render();
  try {
    await Promise.all(Object.values(queues));
    await loadMine();
    const [race, team, kudos] = await Promise.all([S.db.doc("config/race").get().catch(() => null), S.db.collection("team").get().catch(() => null), S.db.collection("kudos").get().catch(() => null)]);
    if (race?.exists) S.race = { ...RACE_DEFAULT, ...race.data() };
    if (team) S.team = team.docs.map(d => ({ __id: d.id, ...d.data() }));
    if (kudos) S.kudos = kudos.docs.map(d => ({ __id: d.id, ...d.data() }));
    busy("reload", false);
    setSaveState({ k:"ok", t:"Atualizado " + new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) });
    render();
    if (S.sources?.strava) syncStrava(); else saveTeam();
  } catch (e) { busy("reload", false); setSaveState({ k:"err", t:"Erro ao recarregar" }); render(); }
}
async function boot(){
  render();
  const [db, user] = await Promise.all([cap("db"), cap("user")]);
  const uid = user ? await user.id().catch(() => null) : null;
  if (!db || !uid){ S.noDb = true; S.ready = true; render(); return; }
  S.db = db; S.uid = uid;
  S.isOwner = await user.isOwner().catch(() => false);
  db.doc("config/race").onSnapshot(snap => { if (snap.exists){ const prev = S.race; S.race = { ...RACE_DEFAULT, ...snap.data() }; bgRender(prev, S.race); } }, () => {});
  cap("sample").then(s => s?.limits?.().then(l => { const prev = S.canImg; S.canImg = !!l?.images; bgRender(prev, S.canImg); }).catch(() => {}));
  await loadMine();
  S.ready = true; render();
  maybeReplan(); setInterval(maybeReplan, 10*60e3); // pega o domingo 19h mesmo com o app aberto
  db.collection("team").onSnapshot(snap => { const prev = S.team; S.team = snap.docs.map(d => ({ __id: d.id, ...d.data() })); if (S.view === "equipe") bgRender(prev, S.team); }, () => {});
  db.collection("kudos").onSnapshot(snap => { const prev = S.kudos; S.kudos = snap.docs.map(d => ({ __id: d.id, ...d.data() })); if (S.view === "equipe") bgRender(prev, S.kudos); }, () => {});
  if (S.profile) saveTeam();
  const sv = new URLSearchParams(location.search).get("strava");
  if (sv){ history.replaceState(null, "", "/");
    const m = { ok:"Strava conectado! Buscando seus treinos…", negado:"Você cancelou a conexão com o Strava.", "sem-permissao":"Para ler seus treinos, marque a permissão de ver atividades ao conectar o Strava.", limite:"O app do Strava ainda não foi liberado para mais atletas. Veja o README (limite de atletas do Strava).", erro:"Não consegui conectar o Strava. Tente de novo." }[sv] || "";
    if (sv === "ok"){ TRI.me.strava = { connected:true }; flash(S.view, m, false); syncStrava(); } else flash(S.view, m, true); }
  coachNote(false);
}
window.__startApp = boot;
})();
