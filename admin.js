// ===== helpers base =====
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

async function isAdmin(){
  const { data: { user } } = await sb().auth.getUser();
  if(!user) return false;

  const { data, error } = await sb()
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if(error){
    console.error(error);
    return false;
  }
  return !!data;
}

async function requireAdmin(){
  const okLogin = await requireLogin();
  if(!okLogin) return false;

  const okAdmin = await isAdmin();
  if(!okAdmin){
    window.location.href = "index.html"; // ou uma tela "sem permissão"
    return false;
  }
  return true;
}

// ===== NOVO: funções Escala (cole abaixo das helpers) =====
function pad(n){ return String(n).padStart(2,"0"); }

function isoToDate(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}

function mondayOfWeekISO(dateISO){
  const dt = isoToDate(dateISO);
  const day = dt.getDay(); // 0 dom .. 6 sáb
  const diffToMon = (day === 0) ? 6 : (day - 1);
  dt.setDate(dt.getDate() - diffToMon);
  const y = dt.getFullYear();
  const m = pad(dt.getMonth()+1);
  const d = pad(dt.getDate());
  return `${y}-${m}-${d}`;
}

function showMsg(text, ok){
  const el = document.getElementById("admMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 2500);
}

async function loadFuncionariosSelect(){
  const sel = document.getElementById("admEmp");
  if(!sel) return;

  const { data, error } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .order("emp_id", { ascending: true });

  if(error){
    console.error(error);
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
    return;
  }

  sel.innerHTML =
    `<option value="">Selecione...</option>` +
    (data || []).map(f =>
      `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`
    ).join("");
}

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

async function setEscalaSemana(empId, semanaInicioISO, trabalhaSabado){
  const { error } = await sb()
    .from("escala_semanal")
    .upsert([{
      emp_id: empId,
      semana_inicio: semanaInicioISO,
      trabalha_sabado: trabalhaSabado,
      updated_at: new Date().toISOString(),
    }], { onConflict: "emp_id,semana_inicio" });

  if(error){
    console.error(error);
    return false;
  }
  return true;
}

async function refreshEscalaUI(){
  const sel = document.getElementById("admEmp");
  const inp = document.getElementById("admSemana");
  const status = document.getElementById("admStatus");
  const btnToggle = document.getElementById("admToggleSabado");

  if(!sel?.value || !inp?.value){
    if(status) status.textContent = "Status: selecione funcionário e semana.";
    if(btnToggle) btnToggle.textContent = "Trabalhar sábado: -";
    if(btnToggle) btnToggle.dataset.val = ""; // limpa
    return;
  }

  const semana = mondayOfWeekISO(inp.value);
  inp.value = semana;

  const val = await getEscalaSemana(sel.value, semana);

  if(status) status.textContent = `Status: semana ${semana} (${val ? "COM sábado" : "SEM sábado"})`;
  if(btnToggle){
    btnToggle.textContent = `Trabalhar sábado: ${val ? "SIM" : "NÃO"}`;
    btnToggle.dataset.val = ""; // estado limpo (sem pendência)
  }
}

async function setupEscalaAdmin(){
  await loadFuncionariosSelect();

  const sel = document.getElementById("admEmp");
  const inp = document.getElementById("admSemana");
  const btnToggle = document.getElementById("admToggleSabado");
  const btnSalvar = document.getElementById("admSalvar");

  if(!sel || !inp || !btnToggle || !btnSalvar){
    console.warn("Elementos do card de escala não encontrados no admin.html");
    return;
  }

  // semana padrão = semana atual
  const d = new Date();
  const hojeISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  inp.value = mondayOfWeekISO(hojeISO);

  sel.onchange = ()=> refreshEscalaUI();
  inp.onchange = ()=> refreshEscalaUI();

  btnToggle.onclick = async ()=>{
    if(!sel.value || !inp.value) return showMsg("Selecione funcionário e semana.", false);

    const semana = mondayOfWeekISO(inp.value);

    // se já tem um valor pendente, alterna a partir dele; senão pega do banco
    let base;
    if(btnToggle.dataset.val === "true" || btnToggle.dataset.val === "false"){
      base = (btnToggle.dataset.val === "true");
    } else {
      base = await getEscalaSemana(sel.value, semana);
    }

    const novo = !base;

    // só alterna na tela (não salva ainda)
    btnToggle.dataset.val = novo.toString();
    btnToggle.textContent = `Trabalhar sábado: ${novo ? "SIM" : "NÃO"}`;

    const status = document.getElementById("admStatus");
    if(status) status.textContent = `Status: semana ${semana} (${novo ? "COM sábado" : "SEM sábado"}) (não salvo)`;
  };

  btnSalvar.onclick = async ()=>{
    if(!sel.value || !inp.value) return showMsg("Selecione funcionário e semana.", false);

    const semana = mondayOfWeekISO(inp.value);

    // pega valor desejado (se não clicou no toggle, usa o atual do banco)
    let desejado;
    if(btnToggle.dataset.val === "true" || btnToggle.dataset.val === "false"){
      desejado = (btnToggle.dataset.val === "true");
    } else {
      desejado = await getEscalaSemana(sel.value, semana);
    }

    const ok = await setEscalaSemana(sel.value, semana, desejado);
    if(ok){
      btnToggle.dataset.val = "";
      showMsg("Escala salva!", true);
      await refreshEscalaUI();
    } else {
      showMsg("Erro ao salvar.", false);
    }
  };

  await refreshEscalaUI();
}

// ===== 3) admin.js — lógica do resumo =====

// 3.1) Helpers
function secondsToHHMM(sec){
  sec = Math.max(0, sec || 0);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

// ✅ AJUSTE: exportar saldo como TEXTO (Excel não vira fórmula)
function secondsToHHMMsigned(sec){
  const sign = (sec || 0) >= 0 ? "+" : "-";
  const txt = sign + secondsToHHMM(Math.abs(sec || 0));
  return "'" + txt; // ✅ força Excel a tratar como TEXTO
}

function showResMsg(text, ok){
  const el = document.getElementById("admResMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 2500);
}

// 3.2) Carregar funcionários no select do resumo
async function loadFuncionariosResumoSelect(){
  const sel = document.getElementById("admResEmp");
  if(!sel) return;

  const { data, error } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .order("emp_id", { ascending: true });

  if(error){
    console.error(error);
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
    return;
  }

  sel.innerHTML = `<option value="">Selecione...</option>` + (data || []).map(f =>
    `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`
  ).join("");
}

// 3.3) Buscar resumo do mês e calcular acumulado
async function getResumoMes(empId, ano, mes){
  const { data, error } = await sb()
    .from("resumo_mes")
    .select("dias,total_segundos,saldo_pos_seg,saldo_neg_seg,saldo_mes_seg")
    .eq("emp_id", empId)
    .eq("ano", ano)
    .eq("mes", mes)
    .maybeSingle();

  if(error){
    console.error(error);
    return null;
  }
  return data;
}

async function getAcumuladoAteMes(empId, ano, mes){
  // soma todos os saldos mensais anteriores + mês atual
  const { data, error } = await sb()
    .from("resumo_mes")
    .select("saldo_mes_seg, ano, mes")
    .eq("emp_id", empId)
    .or(`ano.lt.${ano},and(ano.eq.${ano},mes.lte.${mes})`);

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

async function carregarResumoAdmin(){
  const empId = document.getElementById("admResEmp")?.value;
  const ym = document.getElementById("admResMes")?.value; // "YYYY-MM"

  if(!empId || !ym){
    return showResMsg("Selecione funcionário e mês.", false);
  }

  const [ano, mes] = ym.split("-").map(Number);

  // resumo do mês (se não existir, mostra zeros)
  const resumo = await getResumoMes(empId, ano, mes);

  const dias = resumo?.dias ?? 0;
  const totalSeg = resumo?.total_segundos ?? 0;
  const pos = resumo?.saldo_pos_seg ?? 0;
  const neg = resumo?.saldo_neg_seg ?? 0;
  const saldoMes = resumo?.saldo_mes_seg ?? 0;

  document.getElementById("admDias").textContent = dias;
  document.getElementById("admTotalHoras").textContent = secondsToHHMM(totalSeg);

  const elPos = document.getElementById("admSaldoPos");
  const elNeg = document.getElementById("admSaldoNeg");
  const elMes = document.getElementById("admSaldoMes");
  const elAc = document.getElementById("admSaldoAcum");

  elPos.textContent = secondsToHHMM(pos);
  elNeg.textContent = secondsToHHMM(neg);
  elMes.textContent = secondsToHHMMsigned(saldoMes);

  elPos.className = "pos";
  elNeg.className = "neg";
  elMes.className = (saldoMes >= 0 ? "pos" : "neg");

  // acumulado até o mês selecionado
  const acumulado = await getAcumuladoAteMes(empId, ano, mes);
  elAc.textContent = secondsToHHMMsigned(acumulado);
  elAc.className = (acumulado >= 0 ? "pos" : "neg");

  showResMsg("Resumo carregado.", true);
}

// ===== CSV: carregar select =====
async function loadFuncionariosCsvSelect(){
  const sel = document.getElementById("csvEmp");
  if(!sel) return;

  const { data, error } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .order("emp_id", { ascending: true });

  if(error){
    console.error(error);
    sel.innerHTML = `<option value="">Erro ao carregar</option>`;
    return;
  }

  sel.innerHTML =
    `<option value="">Selecione...</option>` +
    (data || []).map(f =>
      `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`
    ).join("");
}

// ===== CSV: geração e download =====

function lastDayOfMonthISO(Y, M){
  const last = new Date(Y, M, 0);
  return `${Y}-${pad(M)}-${pad(last.getDate())}`;
}

function hhmm(t){
  if(!t) return "";
  const s = String(t).split("+")[0];
  const parts = s.split(":");
  if(parts.length < 2) return s;
  return `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}`;
}

function timeToSeconds(t){
  if(!t) return null;
  const parts = String(t).split("+")[0].split(":").map(Number);
  if(parts.length < 2) return null;
  const [hh, mm, ss = 0] = parts;
  return hh*3600 + mm*60 + ss;
}

function diffSeconds(start, end){
  const s = timeToSeconds(start);
  const e = timeToSeconds(end);
  if(s == null || e == null) return null;
  let d = e - s;
  if(d < 0) d += 86400;
  return d;
}

// (mantém helpers do CSV; não interfere com o resumo)
function downloadCSV(filename, csvText){
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function showCsvMsg(text, ok){
  const el = document.getElementById("csvMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 3000);
}

// ===== regras de meta / intervalo (iguais ao mes.js) =====
const META_9H = 9*3600;
const META_8H = 8*3600;
const META_7H20 = 7*3600 + 20*60;

const INT_1H = 1*3600;
const INT_2H = 2*3600;

async function trabalhaSabadoNaSemana(empId, dataISO){
  const dt = isoToDate(dataISO);
  const day = dt.getDay();
  const diffToMon = (day === 0) ? 6 : (day - 1);
  dt.setDate(dt.getDate() - diffToMon);
  const semanaInicio = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;

  const { data, error } = await sb()
    .from("escala_semanal")
    .select("trabalha_sabado")
    .eq("emp_id", empId)
    .eq("semana_inicio", semanaInicio)
    .maybeSingle();

  if(error){
    console.error(error);
    return false;
  }
  return !!data?.trabalha_sabado;
}

async function metaDoDia(empId, dataISO){
  const d = isoToDate(dataISO).getDay(); // 0 dom .. 6 sáb
  if(d === 0) return 0;

  const semanaSab = await trabalhaSabadoNaSemana(empId, dataISO);

  if(semanaSab){
    return (d >= 1 && d <= 6) ? META_7H20 : 0;
  } else {
    if(d === 6) return 0;
    if(d === 2) return META_8H; // terça
    return META_9H;
  }
}

async function intervaloPadraoDoDia(empId, dataISO){
  const d = isoToDate(dataISO).getDay();
  if(d === 0) return 0;

  const semanaSab = await trabalhaSabadoNaSemana(empId, dataISO);

  if(semanaSab){
    return (d >= 1 && d <= 6) ? INT_2H : 0;
  } else {
    if(d === 6) return 0;
    return (d === 2) ? INT_2H : INT_1H;
  }
}

// ===== FUNÇÃO PRINCIPAL =====
async function baixarCsvMesDetalhado(){
  const empId = document.getElementById("csvEmp")?.value;
  const ym = document.getElementById("csvMes")?.value; // YYYY-MM
  if(!empId || !ym) return showCsvMsg("Selecione funcionário e mês.", false);

  const [ano, mes] = ym.split("-").map(Number);
  const start = `${ano}-${pad(mes)}-01`;
  const end = lastDayOfMonthISO(ano, mes);

  const { data: func } = await sb()
    .from("funcionarios")
    .select("nome")
    .eq("emp_id", empId)
    .maybeSingle();

  const { data: rows, error } = await sb()
    .from("pontos")
    .select("data, chegada, ini_intervalo, fim_intervalo, saida")
    .eq("emp_id", empId)
    .gte("data", start)
    .lte("data", end)
    .order("data", { ascending: true });

  if(error){
    console.error(error);
    return showCsvMsg("Erro ao carregar pontos.", false);
  }

  let saldoAcum = 0;
  let totalSeg = 0;
  let dias = 0;
  let pos = 0;
  let neg = 0;

  const header = ["data","chegada","ini_intervalo","fim_intervalo","saida","horas","meta","saldo_dia","acumulado"];
  const lines = [header.join(";")];

  for(const r of (rows || [])){
    if(!r.chegada || !r.saida) continue;

    const total = diffSeconds(r.chegada, r.saida);
    if(total == null) continue;

    let intervalo = 0;

    // ✅ só desconta se bateu intervalo
    if(r.ini_intervalo && r.fim_intervalo){
      intervalo = diffSeconds(r.ini_intervalo, r.fim_intervalo) || 0;
      intervalo = Math.min(intervalo, total);
    }

    const horasSeg = Math.max(0, total - intervalo);
    const metaSeg = await metaDoDia(empId, r.data);
    const saldoDia = horasSeg - metaSeg;

    saldoAcum += saldoDia;
    totalSeg += horasSeg;
    dias++;

    if(saldoDia >= 0) pos += saldoDia;
    else neg += Math.abs(saldoDia);

    lines.push([
      r.data,
      hhmm(r.chegada),
      hhmm(r.ini_intervalo),
      hhmm(r.fim_intervalo),
      hhmm(r.saida),
      secondsToHHMM(horasSeg),
      secondsToHHMM(metaSeg),
      secondsToHHMMsigned(saldoDia),
      secondsToHHMMsigned(saldoAcum),
    ].map(csvEscape).join(";"));
  }

  lines.push("");
  lines.push(["RESUMO","","","","","","","",""].join(";"));
  lines.push(["dias", dias,"","","","","","",""].join(";"));
  lines.push(["total_horas", secondsToHHMM(totalSeg),"","","","","","",""].join(";"));
  lines.push(["saldo_pos", secondsToHHMM(pos),"","","","","","",""].join(";"));
  lines.push(["saldo_neg", secondsToHHMM(neg),"","","","","","",""].join(";"));
  lines.push(["saldo_mes", secondsToHHMMsigned(saldoAcum),"","","","","","",""].join(";"));

  const nome = func?.nome ? func.nome.replace(/\s+/g,"_") : `emp_${empId}`;
  const filename = `ponto_${nome}_${ano}-${pad(mes)}.csv`;

  downloadCSV(filename, lines.join("\n"));
  showCsvMsg("CSV gerado!", true);
}

// ===== init =====
(async ()=>{
  const ok = await requireAdmin();
  if(!ok) return;

  // ✅ inicializa card de escala
  await setupEscalaAdmin();

  // ✅ CSV
  await loadFuncionariosCsvSelect();

  const dCsv = new Date();
  const csvMesEl = document.getElementById("csvMes");
  if(csvMesEl){
    csvMesEl.value = `${dCsv.getFullYear()}-${pad(dCsv.getMonth()+1)}`;
  }

  const btnCsv = document.getElementById("btnCsv");
  if(btnCsv){
    btnCsv.onclick = ()=> baixarCsvMesDetalhado();
  }

  // ✅ inicializa card de resumo
  await loadFuncionariosResumoSelect();

  const d = new Date();
  const admResMes = document.getElementById("admResMes");
  if(admResMes){
    admResMes.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }

  const btnCarregar = document.getElementById("admResCarregar");
  if(btnCarregar){
    btnCarregar.onclick = ()=> carregarResumoAdmin();
  }

  // Logout
  const btnLogout = $("btnLogout");
  if(btnLogout){
    btnLogout.onclick = async ()=>{
      await sb().auth.signOut();
      window.location.href = "login.html";
    };
  }
})();
