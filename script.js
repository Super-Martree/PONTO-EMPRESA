// ===== helpers =====
const $ = (id) => document.getElementById(id);

function sb(){ return window.supabaseClient; }
function ensureSb(){
  if(!sb()){
    console.error("Supabase não inicializado.");
    return false;
  }
  return true;
}

function pad(n){ return String(n).padStart(2,"0"); }
function nowDate(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function nowTime(){
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function isoToBR(iso){
  if(!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
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
function secondsToHHMM(total){
  if(total == null || total < 0) return "";
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function calcHorasTrabalhadas(r){
  const total = diffSeconds(r.chegada, r.saida);
  if(total == null) return null;
  const intervalo = diffSeconds(r.ini_intervalo, r.fim_intervalo);
  return total - (intervalo || 0);
}

function showMsgIndex(text, ok){
  const el = $("msgIndex");
  if(!el) return;
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 2500);
}

// ===== login guard =====
async function requireLogin(){
  const { data } = await sb().auth.getSession();
  if(!data?.session){
    window.location.href = "login.html";
    return false;
  }
  return true;
}

// ===== NOVO: mostrar botão admin se estiver na tabela admins =====
async function showAdminIfNeeded(){
  const { data: { user } } = await sb().auth.getUser();
  if(!user) return;

  const { data } = await sb()
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if(data){
    const b = document.getElementById("btnAdmin");
    if(b) b.style.display = "inline-flex";
  }
}

// ===== funcionario logado =====
let currentFuncionario = null;

async function getFuncionarioLogado(){
  const { data: { user } } = await sb().auth.getUser();
  if(!user) return null;

  const { data, error } = await sb()
    .from("funcionarios")
    .select("emp_id, nome")
    .eq("user_id", user.id)
    .maybeSingle();

  if(error){
    console.error(error);
    return null;
  }
  return data;
}

// year
const yearEl = $("year");
if(yearEl) yearEl.textContent = new Date().getFullYear();

// relógio visual
const dateEl = $("date");
const timeEl = $("time");
function tick(){
  if(dateEl) dateEl.value = nowDate();
  if(timeEl) timeEl.value = nowTime();
}
if(dateEl || timeEl){
  tick();
  setInterval(tick, 1000);
}

// ===== tabela do dia (SÓ DO LOGADO) =====
const todayTbody = $("todayTbody");
const todayLabel = $("todayLabel");
const refreshToday = $("refreshToday");

async function renderToday(){
  if(!todayTbody) return;
  if(!ensureSb()){
    todayTbody.innerHTML = `<tr><td colspan="6">Supabase não inicializado.</td></tr>`;
    return;
  }
  if(!currentFuncionario?.emp_id){
    todayTbody.innerHTML = `<tr><td colspan="6">Usuário não vinculado a funcionário.</td></tr>`;
    return;
  }

  const d = nowDate();
  if(todayLabel) todayLabel.textContent = `Dia: ${isoToBR(d)}`;

  const { data, error } = await sb()
    .from("pontos")
    .select("emp_id, data, chegada, ini_intervalo, fim_intervalo, saida")
    .eq("data", d)
    .eq("emp_id", currentFuncionario.emp_id)
    .maybeSingle();

  if(error){
    console.error(error);
    todayTbody.innerHTML = `<tr><td colspan="6">Erro ao carregar.</td></tr>`;
    return;
  }

  if(!data){
    todayTbody.innerHTML = `<tr><td colspan="6">Nenhum registro hoje.</td></tr>`;
    return;
  }

  const r = data;
  const nome = currentFuncionario?.nome
    ? `#${r.emp_id} ${currentFuncionario.nome}`
    : `#${r.emp_id}`;

  const horas = secondsToHHMM(calcHorasTrabalhadas(r)) || "-";

  todayTbody.innerHTML = `
    <tr>
      <td class="tdName" title="${nome}">${nome}</td>
      <td>${hhmm(r.chegada) || "-"}</td>
      <td>${hhmm(r.ini_intervalo) || "-"}</td>
      <td>${hhmm(r.fim_intervalo) || "-"}</td>
      <td>${hhmm(r.saida) || "-"}</td>
      <td>${horas}</td>
    </tr>
  `;
}

if(refreshToday) refreshToday.onclick = ()=> renderToday();

// ===== bater ponto (sem input de ID) =====
async function addRegistro(tipo){
  try{
    if(!ensureSb()) return showMsgIndex("Supabase não inicializado.", false);
    if(!currentFuncionario?.emp_id) return showMsgIndex("Usuário não vinculado a funcionário.", false);

    const id = currentFuncionario.emp_id;
    const dataDia = nowDate();
    const hora = nowTime();

    const coluna = ({
      CHEGADA: "chegada",
      INI_INTERVALO: "ini_intervalo",
      FIM_INTERVALO: "fim_intervalo",
      SAIDA: "saida",
    })[tipo];

    if(!coluna) return showMsgIndex("Tipo inválido.", false);

    const { data: existente, error: errSel } = await sb()
      .from("pontos")
      .select("id, chegada, ini_intervalo, fim_intervalo, saida")
      .eq("emp_id", id)
      .eq("data", dataDia)
      .maybeSingle();

    if(errSel){
      console.error(errSel);
      return showMsgIndex("Erro ao buscar registro do dia.", false);
    }

    // Se NÃO existe registro ainda, só pode registrar CHEGADA
    if (!existente) {
      if (tipo !== "CHEGADA")
        return showMsgIndex("Registre a chegada primeiro.", false);
    }

    if (existente) {

      if (tipo === "CHEGADA" && existente.chegada)
        return showMsgIndex("Chegada já registrada.", false);

      if (tipo === "INI_INTERVALO" && !existente.chegada)
        return showMsgIndex("Registre a chegada primeiro.", false);

      if (tipo === "INI_INTERVALO" && existente.ini_intervalo)
        return showMsgIndex("Início de intervalo já registrado.", false);

      if (tipo === "INI_INTERVALO" && existente.saida)
        return showMsgIndex("Já foi registrada a saída.", false);

      if (tipo === "FIM_INTERVALO" && !existente.ini_intervalo)
        return showMsgIndex("Inicie o intervalo primeiro.", false);

      if (tipo === "FIM_INTERVALO" && existente.fim_intervalo)
        return showMsgIndex("Fim de intervalo já registrado.", false);

      if (tipo === "SAIDA" && !existente.chegada)
        return showMsgIndex("Registre a chegada primeiro.", false);

      if (tipo === "SAIDA" && existente.saida)
        return showMsgIndex("Saída já registrada.", false);
    }

    let result;
    if(existente){
      result = await sb().from("pontos").update({ [coluna]: hora }).eq("id", existente.id);
    } else {
      result = await sb().from("pontos").insert([{ emp_id: id, data: dataDia, [coluna]: hora }]);
    }

    if(result.error){
      console.error(result.error);
      return showMsgIndex("Erro ao salvar.", false);
    }

    showMsgIndex("Registrado com sucesso!", true);
    renderToday();
  } catch(e){
    console.error(e);
    showMsgIndex("Erro inesperado.", false);
  }
}

window.addRegistro = addRegistro;

document.addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-type]");
  if(btn) window.addRegistro(btn.dataset.type);
});

// ===== init =====
(async ()=>{
  const ok = await requireLogin();
  if(!ok) return;

  showAdminIfNeeded();

  currentFuncionario = await getFuncionarioLogado();
  if(!currentFuncionario){
    alert("Usuário não vinculado a funcionário (funcionarios.user_id).");
    return;
  }

  renderToday();
  setInterval(renderToday, 20000);
})();

const btnLogout = $("btnLogout");

if(btnLogout){
  btnLogout.onclick = async ()=>{
    await sb().auth.signOut();
    window.location.href = "login.html";
  };
}
