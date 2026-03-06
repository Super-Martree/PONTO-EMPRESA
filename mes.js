const $ = (id) => document.getElementById(id);
function sb(){ return window.supabaseClient; }

async function requireLogin(){
  const { data } = await sb().auth.getSession();
  if(!data?.session){
    window.location.href = "login.html";
    return false;
  }
  return true;
}

let currentFuncionario = null;

async function getFuncionario(){
  const { data: { user } } = await sb().auth.getUser();
  const { data } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

function pad(n){ return String(n).padStart(2,"0"); }

function lastDayOfMonthISO(Y, M){
  const last = new Date(Y, M, 0);
  return `${Y}-${pad(M)}-${pad(last.getDate())}`;
}

function monthRangeFromInput(){
  const el = $("mesRef");
  const d = new Date();

  const ym = (el && el.value)
    ? el.value
    : `${d.getFullYear()}-${pad(d.getMonth()+1)}`;

  const [Y, M] = ym.split("-").map(Number);
  const start = `${Y}-${pad(M)}-01`;
  const end = lastDayOfMonthISO(Y, M);

  return { start, end, ano: Y, mes: M };
}

function timeToSeconds(t){
  if(!t) return 0;
  const parts = String(t).split("+")[0].split(":").map(Number);
  return parts[0]*3600 + parts[1]*60 + (parts[2]||0);
}

function hhmm(t){
  if(!t) return "-";
  const s = String(t).split("+")[0];
  const parts = s.split(":");
  if(parts.length < 2) return s;
  return `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}`;
}

function secondsToHHMM(sec){
  sec = Math.max(0, sec || 0);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function secondsToHHMMsigned(sec){
  const sign = sec >= 0 ? "+" : "-";
  const abs = Math.abs(sec || 0);
  return sign + secondsToHHMM(abs);
}

function diffSeconds(a, b){
  if(!a || !b) return null;
  const da = timeToSeconds(a);
  const db = timeToSeconds(b);
  if(!Number.isFinite(da) || !Number.isFinite(db)) return null;
  const d = db - da;
  if(d <= 0) return null;
  return d;
}

function isoToDate(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}

function mondayOfWeekISO(dateISO){
  const dt = isoToDate(dateISO);
  const day = dt.getDay();
  const diffToMon = (day === 0) ? 6 : (day - 1);
  dt.setDate(dt.getDate() - diffToMon);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

const META_9H   = 9*3600;
const META_8H   = 8*3600;
const META_7H20 = 7*3600 + 20*60;

async function getEscalaSemana(empId, semanaInicioISO){
  const { data, error } = await sb()
    .from("escala_semanal")
    .select("trabalha_sabado")
    .eq("emp_id", empId)
    .eq("semana_inicio", semanaInicioISO)
    .maybeSingle();

  if(error){
    console.error(error);
    return null;
  }
  return data?.trabalha_sabado ?? false;
}

const escalaCache = new Map();

async function trabalhaSabadoNaSemana(empId, dataISO){
  const semana = mondayOfWeekISO(dataISO);
  const key = `${empId}|${semana}`;

  if(escalaCache.has(key)) return escalaCache.get(key);

  const val = await getEscalaSemana(empId, semana);
  escalaCache.set(key, val);
  return val;
}

async function metaDoDia(empId, dataISO){
  const d = isoToDate(dataISO).getDay(); // 0 dom .. 6 sáb
  if(d === 0) return 0;

  const semanaSab = await trabalhaSabadoNaSemana(empId, dataISO);

  if(semanaSab){
    return (d >= 1 && d <= 6) ? META_7H20 : 0;
  } else {
    if(d === 6) return 0;
    if(d === 2) return META_8H;
    return META_9H;
  }
}

async function getAcumuladoAteMesAnterior(empId, ano, mes){
  const { data, error } = await sb()
    .from("resumo_mes")
    .select("saldo_mes_seg, ano, mes")
    .eq("emp_id", empId)
    .or(`ano.lt.${ano},and(ano.eq.${ano},mes.lt.${mes})`);

  if(error){
    console.error(error);
    return 0;
  }

  let total = 0;
  for(const r of (data || [])){
    total += (r.saldo_mes_seg || 0);
  }
  return total;
}

function calcHorasDoRegistro(r){
  const total = diffSeconds(r.chegada, r.saida);
  if(total == null) return null;

  let intervalo = 0;
  if(r.ini_intervalo && r.fim_intervalo){
    intervalo = diffSeconds(r.ini_intervalo, r.fim_intervalo) || 0;
    intervalo = Math.min(intervalo, total);
  }

  return Math.max(0, total - intervalo);
}

async function carregarMes(){
  const { start, end, ano, mes } = monthRangeFromInput();

  const { data, error } = await sb()
    .from("pontos")
    .select("*")
    .eq("emp_id", currentFuncionario.emp_id)
    .gte("data", start)
    .lte("data", end)
    .order("data", { ascending: true });

  if(error){
    console.error(error);
    return;
  }

  let totalSegundos = 0;
  let dias = 0;
  let saldoAcumuladoMes = 0;
  let totalSaldoPositivo = 0;
  let totalSaldoNegativo = 0;

  const tbody = $("tbodyMes");
  tbody.innerHTML = "";

  for (const r of (data || [])) {
    const horas = calcHorasDoRegistro(r);
    if(horas == null) continue;

    if(horas > 0) dias++;
    totalSegundos += horas;

    const meta = await metaDoDia(currentFuncionario.emp_id, r.data);
    const saldoDia = horas - meta;

    saldoAcumuladoMes += saldoDia;

    if(saldoDia >= 0) totalSaldoPositivo += saldoDia;
    else totalSaldoNegativo += (-saldoDia);

    tbody.innerHTML += `
      <tr>
        <td>${r.data}</td>
        <td>${hhmm(r.chegada)}</td>
        <td>${hhmm(r.ini_intervalo)}</td>
        <td>${hhmm(r.fim_intervalo)}</td>
        <td>${hhmm(r.saida)}</td>
        <td>${secondsToHHMM(horas)}</td>
        <td>${meta ? secondsToHHMM(meta) : "-"}</td>
        <td class="${saldoDia >= 0 ? "pos" : "neg"}">
          ${meta ? secondsToHHMMsigned(saldoDia) : "-"}
        </td>
        <td class="${saldoAcumuladoMes >= 0 ? "pos" : "neg"}">
          ${meta ? secondsToHHMMsigned(saldoAcumuladoMes) : "-"}
        </td>
      </tr>
    `;
  }

  const saldoMesSeg = saldoAcumuladoMes;

  $("dias").textContent = dias;
  $("totalHoras").textContent = secondsToHHMM(totalSegundos);

  $("saldoPos").textContent = secondsToHHMM(totalSaldoPositivo);
  $("saldoNeg").textContent = secondsToHHMM(totalSaldoNegativo);

  $("saldoPos").className = "pos";
  $("saldoNeg").className = "neg";

  if($("saldoMes")){
    $("saldoMes").textContent = secondsToHHMMsigned(saldoMesSeg);
    $("saldoMes").className = (saldoMesSeg >= 0 ? "pos" : "neg");
  }

  const acumuladoAnterior = await getAcumuladoAteMesAnterior(currentFuncionario.emp_id, ano, mes);
  const saldoAcumuladoReal = acumuladoAnterior + saldoMesSeg;

  $("saldoAcum").textContent = secondsToHHMMsigned(saldoAcumuladoReal);
  $("saldoAcum").className = (saldoAcumuladoReal >= 0 ? "pos" : "neg");

  const { error: upsertErr } = await sb().from("resumo_mes").upsert([{
    emp_id: currentFuncionario.emp_id,
    ano,
    mes,
    dias,
    total_segundos: totalSegundos,
    saldo_pos_seg: totalSaldoPositivo,
    saldo_neg_seg: totalSaldoNegativo,
    saldo_mes_seg: saldoMesSeg,
    updated_at: new Date().toISOString()
  }], { onConflict: "emp_id,ano,mes" });

  if(upsertErr){
    console.error("Erro ao upsert resumo_mes:", upsertErr);
  }
}

(async ()=>{
  const ok = await requireLogin();
  if(!ok) return;

  currentFuncionario = await getFuncionario();
  if(!currentFuncionario){
    alert("Usuário não vinculado.");
    return;
  }

  const d = new Date();
  if($("mesRef")){
    $("mesRef").value = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }

  if($("btnAplicarMes")){
    $("btnAplicarMes").onclick = ()=> carregarMes();
  }

  carregarMes();
})();
