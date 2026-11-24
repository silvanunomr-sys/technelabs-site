// Radar de contratos públicos — aplicação (Supabase Auth + funções radar_*)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://dpwczgirqlrqttrhwutt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwd2N6Z2lycWxycXR0cmh3dXR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDc3ODQsImV4cCI6MjA5NjU4Mzc4NH0.R4fgF6taaC_oe8d4iIy0iHcOQ9Xux7ValeX4Br2sd1g";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const DISTRITOS = [
  [17, "Viana do Castelo"], [4, "Braga"], [18, "Vila Real"], [5, "Bragança"], [14, "Porto"], [2, "Aveiro"],
  [19, "Viseu"], [10, "Guarda"], [7, "Coimbra"], [11, "Leiria"], [6, "Castelo Branco"], [15, "Santarém"],
  [12, "Lisboa"], [13, "Portalegre"], [16, "Setúbal"], [8, "Évora"], [3, "Beja"], [9, "Faro"],
  [20, "Açores"], [21, "Madeira"],
];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_ATUAL = new Date().getMonth();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (v) => (v == null ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));
const num = (v) => new Intl.NumberFormat("pt-PT").format(v ?? 0);
const data = (s) => (s ? s.split("-").reverse().join("/") : "—");
const seguro = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const base = (id) => `https://www.base.gov.pt/Base4/pt/detalhe/?type=contratos&id=${id}`;

// Estado
const estado = { servicos: [], catalogo: [], cpvs: [], distritos: [], so_convite: true, empresa: "", tab: "novos", carregado: {} };
const filtro = () => ({ servicos: estado.servicos, cpvs: estado.cpvs.map((c) => c.cpv.replace(/0+$/, "") || c.cpv), distritos: estado.distritos, so_convite: estado.so_convite, anos: 5 });

let pendentes = 0;
const carregando = (d) => { pendentes += d; $("carregar").hidden = pendentes <= 0; };
async function rpc(nome, args) {
  carregando(1);
  try {
    const { data: d, error } = await sb.rpc(nome, args);
    if (error) throw error;
    return d;
  } finally { carregando(-1); }
}

// ---------- Sessão ----------
async function arrancar() {
  const { data: { session } } = await sb.auth.getSession();
  mostrar(session);
  sb.auth.onAuthStateChange((_e, s) => mostrar(s));
}
let iniciado = false;
async function mostrar(session) {
  $("v-login").hidden = !!session;
  $("v-app").hidden = !session;
  if (session && !iniciado) { iniciado = true; await iniciarApp(); }
  if (!session) iniciado = false;
}

$("f-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("l-msg"); msg.className = "msg"; msg.textContent = "A entrar…";
  const { error } = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-pass").value });
  if (error) { msg.className = "msg erro"; msg.textContent = error.message === "Invalid login credentials" ? "Email ou palavra-passe errados." : error.message; }
  else msg.textContent = "";
});
$("b-registar").addEventListener("click", async () => {
  const msg = $("l-msg"); msg.className = "msg";
  const email = $("l-email").value.trim(), password = $("l-pass").value;
  if (!email || password.length < 6) { msg.className = "msg erro"; msg.textContent = "Indique o email e uma palavra-passe com pelo menos 6 caracteres."; return; }
  msg.textContent = "A criar conta…";
  const { data: d, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) { msg.className = "msg erro"; msg.textContent = error.message; return; }
  msg.textContent = d.session ? "" : "Conta criada. Abra o email de confirmação que enviámos e depois entre aqui.";
});
$("b-sair").addEventListener("click", () => sb.auth.signOut());

