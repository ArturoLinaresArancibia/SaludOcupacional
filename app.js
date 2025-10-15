import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, EXTERNAL_PORTAL_URL } from "./config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (sel)=>document.querySelector(sel);
const show = (id)=>$(id).classList.remove('hidden');
const hide = (id)=>$(id).classList.add('hidden');

// Tabs
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabview').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    const name = btn.dataset.tab;
    $("#tab-"+name).classList.add('active');
  });
});
$("#iframe-externo").src = EXTERNAL_PORTAL_URL;

// Auth
async function refresh() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    hide("#view-login"); show("#view-app");
    $("#btn-login").classList.add("hidden");
    $("#btn-logout").classList.remove("hidden");
    loadData();
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

async function loadData(){
  try {
    // Perfil y rol
    const meRes = await supabase.from('usuarios').select('*').maybeSingle();
    if (meRes.error) document.querySelector("#perfil").innerHTML = `<span class="muted">${meRes.error.message}</span>`;
    else if (meRes.data) document.querySelector("#perfil").innerHTML = `<div><strong>${meRes.data.nombre ?? 'Sin nombre'}</strong></div><div class="muted">${meRes.data.email}</div>`;
    else document.querySelector("#perfil").innerHTML = `<span class="muted">Sin registro en usuarios</span>`;
    const rol = (meRes.data?.rol || 'trabajador').toLowerCase();
    if (rol === 'salud' || rol === 'admin') { document.querySelectorAll('.tab-salud').forEach(t=>t.classList.remove('hidden')); }

    // KPIs
    const trabRes = await supabase.from('trabajadores').select('*').maybeSingle();
    let kpis = [];
    if (trabRes.data){
      const t = trabRes.data;
      const imc = calcIMC(t.peso_kg, t.altura_cm);
      const edad = calcEdad(t.fecha_nacimiento);
      kpis = [
        { title: 'Edad', value: isNaN(edad)?'—':`${edad} años` },
        { title: 'IMC', value: isNaN(imc)?'—':imc.toFixed(1) },
        { title: 'Empresa', value: t.empresa ?? '—' }
      ];
    }
    document.querySelector("#kpis").innerHTML = kpis.map(k=>`<div class="kpi"><div class="title">${k.title}</div><div class="value">${k.value}</div></div>`).join('');

    // Alertas + chip
    const evalsRes = await supabase.from('v_alertas').select('*').order('dias_restantes');
    renderAlertas(evalsRes.data || []);
    setStatusChip(evalsRes.data || []);

    // Labs con filtro
    const labsRes = await supabase.from('examenes').select('*').order('fecha', { ascending: false }).limit(200);
    const full = labsRes.data ?? [];
    renderLabs(full);
    document.querySelector("#filtro-labs").addEventListener("input", (e)=>{
      const q = e.target.value.toLowerCase();
      const filtered = full.filter(l =>
        (l.tipo||'').toLowerCase().includes(q) ||
        (l.parametro||'').toLowerCase().includes(q) ||
        (l.interpretacion||'').toLowerCase().includes(q)
      );
      renderLabs(filtered);
    });

    // Higiene (servidor ya filtra por usuario)
    const higRes = await supabase.from('v_higiene').select('*').order('fecha', { ascending: false }).limit(200);
    renderHigiene(higRes.data || []);

    // Citaciones
    const citaRes = await supabase.from('citaciones').select('*').order('fecha').limit(200);
    renderCitaciones(citaRes);

    // Recomendaciones
    const recos = buildRecommendations(trabRes.data, full);
    document.querySelector("#reco-cards").innerHTML = recos.length
      ? recos.map(r=>`<div class="reco"><strong>${r.title}</strong><div class="muted">${r.detail}</div></div>`).join('')
      : `<span class="muted">Sin recomendaciones específicas. ¡Buen trabajo!</span>`;

    // Dashboard Salud
    if (rol === 'salud' || rol === 'admin') {
      const [venc, imc, glu, chol] = await Promise.all([
        supabase.from('resumen_vencimientos').select('*'),
        supabase.from('resumen_imc').select('*'),
        supabase.from('resumen_labs_glucosa').select('*'),
        supabase.from('resumen_labs_colesterol').select('*')
      ]);
      if (!venc.error && venc.data?.length) renderVenc(venc.data); else $('#dash-msg').textContent = "Completa y refresca los resúmenes.";
      if (!imc.error && imc.data?.length) renderIMC(imc.data); else $('#dash-msg-imc').textContent = "Sin datos IMC (revisa peso/altura y ejecuta refresh).";
      if (!glu.error && glu.data?.length) renderGlu(glu.data); else $('#dash-msg-glu').textContent = "Sin datos de glucosa (sube exámenes y ejecuta refresh).";
      if (!chol.error && chol.data?.length) renderChol(chol.data); else $('#dash-msg-chol').textContent = "Sin datos de colesterol (sube exámenes y ejecuta refresh).";
      setupSupervisor(); // activar supervisor
    }
  } catch (e) {
    console.error("Error en loadData:", e);
  }
}

