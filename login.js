const $ = (id) => document.getElementById(id);
function sb(){ return window.supabaseClient; }

function showMsg(text, ok){
  const el = $("msgLogin");
  el.style.color = ok ? "#22c55e" : "#ef4444";
  el.textContent = text;
  setTimeout(()=> (el.textContent=""), 3500);
}

$("year").textContent = new Date().getFullYear();

async function goIfLogged(){
  const { data } = await sb().auth.getSession();
  if(data?.session){
    window.location.href = "index.html";
  }
}

goIfLogged();

$("btnLogin").onclick = async ()=>{
  const email = $("email").value.trim();
  const password = $("password").value;
  if(!email || !password) return showMsg("Informe e-mail e senha.", false);

  const { error } = await sb().auth.signInWithPassword({ email, password });
  if(error) return showMsg("Login inválido. Verifique e tente novamente.", false);

  showMsg("Login realizado! Indo para o ponto...", true);
  setTimeout(()=> window.location.href="index.html", 600);
};

$("btnReset").onclick = async ()=>{
  const email = $("email").value.trim();
  if(!email) return showMsg("Digite seu e-mail para resetar a senha.", false);

  // precisa configurar o Redirect URL no Supabase Auth
  const { error } = await sb().auth.resetPasswordForEmail(email);
  if(error) return showMsg("Não consegui enviar o reset. Tente de novo.", false);

  showMsg("Enviei um e-mail para redefinir sua senha.", true);
};
