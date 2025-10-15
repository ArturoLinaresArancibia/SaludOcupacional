import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, EXTERNAL_PORTAL_URL } from "./config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (sel)=>document.querySelector(sel);
const show = (id)=>$(id).classList.remove('hidden');
const hide = (id)=>$(id).classList.add('hidden');

document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabview').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    $("#tab-"+btn.dataset.tab).classList.add('active');
  });
});
$("#iframe-externo").src = EXTERNAL_PORTAL_URL;

async function refresh() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    hide("#view-login"); show("#view-app");
    $("#btn-login").classList.add("hidden");
    $("#btn-logout").classList.remove("hidden");
    loadData(user);
  } else {
    show("#view-login"); hide("#view-app");
    $("#btn-login").classList.remove("hidden");
    $("#btn-logout").classList.add("hidden");
  }
}
document.querySelector("#login-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) { alert(error.message); return; }
  document.querySelector("#login-msg").classList.remove("hidden");
});
document.querySelector("#btn-login").addEventListener("click", ()=>{ show("#view-login"); hide("#view-app"); });
document.querySelector("#btn-logout").addEventListener("click", async ()=>{ await supabase.auth.signOut(); location.reload(); });

async function loadData(user){
  const email = user?.email;

  // USUARIO (limit(1) para evitar single())
  const u = await supabase.from('usuarios').select('rut,email,nombre,rol').eq('email', email).limit(1);
  const me = (u.data||[])[0];
  if (u.error) { $("#perfil").innerHTML = `<span class="muted">${u.error.message}</span>`; }
  else if (!me) { $("#perfil").innerHTML = `<span class="muted">No existe fila en 'usuarios' para ${email}</span>`; }
  else { $("#perfil").innerHTML = `<div><strong>${me.nombre ?? 'Sin nombre'}</strong></div><div class="muted">${me.email}</div>`; }

  // ROL
  let rol = (me?.rol || 'trabajador').toLowerCase();
  if (!me?.rol) {
    const r = await supabase.from('roles').select('rol').eq('email', email).limit(1);
    if (!r.error && r.data?.length) rol = r.data[0].rol.toLowerCase();
  }
  if (['salud','admin'].includes(rol)) document.querySelectorAll('.tab-salud').forEach(t=>t.classList.remove('hidden'));

  // TRABAJADOR por rut o email
  let t;
  if (me?.rut) t = (await supabase.from('trabajadores').select('*').eq('rut', me.rut).limit(1)).data?.[0];
  else t = (await supabase.from('trabajadores').select('*').eq('email', email).limit(1)).data?.[0];

  // KPIs
  const imc = calcIMC(t?.peso_kg, t?.altura_cm);
  const edad = calcEdad(t?.fecha_nacimiento);
  const kpis = [
    { title: 'Edad', value: isNaN(edad)?'—':`${edad} años` },
    { title: 'IMC', value: isNaN(imc)?'—':imc.toFixed(1) },
    { title: 'Empresa', value: t?.empresa ?? '—' }
  ];
  $("#kpis").innerHTML = kpis.map(k=>`<div class="kpi"><div class="title">${k.title}</div><div class="value">${k.value}</div></div>`).join('');

  // ALERTAS
  const evalsRes = await supabase.from('v_alertas').select('*').order('dias_restantes');
  if (evalsRes.error) { $("#alertas").innerHTML = `<span class="muted">${evalsRes.error.message}</span>`; }
  else renderAlertas(evalsRes.data || []);
  setStatusChip(evalsRes.data || []);

  // LABS
  const labsRes = await supabase.from('examenes').select('*').order('fecha', { ascending: false }).limit(200);
  if (labsRes.error && labsRes.error.code === '42501') {
    $("#labs tbody").innerHTML = `<tr><td colspan="6" class="muted">Sin permisos para ver exámenes. Revisa RLS (examenes).</td></tr>`;
  } else {
    const full = labsRes.data ?? [];
    renderLabs(full);
    $("#filtro-labs").addEventListener("input", (e)=>{
      const q = e.target.value.toLowerCase();
      const filtered = full.filter(l =>
        (l.tipo||'').toLowerCase().includes(q) ||
        (l.parametro||'').toLowerCase().includes(q) ||
        (l.interpretacion||'').toLowerCase().includes(q)
      );
      renderLabs(filtered);
    });
  }

  // HIGIENE (vista)
  const higRes = await supabase.from('v_higiene').select('*').order('fecha', { ascending: false }).limit(200);
  if (higRes.error) {
    $("#hig-msg").textContent = higRes.error.message;
  } else {
    renderHigiene(higRes.data || []);
  }

  // CITACIONES
  const citaRes = await supabase.from('citaciones').select('*').order('fecha').limit(200);
  if (citaRes.error && citaRes.error.code === '42501') {
    $("#cit-msg").textContent = "Sin permisos para ver citaciones. Revisa RLS (citaciones).";
  }
  renderCitaciones(citaRes);

  // RECOMENDACIONES
  const recos = buildRecommendations(t, (labsRes.data||[]));
  $("#reco-cards").innerHTML = recos.length
    ? recos.map(r=>`<div class="reco"><strong>${r.title}</strong><div class="muted">${r.detail}</div></div>`).join('')
    : `<span class="muted">Sin recomendaciones específicas. ¡Buen trabajo!</span>`;

  // DASHBOARD + SUPERVISOR
  if (['salud','admin'].includes(rol)) {
    const [venc, imcR, glu, chol] = await Promise.all([
      supabase.from('resumen_vencimientos').select('*'),
      supabase.from('resumen_imc').select('*'),
      supabase.from('resumen_labs_glucosa').select('*'),
      supabase.from('resumen_labs_colesterol').select('*')
    ]);
    if (venc.error) $('#dash-msg').textContent = venc.error.message; else if (venc.data?.length) renderVenc(venc.data); else $('#dash-msg').textContent = "Completa y refresca los resúmenes.";
    if (imcR.error) $('#dash-msg-imc').textContent = imcR.error.message; else if (imcR.data?.length) renderIMC(imcR.data); else $('#dash-msg-imc').textContent = "Sin datos IMC.";
    if (glu.error) $('#dash-msg-glu').textContent = glu.error.message; else if (glu.data?.length) renderGlu(glu.data); else $('#dash-msg-glu').textContent = "Sin datos de glucosa.";
    if (chol.error) $('#dash-msg-chol').textContent = chol.error.message; else if (chol.data?.length) renderChol(chol.data); else $('#dash-msg-chol').textContent = "Sin datos de colesterol.";

    setupSupervisor();
  }
}