// Supervisor nuevo: buscar en USUARIOS (nombre/email/rut) y enriquecer con TRABAJADORES
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
  // 1) Buscar en usuarios por nombre/email/rut
  const u = await supabase
    .from('usuarios')
    .select('rut,nombre,email')
    .or(`nombre.ilike.%${q}%,email.ilike.%${q}%,rut.ilike.%${q}%`)
    .limit(20);
  if (u.error){ container.innerHTML = `<span class="muted">${u.error.message}</span>`; return; }
  if (!u.data?.length){ container.innerHTML = `<span class="muted">Sin resultados</span>`; return; }

  // 2) Enriquecer con gerencia/empresa desde trabajadores (si existen)
  const ruts = u.data.map(x=>x.rut).filter(Boolean);
  let mapTrab = {};
  if (ruts.length){
    const t = await supabase.from('trabajadores').select('rut,gerencia,empresa').in('rut', ruts);
    if (!t.error && t.data){
      mapTrab = Object.fromEntries(t.data.map(x=>[x.rut, x]));
    }
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
  // Perfil
  const { data: t } = await supabase.from('trabajadores').select('*').eq('rut', rut).maybeSingle();
  const { data: u } = await supabase.from('usuarios').select('email,nombre').eq('rut', rut).maybeSingle();
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

  // Citaciones
  const cit = await supabase.from('citaciones').select('*').eq('rut', rut).order('fecha');
  renderTable('#sup-cit tbody', cit);

  // Labs (filtrables)
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

  // Higiene
  const hig = await supabase.from('exposiciones').select('*').eq('rut', rut).order('fecha', { ascending:false });
  if (hig.error && hig.error.code === '42501'){
    document.querySelector('#sup-hig tbody').innerHTML = `<tr><td colspan="6" class="muted">Sin permisos para ver exposiciones. Ejecuta policies_salud.sql.</td></tr>`;
  } else {
    renderHigieneGeneric('#sup-hig tbody', hig.data||[]);
  }
}

// Helpers render (reutilizados)
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

