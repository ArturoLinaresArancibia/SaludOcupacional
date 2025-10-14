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
  // Perfil y KPIs
  const meRes = await supabase.from('usuarios').select('*').maybeSingle();
  if (meRes.error) document.querySelector("#perfil").innerHTML = `<span class="muted">${meRes.error.message}</span>`;
  else if (meRes.data) document.querySelector("#perfil").innerHTML = `<div><strong>${meRes.data.nombre ?? 'Sin nombre'}</strong></div><div class="muted">${meRes.data.email}</div>`;
  else document.querySelector("#perfil").innerHTML = `<span class="muted">Sin registro en usuarios</span>`;

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

  // Alertas
  const evalsRes = await supabase.from('v_alertas').select('*').order('dias_restantes');
  if (!evalsRes.data || !evalsRes.data.length) document.querySelector("#alertas").innerHTML = `<span class="muted">Sin alertas</span>`;
  else document.querySelector("#alertas").innerHTML = evalsRes.data.map(e=>{
    const dias = e.dias_restantes;
    const cls = dias < 0 ? 'crit' : (dias <= 30 ? 'crit' : (dias <= 60 ? 'warn' : 'ok'));
    const label = dias < 0 ? 'Vencido' : (dias <= 30 ? 'Crítico' : (dias <= 60 ? 'Próximo' : 'OK'));
    return `<div class="row" style="justify-content:space-between;align-items:center;border:1px solid #e5e7eb;padding:10px;border-radius:12px">
      <div><strong>${e.tipo}</strong><div class="muted">Vence ${e.valido_hasta}</div></div>
      <span class="badge ${cls}">${label} · ${dias} días</span>
    </div>`;
  }).join('');

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

  // Citaciones
  const citaRes = await supabase.from('citaciones').select('*').order('fecha').limit(200);
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

  // Recomendaciones personalizadas
  const recos = buildRecommendations(trabRes.data, full);
  document.querySelector("#reco-cards").innerHTML = recos.length
    ? recos.map(r=>`<div class="reco"><strong>${r.title}</strong><div class="muted">${r.detail}</div></div>`).join('')
    : `<span class="muted">Sin recomendaciones específicas. ¡Buen trabajo manteniendo tus controles!</span>`;
}

function renderLabs(rows){
  const tbody = document.querySelector("#labs tbody");
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="muted">Sin resultados</td></tr>`; return; }
  tbody.innerHTML = rows.map(l=>`<tr>
    <td>${l.tipo ?? ''}</td><td>${l.parametro ?? ''}</td><td>${l.fecha ?? ''}</td>
    <td>${l.resultado ?? ''} ${l.unidad ?? ''}</td><td>${l.referencia ?? ''}</td><td>${l.interpretacion ?? ''}</td>
  </tr>`).join('');
}

function calcIMC(peso, alturaCm){ const m=(alturaCm||0)/100; if(!peso||!m) return NaN; return peso/(m*m); }
function calcEdad(iso){ if(!iso) return NaN; const d=new Date(iso); const diff=Date.now()-d.getTime(); return Math.floor(diff/(1000*60*60*24*365.25)); }
function parseNumber(x){ if(x==null) return NaN; const s=String(x).replace(',', '.').match(/[0-9.]+/g); return s ? parseFloat(s.join('')) : NaN; }

function buildRecommendations(trab, labs){
  const recos = [];
  if (trab){
    const imc = calcIMC(trab.peso_kg, trab.altura_cm);
    if (!isNaN(imc)){
      if (imc >= 30) recos.push({ title: "IMC en rango obesidad", detail: "Consulta nutricional y actividad física progresiva. Prioriza pausas activas en turnos." });
      else if (imc >= 25) recos.push({ title: "IMC sobrepeso", detail: "Agua como bebida principal, colaciones con proteína, 150 min/sem de actividad moderada." });
      else if (imc < 18.5) recos.push({ title: "IMC bajo peso", detail: "Evalúa refuerzo calórico y entrenamiento de fuerza para masa magra." });
      else recos.push({ title: "IMC saludable", detail: "Mantén hábitos actuales: hidratación, sueño y pausas activas." });
    }
  }
  const byParam = {}; labs.forEach(l=>{ const k=(l.parametro||'').toLowerCase(); if(!byParam[k]) byParam[k]=[]; byParam[k].push(l); });
  const last = p => (byParam[p]||[])[0];
  const glu = last('glucosa');
  if (glu){ const v=parseNumber(glu.resultado);
    if (!isNaN(v)){
      if (v >= 126) recos.push({ title: "Glucosa elevada (≥126 mg/dL)", detail: "Agenda control médico. Evita comidas nocturnas copiosas en turno." });
      else if (v >= 100) recos.push({ title: "Glucosa 100–125 mg/dL", detail: "Reduce azúcares simples, aumenta fibra y proteína. Repite control según indicación." });
      else recos.push({ title: "Glucosa normal", detail: "Mantén dieta equilibrada y controles periódicos." });
    }
  }
  const chol = last('colesterol total');
  if (chol){ const v=parseNumber(chol.resultado);
    if (!isNaN(v)){
      if (v >= 240) recos.push({ title: "Colesterol alto (≥240 mg/dL)", detail: "Consulta médica. Prioriza grasas saludables y reduce ultraprocesados." });
      else if (v >= 200) recos.push({ title: "Colesterol límite (200–239)", detail: "Ajustes en dieta y actividad física. Repite control." });
      else recos.push({ title: "Colesterol deseable (<200)", detail: "Sigue con hábitos actuales." });
    }
  }
  return recos;
}

supabase.auth.onAuthStateChange((_event, _session)=>{ refresh(); });
refresh();