// ---------- Painel de filtros ----------
async function iniciarApp() {
  try {
    const [catalogo, perfil] = await Promise.all([rpc("radar_servicos"), rpc("radar_perfil")]);
    estado.catalogo = catalogo || [];
    if (perfil) {
      estado.servicos = perfil.servicos || [];
      estado.cpvs = (perfil.cpvs || []).map((c) => ({ cpv: c, designacao: "" }));
      estado.distritos = perfil.distritos || [];
      estado.so_convite = perfil.so_convite ?? true;
      estado.empresa = perfil.empresa || "";
    }
    desenharPainel();
    if (!perfil || (!estado.servicos.length && !estado.cpvs.length)) {
      abrirPainel(true);
      $("kpis").innerHTML = "";
      $("filtro-txt").textContent = "Escolha os serviços que a sua empresa presta e a zona onde trabalha, e carregue em «Guardar e ver resultados».";
      return;
    }
    await recarregar();
  } catch (e) { erroGeral(e); }
}

function desenharPainel() {
  const grupos = {};
  estado.catalogo.forEach((s) => (grupos[s.grupo] ??= []).push(s));
  $("servicos").innerHTML = Object.entries(grupos).map(([g, lista]) => `
    <div class="grupo"><p class="grupo-t">${esc(g)}</p><div class="chips">
      ${lista.map((s) => `<button type="button" class="chip" data-sv="${esc(s.codigo)}" aria-pressed="${estado.servicos.includes(s.codigo)}">${esc(s.nome)}</button>`).join("")}
    </div></div>`).join("");
  $("distritos").innerHTML = DISTRITOS.map(([id, n]) => `<button type="button" class="chip" data-di="${id}" aria-pressed="${estado.distritos.includes(id)}">${esc(n)}</button>`).join("");
  $("so-convite").checked = estado.so_convite;
  $("empresa").value = estado.empresa;
  $("t-empresa").textContent = estado.empresa || "Radar de contratos públicos";
  desenharCpvs();
}
function desenharCpvs() {
  $("cpv-sel").innerHTML = estado.cpvs.map((c, i) => `<button type="button" class="chip" aria-pressed="true" data-rm="${i}" title="Remover">${esc(c.cpv)}${c.designacao ? " · " + esc(c.designacao) : ""}<span class="x" aria-hidden="true">×</span></button>`).join("");
}

$("painel").addEventListener("click", (e) => {
  const sv = e.target.closest("[data-sv]"), di = e.target.closest("[data-di]"), rm = e.target.closest("[data-rm]"), op = e.target.closest("[data-cpv]");
  if (sv) { const c = sv.dataset.sv; estado.servicos = estado.servicos.includes(c) ? estado.servicos.filter((x) => x !== c) : [...estado.servicos, c]; sv.setAttribute("aria-pressed", estado.servicos.includes(c)); }
  if (di) { const d = +di.dataset.di; estado.distritos = estado.distritos.includes(d) ? estado.distritos.filter((x) => x !== d) : [...estado.distritos, d]; di.setAttribute("aria-pressed", estado.distritos.includes(d)); }
  if (rm) { estado.cpvs.splice(+rm.dataset.rm, 1); desenharCpvs(); }
  if (op) {
    if (!estado.cpvs.some((c) => c.cpv === op.dataset.cpv)) estado.cpvs.push({ cpv: op.dataset.cpv, designacao: op.dataset.d });
    $("cpv-res").innerHTML = ""; $("cpv-q").value = ""; desenharCpvs();
  }
});
$("cpv-res").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-cpv]")) e.target.click(); });

let tq;
$("cpv-q").addEventListener("input", () => {
  clearTimeout(tq);
  const q = $("cpv-q").value.trim();
  if (q.length < 2) { $("cpv-res").innerHTML = ""; return; }
  tq = setTimeout(async () => {
    const r = await rpc("radar_cpv_pesquisa", { q }).catch(() => []);
    $("cpv-res").innerHTML = (r || []).map((c) => `<li tabindex="0" role="option" data-cpv="${esc(c.cpv)}" data-d="${esc(c.designacao)}">${esc(c.designacao)} <small>${esc(c.cpv)} · ${num(c.n)} contratos</small></li>`).join("") ||
      `<li aria-disabled="true"><small>Nenhum código encontrado.</small></li>`;
  }, 250);
});
$("so-convite").addEventListener("change", (e) => (estado.so_convite = e.target.checked));
$("empresa").addEventListener("input", (e) => (estado.empresa = e.target.value));

