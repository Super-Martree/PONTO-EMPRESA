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
    window.location.href = "index.html";
    return false;
  }
  return true;
}

function pad(n){ return String(n).padStart(2,"0"); }

function isoToDate(iso){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}

function mondayOfWeekISO(dateISO){
  const dt = isoToDate(dateISO);
  const day = dt.getDay();
  const diffToMon = (day === 0) ? 6 : (day - 1);
  dt.setDate(dt.getDate() - diffToMon);
  const y = dt.getFullYear();
  const m = pad(dt.getMonth()+1);
  const d = pad(dt.getDate());
  return `${y}-${m}-${d}`;
}

function addDaysISO(dateISO, days){
  const dt = isoToDate(dateISO);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
}

function secondsToHHMM(sec){
  sec = Math.max(0, sec || 0);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function secondsToHHMMsigned(sec){
  const sign = (sec || 0) >= 0 ? "+" : "-";
  return sign + secondsToHHMM(Math.abs(sec || 0));
}

function secondsToHHMMsignedCSV(sec){
  return "'" + secondsToHHMMsigned(sec);
}

function hhmm(t){
  if(!t) return "-";
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

function calcHorasTrabalhadas(r){
  const total = diffSeconds(r.chegada, r.saida);
  if(total == null) return null;

  let intervalo = 0;
  if(r.ini_intervalo && r.fim_intervalo){
    intervalo = diffSeconds(r.ini_intervalo, r.fim_intervalo) || 0;
    intervalo = Math.min(intervalo, total);
  }

  return Math.max(0, total - intervalo);
}

function lastDayOfMonthISO(Y, M){
  const last = new Date(Y, M, 0);
  return `${Y}-${pad(M)}-${pad(last.getDate())}`;
}

function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n;]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

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

function showMsg(text, ok){
  const el = $("admMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 2500);
}

function showCsvMsg(text, ok){
  const el = $("csvMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 3000);
}

function showSemMsg(text, ok){
  const el = $("semMsg");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 3000);
}

// ===== regras de meta =====
const META_9H = 9*3600;
const META_8H = 8*3600;
const META_7H20 = 7*3600 + 20*60;

async function trabalhaSabadoNaSemana(empId, dataISO){
  const semanaInicio = mondayOfWeekISO(dataISO);

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
  const d = isoToDate(dataISO).getDay();
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

// ===== funcionários =====
async function getFuncionarios(){
  const { data, error } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .order("emp_id", { ascending: true });

  if(error){
    console.error(error);
    return [];
  }
  return data || [];
}

async function loadFuncionariosSelect(){
  const sel = $("admEmp");
  if(!sel) return;

  const data = await getFuncionarios();

  sel.innerHTML =
    `<option value="">Selecione...</option>` +
    data.map(f => `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`).join("");
}

async function loadFuncionariosCsvSelect(){
  const sel = $("csvEmp");
  if(!sel) return;

  const data = await getFuncionarios();

  sel.innerHTML =
    `<option value="">Selecione...</option>` +
    data.map(f => `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`).join("");
}

async function loadFuncionariosSemanaSelect(){
  const sel = $("semEmp");
  if(!sel) return;

  const data = await getFuncionarios();

  sel.innerHTML =
    `<option value="__ALL__">Todos os funcionários</option>` +
    data.map(f => `<option value="${f.emp_id}">#${f.emp_id} ${f.nome || ""}</option>`).join("");
}

// ===== escala semanal admin =====
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
  const sel = $("admEmp");
  const inp = $("admSemana");
  const status = $("admStatus");
  const btnToggle = $("admToggleSabado");

  if(!sel?.value || !inp?.value){
    if(status) status.textContent = "Status: selecione funcionário e semana.";
    if(btnToggle){
      btnToggle.textContent = "Trabalhar sábado: -";
      btnToggle.dataset.val = "";
    }
    return;
  }

  const semana = mondayOfWeekISO(inp.value);
  inp.value = semana;

  const val = await getEscalaSemana(sel.value, semana);

  if(status) status.textContent = `Status: semana ${semana} (${val ? "COM sábado" : "SEM sábado"})`;
  if(btnToggle){
    btnToggle.textContent = `Trabalhar sábado: ${val ? "SIM" : "NÃO"}`;
    btnToggle.dataset.val = "";
  }
}

async function setupEscalaAdmin(){
  await loadFuncionariosSelect();

  const sel = $("admEmp");
  const inp = $("admSemana");
  const btnToggle = $("admToggleSabado");
  const btnSalvar = $("admSalvar");

  if(!sel || !inp || !btnToggle || !btnSalvar) return;

  const d = new Date();
  const hojeISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  inp.value = mondayOfWeekISO(hojeISO);

  sel.onchange = ()=> refreshEscalaUI();
  inp.onchange = ()=> refreshEscalaUI();

  btnToggle.onclick = async ()=>{
    if(!sel.value || !inp.value) return showMsg("Selecione funcionário e semana.", false);

    const semana = mondayOfWeekISO(inp.value);

    let base;
    if(btnToggle.dataset.val === "true" || btnToggle.dataset.val === "false"){
      base = (btnToggle.dataset.val === "true");
    } else {
      base = await getEscalaSemana(sel.value, semana);
    }

    const novo = !base;

    btnToggle.dataset.val = novo.toString();
    btnToggle.textContent = `Trabalhar sábado: ${novo ? "SIM" : "NÃO"}`;

    const status = $("admStatus");
    if(status) status.textContent = `Status: semana ${semana} (${novo ? "COM sábado" : "SEM sábado"}) (não salvo)`;
  };

  btnSalvar.onclick = async ()=>{
    if(!sel.value || !inp.value) return showMsg("Selecione funcionário e semana.", false);

    const semana = mondayOfWeekISO(inp.value);

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

// ===== consulta semanal detalhada =====
async function getPontosSemana(empIds, startISO, endISO){
  if(!empIds.length) return [];

  const { data, error } = await sb()
    .from("pontos")
    .select("emp_id, data, chegada, ini_intervalo, fim_intervalo, saida")
    .in("emp_id", empIds)
    .gte("data", startISO)
    .lte("data", endISO)
    .order("emp_id", { ascending: true })
    .order("data", { ascending: true });

  if(error){
    console.error(error);
    return null;
  }
  return data || [];
}

function renderDayCell(r){
  if(!r){
    return `
      <div class="dayCell">
        <div class="dayLine"><span class="lab">Ent:</span> <span class="val">-</span></div>
        <div class="dayLine"><span class="lab">Ini:</span> <span class="val">-</span></div>
        <div class="dayLine"><span class="lab">Fim:</span> <span class="val">-</span></div>
        <div class="dayLine"><span class="lab">Sai:</span> <span class="val">-</span></div>
        <div class="dayLine total"><span class="lab">Hrs:</span> <span class="val">-</span></div>
      </div>
    `;
  }

  const horas = calcHorasTrabalhadas(r);

  return `
    <div class="dayCell">
      <div class="dayLine"><span class="lab">Ent:</span> <span class="val">${hhmm(r.chegada)}</span></div>
      <div class="dayLine"><span class="lab">Ini:</span> <span class="val">${hhmm(r.ini_intervalo)}</span></div>
      <div class="dayLine"><span class="lab">Fim:</span> <span class="val">${hhmm(r.fim_intervalo)}</span></div>
      <div class="dayLine"><span class="lab">Sai:</span> <span class="val">${hhmm(r.saida)}</span></div>
      <div class="dayLine total"><span class="lab">Hrs:</span> <span class="val">${horas == null ? "-" : secondsToHHMM(horas)}</span></div>
    </div>
  `;
}

async function carregarSemanaAdmin(){
  const sel = $("semEmp");
  const inp = $("semSemana");
  const tbody = $("semTbody");

  if(!sel || !inp || !tbody) return;

  if(!inp.value){
    return showSemMsg("Selecione a semana.", false);
  }

  const semana = mondayOfWeekISO(inp.value);
  inp.value = semana;

  const funcionarios = await getFuncionarios();
  if(!funcionarios.length){
    tbody.innerHTML = `<tr><td colspan="10">Nenhum funcionário encontrado.</td></tr>`;
    return showSemMsg("Nenhum funcionário encontrado.", false);
  }

  let lista = funcionarios;
  if(sel.value && sel.value !== "__ALL__"){
    lista = funcionarios.filter(f => String(f.emp_id) === String(sel.value));
  }

  if(!lista.length){
    tbody.innerHTML = `<tr><td colspan="10">Funcionário não encontrado.</td></tr>`;
    return showSemMsg("Funcionário não encontrado.", false);
  }

  const diasSemana = [
    addDaysISO(semana, 0),
    addDaysISO(semana, 1),
    addDaysISO(semana, 2),
    addDaysISO(semana, 3),
    addDaysISO(semana, 4),
    addDaysISO(semana, 5),
  ];

  const start = diasSemana[0];
  const end = diasSemana[5];
  const empIds = lista.map(f => f.emp_id);

  const rows = await getPontosSemana(empIds, start, end);
  if(rows == null){
    tbody.innerHTML = `<tr><td colspan="10">Erro ao carregar dados da semana.</td></tr>`;
    return showSemMsg("Erro ao carregar semana.", false);
  }

  const mapa = new Map();
  for(const r of rows){
    mapa.set(`${r.emp_id}|${r.data}`, r);
  }

  let html = "";

  for(const f of lista){
    let totalSem = 0;
    let saldoSem = 0;

    const trabalhaSab = await getEscalaSemana(f.emp_id, semana);

    const dayCells = [];
    for(const dia of diasSemana){
      const r = mapa.get(`${f.emp_id}|${dia}`);
      const horas = r ? calcHorasTrabalhadas(r) : null;
      const meta = await metaDoDia(f.emp_id, dia);

      if(horas != null){
        totalSem += horas;
        saldoSem += (horas - meta);
      }

      dayCells.push(`<td class="weekDayTd">${renderDayCell(r)}</td>`);
    }

    html += `
      <tr>
        <td class="tdName" title="#${f.emp_id} ${f.nome || ""}">#${f.emp_id} ${f.nome || ""}</td>
        ${dayCells.join("")}
        <td>${secondsToHHMM(totalSem)}</td>
        <td class="${saldoSem >= 0 ? "pos" : "neg"}">${secondsToHHMMsigned(saldoSem)}</td>
        <td>${trabalhaSab ? "Com sábado" : "Sem sábado"}</td>
      </tr>
    `;
  }

  tbody.innerHTML = html || `<tr><td colspan="10">Sem dados na semana.</td></tr>`;
  showSemMsg("Semana carregada.", true);
}

async function setupConsultaSemanal(){
  await loadFuncionariosSemanaSelect();

  const inp = $("semSemana");
  const btn = $("btnSemanal");

  if(inp){
    const d = new Date();
    const hojeISO = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    inp.value = mondayOfWeekISO(hojeISO);
  }

  if(btn){
    btn.onclick = ()=> carregarSemanaAdmin();
  }
}

// ===== CSV =====
async function baixarCsvMesDetalhado(){
  const empId = $("csvEmp")?.value;
  const ym = $("csvMes")?.value;
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
      secondsToHHMMsignedCSV(saldoDia),
      secondsToHHMMsignedCSV(saldoAcum),
    ].map(csvEscape).join(";"));
  }

  lines.push("");
  lines.push(["RESUMO","","","","","","","",""].join(";"));
  lines.push(["dias", dias,"","","","","","",""].join(";"));
  lines.push(["total_horas", secondsToHHMM(totalSeg),"","","","","","",""].join(";"));
  lines.push(["saldo_pos", secondsToHHMM(pos),"","","","","","",""].join(";"));
  lines.push(["saldo_neg", secondsToHHMM(neg),"","","","","","",""].join(";"));
  lines.push(["saldo_mes", secondsToHHMMsignedCSV(saldoAcum),"","","","","","",""].join(";"));

  const nome = func?.nome ? func.nome.replace(/\s+/g,"_") : `emp_${empId}`;
  const filename = `ponto_${nome}_${ano}-${pad(mes)}.csv`;

  downloadCSV(filename, lines.join("\n"));
  showCsvMsg("CSV gerado!", true);
}

// ===== init =====
(async ()=>{
  const ok = await requireAdmin();
  if(!ok) return;

  await setupEscalaAdmin();
  await setupConsultaSemanal();
  await loadFuncionariosCsvSelect();

  const dCsv = new Date();
  const csvMesEl = $("csvMes");
  if(csvMesEl){
    csvMesEl.value = `${dCsv.getFullYear()}-${pad(dCsv.getMonth()+1)}`;
  }

  const btnCsv = $("btnCsv");
  if(btnCsv){
    btnCsv.onclick = ()=> baixarCsvMesDetalhado();
  }

  const btnLogout = $("btnLogout");
  if(btnLogout){
    btnLogout.onclick = async ()=>{
      await sb().auth.signOut();
      window.location.href = "login.html";
    };
  }
})();
