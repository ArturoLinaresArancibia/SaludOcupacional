import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (sel)=>document.querySelector(sel);
const show = (id)=>$(id).classList.remove('hidden');
const hide = (id)=>$(id).classList.add('hidden');
const viewLogin = "#view-login";
const viewApp = "#view-app";
$("#btn-login").addEventListener("click", ()=>{ show(viewLogin); hide(viewApp); });
$("#btn-logout").addEventListener("click", async ()=>{ await supabase.auth.signOut(); location.reload(); });
$("#login-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const email = $("#email").value.trim();
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) { alert(error.message); return; }
  $("#login-msg").classList.remove("hidden");
});
async function refresh(){
  const { data: { user } } = await supabase.auth.getUser();
  if (user){ hide(viewLogin); show(viewApp); loadData(); $("#btn-login").classList.add('hidden'); $("#btn-logout").classList.remove('hidden'); }
  else { show(viewLogin); hide(viewApp); $("#btn-login").classList.remove('hidden'); $("#btn-logout").classList.add('hidden'); }
}
supabase.auth.onAuthStateChange(()=>refresh());
refresh();
async function loadData(){
  const perfil = await supabase.from('usuarios').select('*').maybeSingle();
  if (perfil.error){ $("#perfil").innerHTML = `<span class='muted'>${perfil.error.message}</span>`; }
  else if (perfil.data){ $("#perfil").innerHTML = `<div><strong>${perfil.data.nombre ?? ''}</strong></div><div class='muted'>${perfil.data.email}</div>`; }
  const evals = await supabase.from('v_alertas').select('*').order('dias_restantes');
  if (!evals.data || !evals.data.length){ $("#alertas").innerHTML = `<span class='muted'>Sin alertas</span>`; }
  else {
    $("#alertas").innerHTML = evals.data.map(e=>{
      const d = e.dias_restantes;
      const cls = d < 0 ? 'crit' : (d <= 30 ? 'crit' : (d <= 60 ? 'warn' : 'ok'));
      const label = d < 0 ? 'Vencido' : (d <= 30 ? 'Crítico' : (d <= 60 ? 'Próximo' : 'OK'));
      return `<div class='row' style='justify-content:space-between;align-items:center;border:1px solid #e5e7eb;padding:8px;border-radius:10px'>
        <div><strong>${e.tipo}</strong><div class='muted'>Vence ${e.valido_hasta}</div></div>
        <span class='badge ${cls}'>${label} · ${d} días</span>
      </div>`;
    }).join('');
  }
  const labs = await supabase.from('examenes').select('*').limit(50);
  const tbody = document.querySelector("#labs tbody");
  if (!labs.data || !labs.data.length){ tbody.innerHTML = `<tr><td colspan='6' class='muted'>Sin resultados</td></tr>`; }
  else {
    tbody.innerHTML = labs.data.map(l=>`<tr>
      <td>${l.tipo ?? ''}</td><td>${l.parametro ?? ''}</td><td>${l.fecha ?? ''}</td>
      <td>${l.resultado ?? ''} ${l.unidad ?? ''}</td><td>${l.referencia ?? ''}</td><td>${l.interpretacion ?? ''}</td>
    </tr>`).join('');
  }
}