$("b-guardar").addEventListener("click", async () => {
  const msg = $("p-msg"); msg.className = "msg";
  if (!estado.servicos.length && !estado.cpvs.length) { msg.className = "msg erro"; msg.textContent = "Escolha pelo menos um serviço."; return; }
  msg.textContent = "A guardar…";
  try {
    await rpc("radar_perfil_guardar", { p: { empresa: estado.empresa, servicos: estado.servicos, cpvs: estado.cpvs.map((c) => c.cpv), distritos: estado.distritos, so_convite: estado.so_convite } });
    $("t-empresa").textContent = estado.empresa || "Radar de contratos públicos";
    msg.textContent = "Guardado.";
    abrirPainel(false);
    await recarregar();
  } catch (e) { msg.className = "msg erro"; msg.textContent = "Não foi possível guardar: " + e.message; }
});

function abrirPainel(abrir) {
  $("painel").classList.toggle("aberto", abrir);
  $("b-filtros").setAttribute("aria-expanded", abrir);
}
$("b-filtros").addEventListener("click", () => abrirPainel(!$("painel").classList.contains("aberto")));

// ---------- Resultados ----------
function textoFiltro() {
  const sv = estado.catalogo.filter((s) => estado.servicos.includes(s.codigo)).map((s) => s.nome);
  const cp = estado.cpvs.map((c) => c.designacao || c.cpv);
  const di = DISTRITOS.filter(([id]) => estado.distritos.includes(id)).map(([, n]) => n);
  return `${[...sv, ...cp].join(", ")} · ${di.length ? di.join(", ") : "todo o país"} · ${estado.so_convite ? "só por convite" : "todos os procedimentos"}`;
}

async function recarregar() {
  estado.carregado = {};
  recarregarCompradores();
  novos = null;
  $("filtro-txt").textContent = textoFiltro();
  try {
    const r = await rpc("radar_resumo", { f: filtro() });
    $("kpis").innerHTML = [
      [num(r.contratos), "contratos"],
      [num(r.compradores), "entidades compradoras"],
      [num(r.por_convite), "por convite"],
      [new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(r.valor || 0), "valor total"],
    ].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
    $("filtro-txt").textContent = textoFiltro() + (r.de ? ` · contratos de ${data(r.de)} a ${data(r.ate)}` : "");
    await abrirTab(estado.tab);
  } catch (e) { erroGeral(e); }
}

document.querySelector(".principal").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) abrirTab(b.dataset.tab); });
async function abrirTab(t) {
  estado.tab = t;
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => { b.setAttribute("aria-selected", b.dataset.tab === t); if (b.dataset.tab === t) b.scrollIntoView({ block: "nearest", inline: "nearest" }); });
  document.querySelectorAll(".vista").forEach((v) => (v.hidden = v.id !== "tab-" + t));
  if (estado.carregado[t] || t === "concorrer") return;
  estado.carregado[t] = true;
  try {
    if (t === "compradores" || t === "calendario") await carregarCompradores();
    if (t === "novos") await carregarNovos();
    if (t === "abertos") await carregarAbertos();
    if (t === "terminar") await carregarTerminar();
    if (t === "concorrencia") await carregarConcorrencia();
    if (t === "precos") $("precos").innerHTML = $("precos").innerHTML || `<div class="vazio">Escreva um tipo de trabalho acima.</div>`;
  } catch (e) { estado.carregado[t] = false; erroGeral(e); }
}

let compradores = null, limCompradores = 30;
async function carregarCompradores() {
  if (!compradores) compradores = await rpc("radar_compradores", { f: filtro(), lim: 300 });
  desenharCompradores(); desenharCalendario();
}
const recarregarCompradores = () => { compradores = null; limCompradores = 30; };

