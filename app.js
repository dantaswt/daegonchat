const seedClients=[
  {name:"Studio Aurora",status:"active",owner:"Adilson",last:"hoje, 09:42",value:1250},
  {name:"Clínica Horizonte",status:"proposal",owner:"Adilson",last:"hoje, 08:18",value:1800},
  {name:"Colégio Norte",status:"active",owner:"Adilson",last:"ontem",value:2400},
  {name:"Lume Arquitetura",status:"lead",owner:"Adilson",last:"02 out",value:3200},
  {name:"Bossa Café",status:"proposal",owner:"Adilson",last:"01 out",value:980},
  {name:"Norte Saúde",status:"active",owner:"Adilson",last:"29 set",value:1650}
];

const seedTasks=[
  {id:1,title:"Enviar proposta revisada",meta:"Clínica Horizonte",due:"hoje",time:"11:30",done:false},
  {id:2,title:"Conferir notas fiscais",meta:"Financeiro · setembro",due:"hoje",time:"14:00",done:false},
  {id:3,title:"Follow-up de onboarding",meta:"Studio Aurora",due:"hoje",time:"16:30",done:false},
  {id:4,title:"Atualizar relatório semanal",meta:"Operações",due:"amanhã",time:"09:00",done:false},
  {id:5,title:"Revisar cadastro CRM",meta:"Lume Arquitetura",due:"sexta",time:"10:00",done:false},
  {id:6,title:"Organizar documentos",meta:"Colégio Norte",due:"sexta",time:"15:00",done:true},
  {id:7,title:"Responder ticket #1042",meta:"Atendimento",due:"hoje",time:"17:00",done:false}
];

const tickets=[
  {id:"#1042",title:"Acesso ao painel administrativo",client:"Colégio Norte",priority:"Alta",time:"34 min"},
  {id:"#1039",title:"Dúvida sobre cobrança mensal",client:"Studio Aurora",priority:"Normal",time:"1h 12m"},
  {id:"#1035",title:"Atualização cadastral",client:"Bossa Café",priority:"Normal",time:"2h 08m"},
  {id:"#1031",title:"Integração de novo usuário",client:"Norte Saúde",priority:"Alta",time:"3h 16m"}
];

let clients=JSON.parse(localStorage.getItem("daegonOpsClients")||"null")||seedClients;
let tasks=JSON.parse(localStorage.getItem("daegonOpsTasks")||"null")||seedTasks;
let crmFilter="all";
let taskFilter="all";
let currentView="overview";

const titles={overview:"Visão geral",crm:"Clientes & CRM",tasks:"Tarefas",finance:"Financeiro",support:"Suporte"};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

function switchView(id){
  currentView=id;
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.view===id));
  $("#pageTitle").textContent=titles[id];
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$$("[data-jump]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.jump)));

function showToast(message){
  const t=$("#toast");t.textContent=message;t.classList.add("show");
  clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>t.classList.remove("show"),2200);
}

function statusLabel(s){return s==="active"?"Ativo":s==="proposal"?"Proposta":"Lead"}
function statusPill(s){return '<span class="pill '+s+'">'+statusLabel(s)+'</span>'}

function renderClients(query=""){
  const q=query.trim().toLowerCase();
  const rows=clients.filter(c=>(crmFilter==="all"||c.status===crmFilter)&&(!q||c.name.toLowerCase().includes(q)||c.owner.toLowerCase().includes(q)));
  $("#clientRows").innerHTML=rows.map(c=>`
    <tr>
      <td>${c.name}</td>
      <td>${statusPill(c.status)}</td>
      <td>${c.owner}</td>
      <td>${c.last}</td>
      <td>R$ ${Number(c.value).toLocaleString("pt-BR")}</td>
      <td><button class="text-btn" data-client="${c.name}">•••</button></td>
    </tr>`).join("");
  $("#crmBadge").textContent=clients.length;
}
$$("[data-filter]").forEach(b=>b.addEventListener("click",()=>{
  $$("[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");crmFilter=b.dataset.filter;renderClients();
}));

function taskRow(t){
  return `<label class="task-row ${t.done?"done":""}">
    <input type="checkbox" data-task-id="${t.id}" ${t.done?"checked":""}>
    <div><b>${t.title}</b><span>${t.meta||"Sem contexto"}</span></div>
    <time>${t.due==="hoje"?t.time:t.due}</time>
  </label>`;
}
function filteredTasks(){
  return tasks.filter(t=>{
    if(taskFilter==="today") return t.due==="hoje";
    if(taskFilter==="open") return !t.done;
    if(taskFilter==="done") return t.done;
    return true;
  });
}
function renderTasks(){
  $("#priorityList").innerHTML=tasks.filter(t=>!t.done).slice(0,3).map(taskRow).join("");
  $("#taskList").innerHTML=filteredTasks().map(taskRow).join("");
  const open=tasks.filter(t=>!t.done).length;
  const today=tasks.filter(t=>!t.done&&t.due==="hoje").length;
  const done=tasks.filter(t=>t.done).length;
  const score=Math.round((done/tasks.length)*100)||0;
  $("#openTaskCount").textContent=open;$("#taskBadge").textContent=open;$("#openTasksMetric").textContent=open;$("#dueTodayMetric").textContent=today+" vencem hoje";
  $("#focusScore").textContent=score+"%";$(".focus-ring").style.setProperty("--progress",score+"%");
  $$("[data-task-id]").forEach(c=>c.addEventListener("change",()=>{
    const t=tasks.find(x=>x.id===Number(c.dataset.taskId));if(t){t.done=c.checked;saveTasks();renderTasks();}
  }));
}
function saveTasks(){localStorage.setItem("daegonOpsTasks",JSON.stringify(tasks))}
$$("[data-task-filter]").forEach(b=>b.addEventListener("click",()=>{
  $$("[data-task-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");taskFilter=b.dataset.taskFilter;renderTasks();
}));