// Renderers de perfil propio
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
function renderHigiene(rows){
  const tb = document.querySelector('#tabla-higiene tbody');
  if (!rows.length){ tb.innerHTML = `<tr><td colspan="6" class="muted">Sin registros</td></tr>`; return; }
  tb.innerHTML = rows.map(r=>{
    const badge = (nivel)=>{
      if ((nivel||'').startsWith('Crítico')) return `<span class="badge crit">${nivel}</span>`;
      if ((nivel||'').startsWith('Próximo')) return `<span class="badge warn">${nivel}</span>`;
      if ((nivel||'').startsWith('OK')) return `<span class="badge ok">${nivel}</span>`;
      return `<span class="badge">${nivel||'—'}</span>`;
    };
    return `<tr>
      <td>${r.agente ?? ''}</td><td>${r.ges ?? '—'}</td><td>${r.fecha ?? ''}</td>
      <td>${r.valor ?? ''} ${r.unidad ?? ''}</td><td>${r.oel ?? ''} ${r.unidad ?? ''}</td>
      <td>${badge(r.nivel)} ${r.pct_oel!=null ? `(${r.pct_oel}% OEL)` : ''}</td>
    </tr>`;
  }).join('');
}
function renderCitaciones(citaRes){
  const tbody = document.querySelector("#citaciones tbody");
  if (citaRes.error && citaRes.error.code === '42P01'){
    document.querySelector("#citaciones-count").textContent = "Agrega la tabla 'citaciones'";
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Crea la tabla 'citaciones' (ver guía)</td></tr>`;
  } else if (!citaRes.data || !citaRes.data.length){
    document.querySelector("#citaciones-count").textContent = "0";
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin citaciones</td></tr>`;
  } else {
    document.querySelector("#citaciones-count").textContent = citaRes.data.length;
    tbody.innerHTML = citaRes.data.map(c=>`<tr>
      <td>${c.fecha ?? ''}</td><td>${c.hora ?? ''}</td><td>${c.tipo ?? ''}</td>
      <td>${c.centro ?? ''}</td><td>${c.direccion ?? ''}</td><td>${c.estado ?? ''}</td>
    </tr>`).join('');
  }
}

// Dashboard charts (mismo que v5)
function renderVenc(rows){
  const ctx = document.getElementById('chart-vencimientos').getContext('2d');
  const labels = rows.map(r=>r.gerencia);
  const vencidos = rows.map(r=>r.vencidos||0);
  const criticos30 = rows.map(r=>r.criticos_30||0);
  const proximos60 = rows.map(r=>r.proximos_60||0);
  const ok = rows.map(r=>(r.trabajadores||0)-((r.vencidos||0)+(r.criticos_30||0)+(r.proximos_60||0)));
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[
    { label:'Vencidos', data:vencidos, stack:'x' },
    { label:'≤30 días', data:criticos30, stack:'x' },
    { label:'≤60 días', data:proximos60, stack:'x' },
    { label:'OK', data:ok, stack:'x' },
  ]}, options:{ responsive:true, plugins:{ legend:{ position:'bottom' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
}
function renderIMC(rows){
  const ctx = document.getElementById('chart-imc').getContext('2d');
  const labels = rows.map(r=>r.gerencia);
  const bajo = rows.map(r=>r.bajo_peso||0);
  const normal = rows.map(r=>r.normal||0);
  const sobre = rows.map(r=>r.sobrepeso||0);
  const obeso = rows.map(r=>r.obesidad||0);
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[
    { label:'Bajo peso', data:bajo, stack:'x' },
    { label:'Normal', data:normal, stack:'x' },
    { label:'Sobrepeso', data:sobre, stack:'x' },
    { label:'Obesidad', data:obeso, stack:'x' },
  ]}, options:{ responsive:true, plugins:{ legend:{ position:'bottom' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
}
function renderGlu(rows){
  const ctx = document.getElementById('chart-glu').getContext('2d');
  const labels = rows.map(r=>r.gerencia);
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[
    { label:'Normal (<100)', data: rows.map(r=>r.normal||0), stack:'x' },
    { label:'100–125', data: rows.map(r=>r.pre||0), stack:'x' },
    { label:'≥126', data: rows.map(r=>r.alta||0), stack:'x' },
  ]}, options:{ responsive:true, plugins:{ legend:{ position:'bottom' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
}
function renderChol(rows){
  const ctx = document.getElementById('chart-chol').getContext('2d');
  const labels = rows.map(r=>r.gerencia);
  new Chart(ctx, { type:'bar', data:{ labels, datasets:[
    { label:'Deseable (<200)', data: rows.map(r=>r.normal||0), stack:'x' },
    { label:'Límite (200–239)', data: rows.map(r=>r.limite||0), stack:'x' },
    { label:'Alto (≥240)', data: rows.map(r=>r.alto||0), stack:'x' },
  ]}, options:{ responsive:true, plugins:{ legend:{ position:'bottom' } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
}

// Calculos
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

supabase.auth.onAuthStateChange((_event, _session)=>{ refresh(); });
refresh();