function mini(meses) {
  const max = Math.max(1, ...meses);
  return `<div class="mini" aria-label="Contratos por mês">${meses.map((n, i) => `<i class="${i === MES_ATUAL ? "agora" : ""}" title="${MESES[i]}: ${n}" style="background:${n ? `color-mix(in srgb, var(--azul) ${Math.round(25 + 75 * n / max)}%, white)` : "var(--soft)"}"></i>`).join("")}</div>`;
}
function desenharCompradores() {
  const el = $("compradores");
  if (!compradores?.length) { el.innerHTML = `<div class="vazio">Nenhuma entidade encontrada com estes filtros. Experimente juntar mais serviços ou distritos.</div>`; return; }
  el.innerHTML = compradores.slice(0, limCompradores).map((c) => `
    <article class="comprador">
      <div>
        <h3>${esc(c.nome)}</h3>
        <div class="meta">${esc([c.concelho, c.distrito].filter(Boolean).join(", "))}${c.nif ? ` · NIF ${esc(c.nif)}` : ""} · último em ${data(c.ultima)}</div>
        ${mini(c.meses)}
      </div>
      <div class="nums"><b>${num(c.n_convite)}</b> por convite de ${num(c.n)} · valor típico ${eur(c.mediana)}</div>
      <div class="det">
        <div><strong>Fornecedores habituais</strong>${(c.fornecedores || []).map((f) => `${esc(f.nome)} (${f.n})`).join("; ") || "—"}</div>
        <div><strong>Últimos trabalhos</strong>${(c.ultimos || []).slice(0, 2).map((o) => esc(o.length > 140 ? o.slice(0, 140) + "…" : o)).join("<br>")}</div>
      </div>
    </article>`).join("") +
    (compradores.length > limCompradores ? `<button class="btn mais" id="b-mais-c">Mostrar mais ${Math.min(30, compradores.length - limCompradores)}</button>` : "");
  $("b-mais-c")?.addEventListener("click", () => { limCompradores += 30; desenharCompradores(); });
}
function desenharCalendario() {
  const el = $("calendario");
  const lista = (compradores || []).filter((c) => c.n >= 2).slice(0, 30);
  if (!lista.length) { el.innerHTML = `<div class="vazio">Sem entidades com compras repetidas para mostrar no calendário.</div>`; return; }
  const max = Math.max(1, ...lista.flatMap((c) => c.meses));
  el.innerHTML = `<div class="cal"><span></span>${MESES.map((m, i) => `<span class="h${i === MES_ATUAL ? " agora" : ""}">${m}</span>`).join("")}
    ${lista.map((c) => `<span class="n" title="${esc(c.nome)}">${esc(c.nome)}</span>${c.meses.map((n, i) => {
      const a = n ? 0.2 + 0.8 * n / max : 0;
      return `<span class="c${i === MES_ATUAL ? " agora" : ""}" title="${esc(c.nome)} — ${MESES[i]}: ${n} contrato(s)" style="${n ? `background:color-mix(in srgb, var(--azul) ${Math.round(a * 100)}%, white);color:${a > 0.55 ? "#fff" : "var(--ink)"}` : ""}">${n || ""}</span>`;
    }).join("")}`).join("")}</div>`;
}