// Supervisor (igual que v8)
function setupSupervisor(){
  const input = document.querySelector('#srch');
  const results = document.querySelector('#srch-results');
  const clear = document.querySelector('#btn-clear');
  let lastQ = "", timer;

  clear.addEventListener('click', ()=>{
    input.value = "";
    results.innerHTML = "";
    document.querySelector('#sup-detail').style.display = 'none';
  });

  input.addEventListener('input', (e)=>{
    const q = e.target.value.trim();
    if (q === lastQ) return;
    lastQ = q;
    clearTimeout(timer);
    if (!q){ results.innerHTML = ""; return; }
    timer = setTimeout(()=> searchWorkers(q, results), 280);
  });
}

async function searchWorkers(q, container){
  container.innerHTML = `<span class="muted">Buscando…</span>`;
  const u = await supabase
    .from('usuarios')
    .select('rut,nombre,email')
    .or(`nombre.ilike.%${q}%,email.ilike.%${q}%,rut.ilike.%${q}%`)
    .limit(20);
  if (u.error){ container.innerHTML = `<span class="muted">${u.error.message}</span>`; return; }
  if (!u.data?.length){ container.innerHTML = `<span class="muted">Sin resultados</span>`; return; }

  const ruts = u.data.map(x=>x.rut).filter(Boolean);
  let mapTrab = {};
  if (ruts.length){
    const t = await supabase.from('trabajadores').select('rut,gerencia,empresa').in('rut', ruts);
    if (!t.error && t.data){ mapTrab = Object.fromEntries(t.data.map(x=>[x.rut, x])); }
  }

  container.innerHTML = u.data.map(w=>{
    const t = mapTrab[w.rut] || {};
    return `<div class="row" style="justify-content:space-between;border:1px solid #e5e7eb;padding:8px;border-radius:12px;cursor:pointer" data-rut="${w.rut}">
      <div><strong>${w.nombre||'Sin nombre'}</strong><div class="muted">${w.email||''} ${t.gerencia? '• '+t.gerencia:''}</div></div>
      <span class="badge">Ver</span>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-rut]').forEach(el=>{
    el.addEventListener('click', ()=> loadWorkerDetail(el.dataset.rut));
  });
}

async function loadWorkerDetail(rut){
  document.querySelector('#sup-detail').style.display = 'block';
  const tRes = await supabase.from('trabajadores').select('*').eq('rut', rut).limit(1);
  const uRes = await supabase.from('usuarios').select('email,nombre').eq('rut', rut).limit(1);
  const t = (tRes.data||[])[0], u = (uRes.data||[])[0];
  const email = u?.email || t?.email || '';
  const nombre = u?.nombre || t?.nombre || 'Sin nombre';
  const perfilHtml = t ? `<div><strong>${nombre}</strong></div>
      <div class="muted">${email}</div><div class="muted">${t.empresa||'—'} • ${t.gerencia||'—'}</div>
      <div class="muted">RUT: ${rut}</div>` : `<div><strong>${nombre}</strong></div><div class="muted">${email}</div><div class="muted">RUT: ${rut}</div>`;
  document.querySelector('#sup-perfil').innerHTML = perfilHtml;

  const imc = calcIMC(t?.peso_kg, t?.altura_cm);
  const edad = calcEdad(t?.fecha_nacimiento);
  const kpis = [
    { title:'Edad', value:isNaN(edad)?'—':`${edad} años` },
    { title:'IMC', value:isNaN(imc)?'—':imc.toFixed(1) },
    { title:'Altura', value: t?.altura_cm? `${t.altura_cm} cm` : '—' }
  ];
  document.querySelector('#sup-kpis').innerHTML = kpis.map(k=>`<div class="kpi"><div class="title">${k.title}</div><div class="value">${k.value}</div></div>`).join('');

  const cit = await supabase.from('citaciones').select('*').eq('rut', rut).order('fecha');
  renderTable('#sup-cit tbody', cit);

  const labs = await supabase.from('examenes').select('*').eq('rut', rut).order('fecha', { ascending:false });
  const allLabs = labs.data || [];
  renderLabsGeneric('#sup-labs tbody', allLabs);
  const filter = document.querySelector('#sup-filtro-labs');
  filter.value = '';
  filter.oninput = (e)=>{
    const q = e.target.value.toLowerCase();
    const filtered = allLabs.filter(l =>
      (l.tipo||'').toLowerCase().includes(q) ||
      (l.parametro||'').toLowerCase().includes(q) ||
      (l.interpretacion||'').toLowerCase().includes(q)
    );
    renderLabsGeneric('#sup-labs tbody', filtered);
  };

  const hig = await supabase.from('exposiciones').select('*').eq('rut', rut).order('fecha', { ascending:false });
  if (hig.error && hig.error.code === '42501'){
    document.querySelector('#sup-hig tbody').innerHTML = `<tr><td colspan="6" class="muted">Sin permisos para ver exposiciones. Revisa RLS.</td></tr>`;
  } else {
    renderHigieneGeneric('#sup-hig tbody', hig.data||[]);
  }
}

// Renders
function renderTable(sel, res){
  const tbody = document.querySelector(sel);
  if (res.error){ tbody.innerHTML = `<tr><td colspan="6" class="muted">${res.error.message}</td></tr>`; return; }
  const rows = res.data||[];
  if (!rows.length){ tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin registros</td></tr>`; return; }
  tbody.innerHTML = rows.map(c=>`<tr>
    <td>${c.fecha??''}</td><td>${c.hora??''}</td><td>${c.tipo??''}</td>
    <td>${c.centro??''}</td><td>${c.direccion??''}</td><td>${c.estado??''}</td>
  </tr>`).join('');
}
function renderLabsGeneric(sel, rows){
  const tbody = document.querySelector(sel);
  if (!rows.length){ tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin resultados</td></tr>`; return; }
  tbody.innerHTML = rows.map(l=>`<tr>
    <td>${l.tipo ?? ''}</td><td>${l.parametro ?? ''}</td><td>${l.fecha ?? ''}</td>
    <td>${l.resultado ?? ''} ${l.unidad ?? ''}</td><td>${l.referencia ?? ''}</td><td>${l.interpretacion ?? ''}</td>
  </tr>`).join('');
}
function renderHigieneGeneric(sel, rows){
  const tb = document.querySelector(sel);
  if (!rows.length){ tb.innerHTML = `<tr><td colspan="6" class="muted">Sin registros</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>{
    const pct = (r.oel && r.oel!=0 && r.valor!=null) ? Math.round((r.valor/r.oel)*1000)/10 : null;
    let nivel = 'Sin dato';
    if (pct!=null){
      if (pct>100) nivel='Crítico (>100%)'; else if (pct>=70) nivel='Próximo (70–100%)'; else nivel='OK (<70%)';
    }
    const badge = (nivel)=>{
      if (nivel.startsWith('Crítico')) return `<span class="badge crit">${nivel}</span>`;
      if (nivel.startsWith('Próximo')) return `<span class="badge warn">${nivel}</span>`;
      if (nivel.startsWith('OK')) return `<span class="badge ok">${nivel}</span>`;
      return `<span class="badge">${nivel}</span>`;
    };
    return `<tr>
      <td>${r.agente ?? ''}</td><td>${r.ges ?? '—'}</td><td>${r.fecha ?? ''}</td>
      <td>${r.valor ?? ''} ${r.unidad ?? ''}</td><td>${r.oel ?? ''} ${r.unidad ?? ''}</td>
      <td>${badge(nivel)} ${pct!=null?`(${pct}% OEL)`:''}</td>
    </tr>`;
  }).join('');
}
function renderAlertas(list){
  const el = document.querySelector("#alertas");
  if (!list.length){ el.innerHTML = `<span class="muted">Sin alertas</span>`; return; }
  el.innerHTML = list.map(e=>{
    const d = e.dias_restantes;
    const cls = d < 0 ? 'crit' : (d <= 30 ? 'crit' : (d <= 60 ? 'warn' : 'ok'));
    const label = d < 0 ? 'Vencido' : (d <= 30 ? 'Crítico' : (d <= 60 ? 'Próximo' : 'OK'));
    return `<div class="row" style="justify-content:space-between;align-items:center;border:1px solid #e5e7eb;padding:10px;border-radius:12px">
      <div><strong>${e.tipo}</strong><div class="muted">Vence ${e.valido_hasta}</div></div>
      <span class="badge ${cls}">${label} · ${d} días</span>
    </div>`;
  }).join('');
}
function setStatusChip(alertas){
  const el = document.querySelector('#status-chip');
  if (!alertas.length){ el.textContent = '✅ Al día'; el.className = 'chip chip-ok'; return; }
  const dias = alertas.map(a=>a.dias_restantes);
  const min = Math.min(...dias);
  if (min < 0){ el.textContent = '⛔ Vencido'; el.className = 'chip chip-crit'; }
  else if (min <= 30){ el.textContent = '⚠️ Crítico (≤30d)'; el.className = 'chip chip-crit'; }
  else if (min <= 60){ el.textContent = '⚠️ Próximo (≤60d)'; el.className = 'chip chip-warn'; }
  else { el.textContent = '✅ Al día'; el.className = 'chip chip-ok'; }
}
function renderLabs(rows){
  const tbody = document.querySelector("#labs tbody");
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin resultados</td></tr>`; return; }
  tbody.innerHTML = rows.map(l=>`<tr>
    <td>${l.tipo ?? ''}</td><td>${l.parametro ?? ''}</td><td>${l.fecha ?? ''}</td>
    <td>${l.resultado ?? ''} ${l.unidad ?? ''}</td><td>${l.referencia ?? ''}</td><td>${l.interpretacion ?? ''}</td>
  </tr>`).join('');
}
function renderCitaciones(citaRes){
  const tbody = document.querySelector("#citaciones tbody");
  if (citaRes.error){ tbody.innerHTML = `<tr><td colspan="6" class="muted">${citaRes.error.message}</td></tr>`; return; }
  const rows = citaRes.data||[];
  if (!rows.length){
    $("#citaciones-count").textContent = "0";
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin citaciones</td></tr>`;
    return;
  }
  $("#citaciones-count").textContent = rows.length;
  tbody.innerHTML = rows.map(c=>`<tr>
    <td>${c.fecha ?? ''}</td><td>${c.hora ?? ''}</td><td>${c.tipo ?? ''}</td>
    <td>${c.centro ?? ''}</td><td>${c.direccion ?? ''}</td><td>${c.estado ?? ''}</td>
  </tr>`).join('');
}