$("#ticketGrid").innerHTML=tickets.map(t=>`
  <article class="ticket">
    <div class="ticket-top"><div><p class="eyebrow">${t.id} · ${t.client}</p><h3>${t.title}</h3></div><span class="pill ${t.priority==="Alta"?"proposal":""}">${t.priority}</span></div>
    <p>Solicitação em acompanhamento pela equipe de operações.</p>
    <footer><span>aberto há ${t.time}</span><span>ver ticket →</span></footer>
  </article>`).join("");

const recordModal=$("#recordModal"),taskModal=$("#taskModal");
function openModal(m){m.classList.add("open");m.setAttribute("aria-hidden","false")}
function closeModal(m){m.classList.remove("open");m.setAttribute("aria-hidden","true")}
["#newRecordBtn","#quickAddBtn","#crmNewBtn"].forEach(sel=>$(sel)?.addEventListener("click",()=>openModal(recordModal)));
$("#closeRecordModal").addEventListener("click",()=>closeModal(recordModal));
$("#closeTaskModal").addEventListener("click",()=>closeModal(taskModal));
$("#addTaskBtn").addEventListener("click",()=>openModal(taskModal));
[recordModal,taskModal].forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m)}));

$("#recordForm").addEventListener("submit",e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  clients.unshift({name:f.get("name"),value:Number(f.get("value")),status:f.get("status"),owner:"Adilson",last:"agora"});
  localStorage.setItem("daegonOpsClients",JSON.stringify(clients));renderClients();e.currentTarget.reset();closeModal(recordModal);showToast("Oportunidade adicionada ao CRM.");switchView("crm");
});
$("#taskForm").addEventListener("submit",e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  tasks.unshift({id:Date.now(),title:f.get("title"),meta:f.get("meta")||"Nova tarefa",due:f.get("due"),time:"",done:false});
  saveTasks();renderTasks();e.currentTarget.reset();closeModal(taskModal);showToast("Tarefa criada.");switchView("tasks");
});

$("#exportCsvBtn").addEventListener("click",()=>{
  const lines=[["Cliente","Status","Responsável","Último contato","Valor"],...clients.map(c=>[c.name,statusLabel(c.status),c.owner,c.last,c.value])];
  const csv=lines.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="daegon-ops-crm.csv";a.click();URL.revokeObjectURL(url);showToast("CSV exportado.");
});

const overlay=$("#commandOverlay"),cmdInput=$("#commandInput"),cmdResults=$("#commandResults");
const actions=[
  {label:"Visão geral",hint:"Navegação",run:()=>switchView("overview")},
  {label:"Abrir CRM",hint:"Navegação",run:()=>switchView("crm")},
  {label:"Abrir tarefas",hint:"Navegação",run:()=>switchView("tasks")},
  {label:"Abrir financeiro",hint:"Navegação",run:()=>switchView("finance")},
  {label:"Abrir suporte",hint:"Navegação",run:()=>switchView("support")},
  {label:"Nova oportunidade",hint:"Ação",run:()=>openModal(recordModal)},
  {label:"Nova tarefa",hint:"Ação",run:()=>openModal(taskModal)},
  {label:"Exportar CRM em CSV",hint:"Ação",run:()=>$("#exportCsvBtn").click()}
];
function openCommand(){overlay.classList.add("open");overlay.setAttribute("aria-hidden","false");cmdInput.value="";renderCommand();setTimeout(()=>cmdInput.focus(),30)}
function closeCommand(){overlay.classList.remove("open");overlay.setAttribute("aria-hidden","true")}
function commandItems(){
  const q=cmdInput.value.toLowerCase().trim();
  const clientActions=clients.map(c=>({label:c.name,hint:"Cliente · "+statusLabel(c.status),run:()=>{switchView("crm");renderClients(c.name)}}));
  return [...actions,...clientActions].filter(a=>!q||a.label.toLowerCase().includes(q)||a.hint.toLowerCase().includes(q));
}
function renderCommand(){
  const items=commandItems();cmdResults.innerHTML=items.map((a,i)=>`<button class="command-item ${i===0?"active":""}" data-cmd-index="${i}"><span>${a.label}</span><small>${a.hint}</small></button>`).join("");
  $$("[data-cmd-index]").forEach(b=>b.addEventListener("click",()=>{const item=commandItems()[Number(b.dataset.cmdIndex)];closeCommand();item?.run()}));
}
$("#searchTrigger").addEventListener("click",openCommand);cmdInput.addEventListener("input",renderCommand);
overlay.addEventListener("click",e=>{if(e.target===overlay)closeCommand()});
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommand()}
  if(e.key==="Escape"){closeCommand();closeModal(recordModal);closeModal(taskModal)}
});

const notifyPanel=$("#notificationsPanel");
$("#notifyBtn").addEventListener("click",()=>notifyPanel.classList.toggle("open"));
$("#closeNotifications").addEventListener("click",()=>notifyPanel.classList.remove("open"));

const savedTheme=localStorage.getItem("daegonOpsTheme");
if(savedTheme==="dark")document.body.classList.add("dark");
$("#themeToggle").addEventListener("click",()=>{
  document.body.classList.toggle("dark");localStorage.setItem("daegonOpsTheme",document.body.classList.contains("dark")?"dark":"light");
});

$("#workspaceBtn").addEventListener("click",()=>showToast("Workspace demo · dados locais"));
renderClients();renderTasks();