function cartaoConcurso(a, porVer) {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const dias = a.data_limite ? Math.round((new Date(a.data_limite) - hoje) / 864e5) : null;
    const dist = DISTRITOS.filter(([id]) => (a.distritos || []).includes(id)).map(([, n]) => n).join(", ");
    const local = [a.concelho, dist !== a.concelho ? dist : ""].filter(Boolean).join(" · ");
    const prazo = dias == null ? `<b>—</b><span>prazo no anúncio</span>` : dias < 0 ? `<b>Fechado</b><span>${data(a.data_limite)}</span>`
      : `<b>${dias === 0 ? "Hoje" : dias === 1 ? "1 dia" : dias + " dias"}</b><span>até ${data(a.data_limite)}</span>`;
    return `<article class="concurso${porVer ? " por-ver" : ""}">
      <div class="prazo${dias != null && dias <= 5 ? " urgente" : ""}">${prazo}</div>
      <div><h3>${porVer ? '<span class="etiqueta-novo">Novo</span>' : ""}${esc(a.descricao)}</h3>
        <div class="meta">${esc(a.entidade)}${local ? " · " + esc(local) : ""}</div>
        <div class="meta">${esc(a.modelo || "")}${a.tipos_contrato ? " · " + esc(a.tipos_contrato) : ""}${a.cpv_designacao ? " · " + esc(a.cpv_designacao) : ""}${a.tipo_acto && /altera/i.test(a.tipo_acto) ? " · prazo alterado" : ""}</div></div>
      <div class="valor">${a.preco_base ? `<b>${eur(a.preco_base)}</b>preço base<br><small>máximo, sem IVA</small>` : ""}</div>
      <div class="acoes">
        ${seguro(a.url_pecas) ? `<a class="btn pequeno primario" href="${esc(seguro(a.url_pecas))}" target="_blank" rel="noopener">Abrir peças e concorrer</a>` : ""}
        ${seguro(a.url_dr) ? `<a class="btn pequeno" href="${esc(seguro(a.url_dr))}" target="_blank" rel="noopener">Anúncio no Diário da República</a>` : ""}
      </div>
    </article>`;
}

async function carregarAbertos() {
  const r = await rpc("radar_concursos", { f: filtro() });
  const el = $("abertos");
  if (!r?.length) { el.innerHTML = `<div class="vazio">Não há concursos abertos para estes serviços e zona neste momento. Experimente juntar mais serviços ou distritos.</div>`; return; }
  el.innerHTML = r.map((a) => cartaoConcurso(a, false)).join("");
}

// ---------- Novos (alertas dentro da aplicação) ----------
const CHAVE_VISTOS = "radar-vistos";
const lerVistos = () => { try { return new Set(JSON.parse(localStorage.getItem(CHAVE_VISTOS) || "[]")); } catch { return new Set(); } };
const guardarVistos = (s) => { try { localStorage.setItem(CHAVE_VISTOS, JSON.stringify([...s].slice(-2000))); } catch { /* sem armazenamento */ } };
let novos = null;
async function contarNovos() {
  try {
    novos = await rpc("radar_novos", { f: filtro(), dias: 7 });
    const vistos = lerVistos(), n = (novos || []).filter((a) => !vistos.has(a.id)).length;
    $("n-novos").hidden = !n; $("n-novos").textContent = n;
  } catch { /* o separador mostra o erro */ }
}
async function carregarNovos() {
  if (!novos) await contarNovos();
  const el = $("novos");
  if (!novos?.length) { el.innerHTML = `<div class="vazio">Nenhum concurso novo nos últimos 7 dias para estes serviços e zona.</div>`; return; }
  const vistos = lerVistos();
  const porDia = {};
  novos.forEach((a) => (porDia[a.data_publicacao] ??= []).push(a));
  el.innerHTML = Object.entries(porDia).map(([d, lista]) => `<h3 class="dia">${new Date(d).toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}</h3>` +
    lista.map((a) => cartaoConcurso(a, !vistos.has(a.id))).join("")).join("");
  novos.forEach((a) => vistos.add(a.id));
  guardarVistos(vistos);
  $("n-novos").hidden = true;
}

