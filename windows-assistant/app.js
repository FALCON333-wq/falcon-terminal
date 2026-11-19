const $=s=>document.querySelector(s);let conversationId=null,speakReplies=false,lastReply="";
async function api(path,options={}){const r=await fetch(path,{headers:{"Content-Type":"application/json"},...options});const j=await r.json();if(!r.ok)throw Error(j.error||r.statusText);return j}
function bubble(role,content,meta=""){const box=document.createElement("div");box.className="bubble "+role;const m=document.createElement("div");m.className="meta";m.textContent=meta||role.toUpperCase();const body=document.createElement("div");body.textContent=content;box.append(m,body);$("#messages").append(box);$("#messages").scrollTop=$("#messages").scrollHeight}
function showWelcome(){ $("#messages").innerHTML='<div class="welcome"><div class="orb">F</div><div class="eyebrow">SYSTEM READY</div><h2>Think clearly.<br><span>Move with purpose.</span></h2><p>Ask FALCON to research, plan, explain, write code, or help organize your work.</p><div class="suggestions"><button class="suggestion">Help me plan today\'s priorities</button><button class="suggestion">Explain how my local AI models work</button><button class="suggestion">Create a Windows app project plan</button></div></div>'}
async function loadStatus(){try{const s=await api("/api/status");$("#statusDot").classList.toggle("ok",s.ollama==="connected");$("#statusText").textContent=s.ollama==="connected"?"Ollama connected":"Ollama offline"}catch{$("#statusText").textContent="Server unavailable"}}
async function loadModels(){try{const d=await api("/api/models"),sel=$("#modelSelect"),old=sel.value;sel.innerHTML='<option value="auto">Auto select model</option>';d.models.forEach(m=>{const o=document.createElement("option");o.value=m.name;o.textContent=m.name;sel.append(o)});if([...sel.options].some(o=>o.value===old))sel.value=old}catch(e){bubble("error",e.message)}}
async function loadHistory(){try{const d=await api("/api/conversations");$("#history").innerHTML="";d.conversations.forEach(c=>{const b=document.createElement("button");b.textContent=c.title;b.title=c.title;b.onclick=()=>openConversation(c.id);$("#history").append(b)})}catch{}}
async function openConversation(id){conversationId=id;const d=await api("/api/conversations/"+encodeURIComponent(id));$("#messages").innerHTML="";d.messages.forEach(m=>bubble(m.role,m.content,m.model||m.role));}
async function sendMessage(text){if(!text.trim())return;$("#prompt").value="";if(!conversationId)conversationId="chat-"+Date.now();bubble("user",text);$("#send").disabled=true;$("#send").textContent="Thinking…";try{const d=await api("/api/chat",{method:"POST",body:JSON.stringify({message:text,model:$("#modelSelect").value,conversation_id:conversationId})});conversationId=d.conversation_id;lastReply=d.reply;bubble("assistant",d.reply,d.model);if(speakReplies&&"speechSynthesis"in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(d.reply))}loadHistory()}catch(e){bubble("error",e.message,"REQUEST FAILED")}finally{$("#send").disabled=false;$("#send").textContent="Send ↗"}}
$("#chatForm").addEventListener("submit",e=>{e.preventDefault();sendMessage($("#prompt").value)});
$("#newChat").onclick=()=>{conversationId=null;showWelcome()};
$("#refresh").onclick=()=>{loadModels();loadStatus()};
$("#speakToggle").onclick=()=>{speakReplies=!speakReplies;$("#speakToggle").style.borderColor=speakReplies?"var(--cyan)":"var(--line)";if(!speakReplies&&"speechSynthesis"in window)speechSynthesis.cancel()};
$("#voiceInput").onclick=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){bubble("error","Voice recognition is not supported in this browser. Try Microsoft Edge.");return}const rec=new SR();rec.lang=navigator.language||"en-IN";rec.onresult=e=>{$("#prompt").value=e.results[0][0].transcript;$("#prompt").focus()};rec.onerror=e=>bubble("error","Voice input: "+e.error);rec.start()};
document.addEventListener("click",e=>{if(e.target.classList.contains("suggestion"))sendMessage(e.target.textContent)});
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.panel+"Panel").classList.add("active");$("#panelTitle").textContent=b.textContent.trim();if(b.dataset.panel==="tasks")loadTasks();if(b.dataset.panel==="memory")loadMemory()});
$("#taskForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/tasks",{method:"POST",body:JSON.stringify({title:$("#taskTitle").value})});$("#taskTitle").value="";loadTasks()}catch(x){alert(x.message)}};
async function loadTasks(){const d=await api("/api/tasks");$("#taskList").innerHTML="";d.tasks.forEach(t=>{const el=document.createElement("div");el.className="item"+(t.done?" done":"");const cb=document.createElement("input");cb.type="checkbox";cb.checked=!!t.done;cb.onchange=async()=>{await api("/api/tasks/"+t.id,{method:"PATCH",body:JSON.stringify({done:cb.checked})});loadTasks()};const label=document.createElement("span");label.textContent=t.title;const del=document.createElement("button");del.textContent="Delete";del.onclick=async()=>{await api("/api/tasks/"+t.id,{method:"DELETE"});loadTasks()};el.append(cb,label,del);$("#taskList").append(el)})}
$("#memoryForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/memory",{method:"POST",body:JSON.stringify({content:$("#memoryText").value})});$("#memoryText").value="";loadMemory()}catch(x){alert(x.message)}};
async function loadMemory(){const d=await api("/api/memory");$("#memoryList").innerHTML="";d.memories.forEach(m=>{const el=document.createElement("div");el.className="item";const label=document.createElement("span");label.textContent=m.content;const del=document.createElement("button");del.textContent="Delete";del.onclick=async()=>{await api("/api/memory/"+m.id,{method:"DELETE"});loadMemory()};el.append(label,del);$("#memoryList").append(el)})}
loadStatus();loadModels();loadHistory();setInterval(loadStatus,15000);
$("#researchForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const query=$("#researchQuery").value.trim();
 if(!query)return;
 const button=$("#researchButton"),status=$("#researchStatus"),report=$("#researchReport"),sourcesBox=$("#researchSources");
 button.disabled=true;button.textContent="Researching…";
 status.textContent="Searching the web, then asking your selected local model to analyze the returned evidence.";
 report.textContent="";sourcesBox.innerHTML="";
 try{
  const result=await api("/api/research",{method:"POST",body:JSON.stringify({query,model:$("#modelSelect").value})});
  report.textContent=result.report||"No report returned.";
  status.textContent="Research complete · "+(result.model||"search only")+" · "+(result.sources||[]).length+" source results";
  if(result.evidence_scope){const note=document.createElement("p");note.className="researchscope";note.textContent=result.evidence_scope;sourcesBox.append(note)}
  (result.sources||[]).forEach((source,index)=>{
   const card=document.createElement("div");card.className="sourcecard";
   const number=document.createElement("span");number.className="sourcenumber";number.textContent="["+(index+1)+"]";
   const body=document.createElement("div");body.className="sourcebody";
   const link=document.createElement("a");link.href=source.url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=source.title||source.url;
   const snippet=document.createElement("p");snippet.textContent=source.snippet||"No search snippet provided.";
   const url=document.createElement("small");url.textContent=source.url;
   body.append(link,snippet,url);card.append(number,body);sourcesBox.append(card);
  });
 }catch(error){status.textContent="Research failed: "+error.message;report.textContent="No verified report was produced. Check internet access, Ollama connectivity, and the selected model."}
 finally{button.disabled=false;button.textContent="Research ↗"}
});