// CALC
function calcIMC(peso, alturaCm){ const m=(alturaCm||0)/100; if(!peso||!m) return NaN; return peso/(m*m); }
function calcEdad(iso){ if(!iso) return NaN; const d=new Date(iso); const diff=Date.now()-d.getTime(); return Math.floor(diff/(1000*60*60*24*365.25)); }
function parseNumber(x){ if(x==null) return NaN; const s=String(x).replace(',', '.').match(/[0-9.]+/g); return s ? parseFloat(s.join('')) : NaN; }
function buildRecommendations(trab, labs){
  const recos = [];
  if (trab){
    const imc = calcIMC(trab.peso_kg, trab.altura_cm);
    if (!isNaN(imc)){
      if (imc >= 30) recos.push({ title: "IMC en rango obesidad", detail: "Consulta nutricional y actividad física progresiva." });
      else if (imc >= 25) recos.push({ title: "IMC sobrepeso", detail: "Agua como bebida principal, colaciones con proteína, 150 min/sem de actividad moderada." });
      else if (imc < 18.5) recos.push({ title: "IMC bajo peso", detail: "Refuerzo calórico y entrenamiento de fuerza." });
      else recos.push({ title: "IMC saludable", detail: "Mantén hábitos actuales." });
    }
  }
  const byParam = {}; (labs||[]).forEach(l=>{ const k=(l.parametro||'').toLowerCase(); if(!byParam[k]) byParam[k]=[]; byParam[k].push(l); });
  const last = p => (byParam[p]||[])[0];
  const glu = last('glucosa'); if (glu){ const v=parseNumber(glu.resultado);
    if (!isNaN(v)){ if (v >= 126) recos.push({ title: "Glucosa elevada (≥126)", detail: "Agenda control médico." });
      else if (v >= 100) recos.push({ title: "Glucosa 100–125", detail: "Reduce azúcares simples, aumenta fibra y proteína." });
      else recos.push({ title: "Glucosa normal", detail: "Mantén dieta equilibrada." });
    } }
  const chol = last('colesterol total'); if (chol){ const v=parseNumber(chol.resultado);
    if (!isNaN(v)){ if (v >= 240) recos.push({ title: "Colesterol alto (≥240)", detail: "Consulta médica y ajustes de dieta." });
      else if (v >= 200) recos.push({ title: "Colesterol límite (200–239)", detail: "Ajustes de dieta y actividad física." });
      else recos.push({ title: "Colesterol deseable (<200)", detail: "Sigue con hábitos actuales." });
    } }
  return recos;
}

supabase.auth.onAuthStateChange(()=>{ refresh(); });
refresh();