async function carregarTerminar() {
  const r = await rpc("radar_a_terminar", { f: filtro() });
  const el = $("terminar");
  if (!r?.length) { el.innerHTML = `<div class="vazio">Nenhum contrato longo a terminar nos próximos 9 meses com estes filtros.</div>`; return; }
  const hoje = new Date(), em90 = new Date(Date.now() + 90 * 864e5);
  el.innerHTML = `<table class="tabela empilhar"><thead><tr><th>Fim estimado</th><th>Entidade</th><th>Objeto</th><th>Fornecedor atual</th><th class="r">Valor</th><th></th></tr></thead><tbody>
    ${r.map((t) => { const f = new Date(t.data_fim_estimada); return `<tr>
      <td class="nw ${f <= em90 && f >= hoje ? "fim-proximo" : ""}" data-l="Fim">${data(t.data_fim_estimada)}</td>
      <td data-l="Entidade">${esc(t.adjudicante)}</td><td>${esc(t.objeto)}</td>
      <td data-l="Fornecedor">${esc(t.adjudicatario)}</td><td class="r" data-l="Valor">${eur(t.preco)}</td>
      <td><a href="${base(t.id)}" target="_blank" rel="noopener">Ver no Base</a></td></tr>`; }).join("")}</tbody></table>`;
}

async function carregarConcorrencia() {
  const r = await rpc("radar_concorrentes", { f: filtro(), lim: 60 });
  const el = $("concorrencia");
  if (!r?.length) { el.innerHTML = `<div class="vazio">Sem fornecedores para mostrar.</div>`; return; }
  el.innerHTML = `<table class="tabela empilhar"><thead><tr><th>Empresa</th><th class="r">Contratos</th><th class="r">Por convite</th><th class="r">Clientes</th><th class="r">Valor</th><th>Último</th></tr></thead><tbody>
    ${r.map((k) => `<tr><td><b>${esc(k.nome)}</b>${k.nif ? `<br><small>NIF ${esc(k.nif)}</small>` : ""}</td><td class="r" data-l="Contratos">${num(k.n)}</td><td class="r" data-l="Por convite">${num(k.n_convite)}</td><td class="r" data-l="Clientes">${num(k.clientes)}</td><td class="r" data-l="Valor">${eur(k.total)}</td><td class="nw" data-l="Último">${data(k.ultimo)}</td></tr>`).join("")}</tbody></table>`;
}

async function procurarPrecos() {
  const q = $("preco-q").value.trim();
  if (!q) return;
  const f = { ...filtro(), texto: q, so_convite: false };
  try {
    const [res, lista] = await Promise.all([rpc("radar_precos", { f }), rpc("radar_contratos", { f, lim: 60, off: 0 })]);
    $("precos-resumo").innerHTML = res?.n ? `<div class="faixa">
      <div><b>${num(res.n)}</b><span>contratos</span></div><div><b>${eur(res.p25)}</b><span>mais baratos (25%)</span></div>
      <div><b>${eur(res.mediana)}</b><span>valor mediano</span></div><div><b>${eur(res.p75)}</b><span>mais caros (75%)</span></div></div>` : "";
    $("precos").innerHTML = lista?.length ? `<table class="tabela empilhar"><thead><tr><th>Data</th><th>Objeto</th><th>Entidade</th><th>Procedimento</th><th class="r">Preço</th><th></th></tr></thead><tbody>
      ${lista.map((c) => `<tr><td class="nw" data-l="Data">${data(c.data_celebracao)}</td><td>${esc(c.objeto)}</td><td data-l="Entidade">${esc(c.adjudicante)}</td><td data-l="Procedimento">${esc(c.procedimento)}</td><td class="r" data-l="Preço">${eur(c.preco)}</td><td><a href="${base(c.id)}" target="_blank" rel="noopener">Ver no Base</a></td></tr>`).join("")}</tbody></table>`
      : `<div class="vazio">Nenhum contrato com «${esc(q)}» nos serviços e zona escolhidos.</div>`;
  } catch (e) { erroGeral(e); }
}
$("b-preco").addEventListener("click", procurarPrecos);
$("preco-q").addEventListener("keydown", (e) => { if (e.key === "Enter") procurarPrecos(); });

function erroGeral(e) {
  console.error(e);
  $("filtro-txt").innerHTML = `<span class="msg erro">Não foi possível carregar os dados: ${esc(e.message || e)}. Tente novamente dentro de momentos.</span>`;
}

arrancar();
