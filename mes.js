// mes.js (COMPLETO) — com saldoMes no resumo + acumulado real (meses anteriores)
// Ajustes pedidos:
// 1) saldoMesSeg = saldoAcumulado (saldo do mês)
// 2) setar $("saldoMes") com signed e class pos/neg
// 3) acumulado profissional: soma meses anteriores + saldoMesSeg
// 4) ✅ REMOVIDO: toda UI do sábado (toggle/semanaRef/semanaLabel/botões)

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

function nowDate(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// ✅ calcula o último dia real do mês (corrige fevereiro etc.)
function lastDayOfMonthISO(Y, M){
  // M = 1..12
  const last = new Date(Y, M, 0); // dia 0 do mês seguinte = último dia do mês atual
  return `${Y}-${pad(M)}-${pad(last.getDate())}`;
}

// ✅ monthRange baseado no input YYYY-MM (#mesRef) + último dia real do mês
function monthRangeFromInput(){
  const el = $("mesRef");
  const d = new Date();

  const ym = (el && el.value)
    ? el.value
    : `${d.getFullYear()}-${pad(d.getMonth()+1)}`; // "YYYY-MM"

  const [Y, M] = ym.split("-").map(Number);

  const start = `${Y}-${pad(M)}-01`;
  const end = lastDayOfMonthISO(Y, M);

  return { start, end, ano: Y, mes: M };
}

function timeToSeconds(t){
  if(!t) return 0;
  const parts = String(t).split(":").map(Number);
  return parts[0]*3600 + parts[1]*60 + (parts[2]||0);
}

function secondsToHHMM(sec){
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function secondsToHHMMsigned(sec){
  const sign = sec >= 0 ? "+" : "-";
  const abs = Math.abs(sec);
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

// ====== CONSTANTES (TOPO) ======
const META_9H   = 9*3600;            // 09:00
const META_8H   = 8*3600;            // 08:00 (terça na semana normal)
const META_7H20 = 7*3600 + 20*60;    // 07:20 (semana do sábado)

const INT_1H = 1*3600;               // 01:00
const INT_2H = 2*3600;               // 02:00

// ====== FUNÇÕES DE SEMANA (SEGUNDA-FEIRA) ======
function isoToDate(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}

// devolve ISO (YYYY-MM-DD) da segunda-feira da semana da dataISO
function mondayOfWeekISO(dateISO){
  const dt = isoToDate(dateISO);
  const day = dt.getDay(); // 0 dom .. 6 sáb
  const diffToMon = (day === 0) ? 6 : (day - 1);
  dt.setDate(dt.getDate() - diffToMon);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const d = String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

// ====== CARREGAR/SALVAR ESCALA DA SEMANA ======
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

// cache simples pra não bater no banco toda linha
const escalaCache = new Map();

async function trabalhaSabadoNaSemana(empId, dataISO){
  const semana = mondayOfWeekISO(dataISO);
  const key = `${empId}|${semana}`;
  if(escalaCache.has(key)) return escalaCache.get(key);

  const val = await getEscalaSemana(empId, semana);
  escalaCache.set(key, val);
  return val;
}

// ====== META DO DIA BASEADA NA SEMANA E DIA ======
async function metaDoDia(empId, dataISO){
  const d = isoToDate(dataISO).getDay(); // 0 dom .. 6 sáb
  if(d === 0) return 0;

  const semanaSab = await trabalhaSabadoNaSemana(empId, dataISO);

  if(semanaSab){
    // seg-sab = 07:20
    return (d >= 1 && d <= 6) ? META_7H20 : 0;
  } else {
    // semana normal: terça=08:00, seg/qua/qui/sex=09:00, sábado=0
    if(d === 6) return 0;
    if(d === 2) return META_8H;     // terça
    return META_9H;                 // seg/qua/qui/sex
  }
}

// ✅ acumulado “de verdade” = soma dos saldos mensais anteriores ao mês selecionado
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
  let totalExtras = 0; // (mantido, caso você use em outro lugar)
  let dias = 0;

  let saldoAcumulado = 0;        // ✅ aqui é o SALDO DO MÊS (soma dia a dia)
  let totalSaldoPositivo = 0;
  let totalSaldoNegativo = 0;

  const tbody = $("tbodyMes");
  tbody.innerHTML = "";

  for (const r of (data || [])) {
    const total = diffSeconds(r.chegada, r.saida);
    if(total == null) continue;

    // =========================
    // ✅ AJUSTE: só desconta se o usuário bateu intervalo (ini e fim)
    let intervalo = 0;

    if(r.ini_intervalo && r.fim_intervalo){
      intervalo = diffSeconds(r.ini_intervalo, r.fim_intervalo) || 0;

      // segurança: nunca descontar mais do que trabalhou
      intervalo = Math.min(intervalo, total);
    }

    const horas = Math.max(0, total - intervalo);
    // =========================

    if(horas > 0) dias++;

    totalSegundos += horas;

    const meta = await metaDoDia(currentFuncionario.emp_id, r.data);

    if(horas > meta) totalExtras += (horas - meta);

    const saldoDia = horas - meta;
    saldoAcumulado += saldoDia;

    if(saldoDia >= 0) totalSaldoPositivo += saldoDia;
    else totalSaldoNegativo += (-saldoDia);

    tbody.innerHTML += `
      <tr>
        <td>${r.data}</td>
        <td>${r.chegada || "-"}</td>
        <td>${r.saida || "-"}</td>
        <td>${secondsToHHMM(horas)}</td>
        <td>${meta ? secondsToHHMM(meta) : "-"}</td>
        <td class="${saldoDia >= 0 ? "pos" : "neg"}">
          ${meta ? secondsToHHMMsigned(saldoDia) : "-"}
        </td>
        <td class="${saldoAcumulado >= 0 ? "pos" : "neg"}">
          ${meta ? secondsToHHMMsigned(saldoAcumulado) : "-"}
        </td>
      </tr>
    `;
  }

  // =========================
  // ✅ 1) SALDO DO MÊS
  const saldoMesSeg = saldoAcumulado; // ✅ saldo do mês (pode ser negativo)
  // =========================

  // ✅ Resumo
  $("dias").textContent = dias;
  $("totalHoras").textContent = secondsToHHMM(totalSegundos);

  $("saldoPos").textContent = secondsToHHMM(totalSaldoPositivo);
  $("saldoNeg").textContent = secondsToHHMM(totalSaldoNegativo);

  // =========================
  // ✅ 2) setar o span do SALDO DO MÊS (signed e class pos/neg)
  if($("saldoMes")){
    $("saldoMes").textContent = secondsToHHMMsigned(saldoMesSeg);
    $("saldoMes").className = (saldoMesSeg >= 0 ? "pos" : "neg");
  }
  // =========================

  // =========================
  // ✅ 3) ACUMULADO PROFISSIONAL (meses anteriores + saldo do mês)
  const acumuladoAnterior = await getAcumuladoAteMesAnterior(currentFuncionario.emp_id, ano, mes);
  const saldoAcumuladoReal = acumuladoAnterior + saldoMesSeg;

  $("saldoAcum").textContent = secondsToHHMMsigned(saldoAcumuladoReal);
  $("saldoAcum").className = (saldoAcumuladoReal >= 0 ? "pos" : "neg");
  // =========================

  $("saldoPos").className = "pos";
  $("saldoNeg").className = "neg";

  // ✅ salva no banco: saldo do mês
  const { error: upsertErr } = await sb().from("resumo_mes").upsert([{
    emp_id: currentFuncionario.emp_id,
    ano,
    mes,
    dias,
    total_segundos: totalSegundos,
    saldo_pos_seg: totalSaldoPositivo,
    saldo_neg_seg: totalSaldoNegativo,
    saldo_mes_seg: saldoMesSeg, // ✅ saldo do mês
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
