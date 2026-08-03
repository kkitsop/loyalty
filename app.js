'use strict';
/* ================= KOFI Loyalty — cloud (Supabase) ================= */

const CFG = window.KOFI_CONFIG || {};
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR-PROJECT');
let sb = null;
if (configured) sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => Number(n || 0).toFixed(2).replace('.', ',') + '€';
const maskPhone = (p) => { p = String(p||'').replace(/\s+/g,''); return p.length > 3 ? '•••' + p.slice(-3) : (p || '—'); };
const maskName = (c) => { const fn = (c.name||'Πελάτης').trim(); const s = (c.surname||'').trim(); return s ? `${fn} ${s[0]}.` : fn; };

function screen(id){ document.querySelectorAll('.screen').forEach(s => s.classList.remove('on')); $(id).classList.add('on'); }
function openM(id){ $(id).classList.add('on'); }
function closeM(id){ $(id).classList.remove('on'); }
function loader(on, txt){ if(txt) $('loader-txt').textContent = txt; $('loader').classList.toggle('on', on); }

const ICON = {
  star:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  coffee:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>',
  gift:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>'
};

function toast(msg, type='info'){
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateY(-8px)'; setTimeout(()=>el.remove(),320); }, 2800);
}

/* ---------- state ---------- */
const STORE_KEY = 'kofi_loyalty_store';
let state = { user:null, memberships:[], store:null, role:'staff', customers:[], txns:[], activeId:null, editId:null, channel:null };

/* ================= OFFLINE QUEUE (idempotent sync) ================= */
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => { const r=Math.random()*16|0, v=ch==='x'?r:(r&0x3|0x8); return v.toString(16); }));

let opQueue = [];
const qKey = () => 'kofi_q_' + (state.store ? state.store.id : 'none');
function loadQueue(){ try { opQueue = JSON.parse(localStorage.getItem(qKey()) || '[]'); } catch(_) { opQueue = []; } updateNetUI(); }
function saveQueue(){ try { localStorage.setItem(qKey(), JSON.stringify(opQueue)); } catch(_){} updateNetUI(); }
function enqueue(op){ opQueue.push(op); saveQueue(); }

function custRow(c){ return { id:c.id, store_id:state.store.id, name:c.name??null, surname:c.surname??null, phone:c.phone??null,
  points:c.points||0, visits:c.visits||0, total_spent:c.total_spent||0, deleted_at:c.deleted_at??null, created_by:c.created_by||state.user.id }; }
function saveCustomerRow(c){ pushOp({ k:'cust', row: custRow(c) }); }

async function runOp(op){
  try {
    let error;
    if (op.k==='cust') ({ error } = await sb.from('customers').upsert(op.row));
    else               ({ error } = await sb.from('loyalty_txns').insert(op.row));
    if (!error) return 'ok';
    if (op.k==='txn' && error.code==='23505') return 'ok';   // ήδη καταχωρημένη (idempotent)
    return error.code ? 'drop' : 'retry';                    // PG error=μόνιμο · αλλιώς δικτύου
  } catch(_) { return 'retry'; }                             // αποτυχία δικτύου -> ξαναδοκίμασε
}
async function pushOp(op){
  if (!navigator.onLine){ enqueue(op); return; }
  const r = await runOp(op);
  if (r==='retry') enqueue(op);
}
let flushing = false;
async function flushQueue(){
  if (flushing || !navigator.onLine || !opQueue.length) return;
  flushing = true;
  while (opQueue.length && navigator.onLine){
    const r = await runOp(opQueue[0]);
    if (r==='retry') break;
    opQueue.shift(); saveQueue();
  }
  flushing = false; updateNetUI();
}
function updateNetUI(){
  const el = document.getElementById('net-indicator'); if (!el) return;
  const off = !navigator.onLine, pend = opQueue.length;
  if (off){ el.className='net off'; el.textContent = pend ? `Εκτός σύνδεσης · ${pend} σε αναμονή` : 'Εκτός σύνδεσης — οι αλλαγές θα συγχρονιστούν'; el.style.display='block'; }
  else if (pend){ el.className='net sync'; el.textContent = `Συγχρονισμός… ${pend} σε αναμονή`; el.style.display='block'; }
  else { el.style.display='none'; }
}
window.addEventListener('online',  () => { updateNetUI(); flushQueue(); });
window.addEventListener('offline', updateNetUI);
setInterval(() => { if (opQueue.length) flushQueue(); }, 15000);

/* ================= AUTH ================= */
async function boot(){
  if (!configured){
    loader(false); screen('screen-auth');
    toast('Συμπλήρωσε το config.js με τα στοιχεία Supabase', 'warn');
    return;
  }
  const redirect = location.origin + location.pathname;

  $('btn-google').onclick = async () => {
    loader(true,'Άνοιγμα Google…');
    const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: redirect }});
    if (error){ loader(false); toast('Σφάλμα σύνδεσης Google','error'); }
  };
  $('btn-magic').onclick = async () => {
    const email = $('auth-email').value.trim();
    if (!email){ toast('Γράψε το email σου','warn'); return; }
    loader(true,'Αποστολή…');
    const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: redirect }});
    loader(false);
    if (error) toast('Δεν στάλθηκε το email','error');
    else toast('Έλεγξε το email σου για τον σύνδεσμο','success');
  };
  $('btn-signout').onclick = $('btn-signout-2').onclick = signOut;

  sb.auth.onAuthStateChange((_e, session) => { handleSession(session); });
  const { data:{ session } } = await sb.auth.getSession();
  handleSession(session);
}

async function handleSession(session){
  if (!session){ state.user = null; loader(false); screen('screen-auth'); return; }
  if (state.user && state.user.id === session.user.id) return; // ήδη ενεργός
  state.user = session.user;
  loader(true,'Φόρτωση…');
  await sb.from('profiles').upsert({ id:state.user.id, full_name: session.user.user_metadata?.full_name || null });
  await loadMemberships();
}

async function signOut(){
  if (!confirm('Αποσύνδεση;')) return;
  loader(true,'Αποσύνδεση…');
  if (state.channel){ sb.removeChannel(state.channel); state.channel=null; }
  await sb.auth.signOut();
  localStorage.removeItem(STORE_KEY);
  state = { user:null, memberships:[], store:null, role:'staff', customers:[], txns:[], activeId:null, editId:null, channel:null };
  loader(false); screen('screen-auth');
}

/* ================= ΚΑΤΑΣΤΗΜΑΤΑ ================= */
async function loadMemberships(){
  const { data, error } = await sb.from('memberships')
    .select('role,active,store_id,stores(*)').eq('user_id', state.user.id).eq('active', true);
  loader(false);
  if (error){ toast('Σφάλμα φόρτωσης καταστημάτων','error'); return; }
  state.memberships = (data || []).filter(m => m.stores);

  const saved = localStorage.getItem(STORE_KEY);
  const pick = state.memberships.find(m => m.store_id === saved) || (state.memberships.length===1 ? state.memberships[0] : null);
  if (pick){ enterStore(pick); return; }
  renderStorePicker(); screen('screen-stores');
}

function renderStorePicker(){
  const box = $('store-picker'), list = $('store-list');
  if (!state.memberships.length){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  list.innerHTML = state.memberships.map(m => `
    <button class="btn btn-ghost" style="justify-content:space-between;margin-bottom:10px" data-store="${m.store_id}">
      <span>${esc(m.stores.name)}</span>
      <span class="pill ${m.role==='admin'?'admin':'staff'}">${m.role==='admin'?'Διαχ/στής':'Προσωπικό'}</span>
    </button>`).join('');
  list.querySelectorAll('[data-store]').forEach(b => b.onclick = () => {
    enterStore(state.memberships.find(m => m.store_id === b.dataset.store));
  });
}

function enterStore(m){
  state.store = m.stores; state.role = m.role;
  localStorage.setItem(STORE_KEY, m.store_id);
  $('hdr-name').textContent = state.store.name;
  $('hdr-role').textContent = m.role==='admin' ? 'Διαχειριστής' : 'Προσωπικό';
  $('btn-settings').classList.toggle('hidden', m.role!=='admin');
  $('btn-analytics').classList.toggle('hidden', m.role!=='admin');
  loadQueue();
  screen('screen-app');
  subscribeRealtime();
  refresh();
}

/* create / join */
$('btn-create-store').onclick = async () => {
  const name = $('store-name').value.trim();
  if (!name){ toast('Γράψε όνομα καταστήματος','warn'); return; }
  loader(true,'Δημιουργία…');
  const { data, error } = await sb.rpc('create_store', { p_name:name });
  loader(false);
  if (error){ toast('Δεν δημιουργήθηκε','error'); return; }
  await loadMembershipsThen(data.id, 'admin', data);
  toast('Το κατάστημα δημιουργήθηκε','success');
};
$('btn-join-store').onclick = async () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length < 4){ toast('Γράψε τον κωδικό','warn'); return; }
  loader(true,'Είσοδος…');
  const { data, error } = await sb.rpc('join_store', { p_code:code });
  loader(false);
  if (error){ toast(error.message==='invalid_code' ? 'Λάθος κωδικός' : 'Σφάλμα εισόδου','error'); return; }
  await loadMembershipsThen(data.id, 'staff', data);
  toast('Μπήκες στο κατάστημα','success');
};
async function loadMembershipsThen(storeId, role, store){
  localStorage.setItem(STORE_KEY, storeId);
  const { data } = await sb.from('memberships').select('role,active,store_id,stores(*)').eq('user_id', state.user.id).eq('active', true);
  state.memberships = (data || []).filter(m => m.stores);
  const m = state.memberships.find(x => x.store_id === storeId) || { stores: store, role, store_id: storeId };
  enterStore(m);
}

/* ================= ΔΕΔΟΜΕΝΑ ================= */
async function refresh(){
  loader(true,'Φόρτωση δεδομένων…');
  try {
    const [c, t, s] = await Promise.all([
      sb.from('customers').select('*').is('deleted_at', null).eq('store_id', state.store.id).order('created_at',{ascending:false}),
      sb.from('loyalty_txns').select('*').eq('store_id', state.store.id),
      sb.from('stores').select('*').eq('id', state.store.id).single()
    ]);
    if (c.error) throw c.error;
    if (!opQueue.length){ state.customers = c.data || []; state.txns = t.data || []; }
    if (s.data) state.store = s.data;
    renderCustomers($('search').value);
    autoLocalBackup(); maybeRemindBackup();
  } catch(e){ console.error(e); }
  loader(false); updateNetUI(); flushQueue();
}

function renderCustomers(filter=''){
  $('stat-cust').textContent = state.customers.length;
  $('stat-pts').textContent  = state.customers.reduce((s,c)=>s+(c.points||0),0).toLocaleString('el-GR');
  const list = $('cust-list');
  const q = (filter||'').trim().toLowerCase();

  if (!q){
    list.innerHTML = `<div class="empty">Η λίστα είναι κρυφή για λόγους απορρήτου.<br>Πληκτρολόγησε όνομα ή τηλέφωνο για αναζήτηση.</div>`;
    return;
  }
  const rows = state.customers.filter(c =>
    (`${c.name||''} ${c.surname||''} ${c.phone||''}`).toLowerCase().includes(q));
  if (!rows.length){ list.innerHTML = `<div class="empty">Δεν βρέθηκε πελάτης.</div>`; return; }

  list.innerHTML = rows.map(c => {
    const nm = c.name || 'Πελάτης';
    const init = (c.name ? c.name[0] : 'Π').toUpperCase();
    const req = state.store.points_required;
    const gifts = Math.floor((c.points||0) / req);
    return `<div class="row" data-id="${c.id}">
      <div class="ava${gifts?' ava-gift':''}">${gifts?'🎁':esc(init)}</div>
      <div class="row-main"><b>${esc(maskName(c))}</b><span>${c.phone ? esc(maskPhone(c.phone)) : 'Χωρίς τηλέφωνο'}</span></div>
      <div class="row-pts">
        ${gifts?`<span class="gift-tag">Έτοιμο για δώρο${gifts>1?' ×'+gifts:''}</span>`:''}
        <b>${ICON.star} ${c.points||0}</b><span>${c.visits||0} επισκ.</span>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.row').forEach(r => r.onclick = () => openAction(r.dataset.id));
}
$('search').oninput = (e) => renderCustomers(e.target.value);

/* ================= ΠΕΛΑΤΗΣ: add / edit / save / delete ================= */
$('btn-add-cust').onclick = () => {
  state.editId = null;
  $('edit-title').textContent = 'Νέος πελάτης';
  ['edit-name','edit-surname','edit-phone'].forEach(id => $(id).value = '');
  $('btn-del').classList.add('hidden');
  openM('m-edit');
  $('edit-name').focus({ preventScroll:true });
};

function openEdit(){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  closeM('m-action'); state.editId = c.id;
  $('edit-title').textContent = 'Επεξεργασία πελάτη';
  $('edit-name').value = c.name || ''; $('edit-surname').value = c.surname || ''; $('edit-phone').value = c.phone || '';
  $('btn-del').classList.remove('hidden');
  openM('m-edit');
  $('edit-name').focus({ preventScroll:true });
}

$('btn-save-cust').onclick = () => {
  const name = $('edit-name').value.trim(), phone = $('edit-phone').value.trim();
  if (!name && !phone){ toast('Χρειάζεται όνομα ή τηλέφωνο','warn'); return; }
  const payload = { name, surname:$('edit-surname').value.trim(), phone };
  if (phone && state.customers.some(x => x.phone===phone && !x.deleted_at && x.id!==state.editId)){
    toast('Υπάρχει ήδη πελάτης με αυτό το τηλέφωνο','error'); return;
  }
  if (state.editId === null){
    const c = { id: uuid(), store_id:state.store.id, ...payload, points:0, visits:0, total_spent:0, deleted_at:null, created_by:state.user.id, created_at:new Date().toISOString() };
    state.customers.unshift(c);
    saveCustomerRow(c);
    logTx('NEW_CUST', 0, 0, c.id);
    toast('Ο πελάτης προστέθηκε','success');
  } else {
    const c = state.customers.find(x => x.id === state.editId);
    if (c){ Object.assign(c, payload); saveCustomerRow(c); }
    toast('Ενημερώθηκε','success');
  }
  $('search').value=''; renderCustomers(''); closeM('m-edit');
};

$('btn-del').onclick = () => {
  if (!confirm('Διαγραφή πελάτη; Το ιστορικό συναλλαγών διατηρείται.')) return;
  const c = state.customers.find(x => x.id === state.editId);
  if (c){ c.deleted_at = new Date().toISOString(); saveCustomerRow(c); }
  state.customers = state.customers.filter(x => x.id !== state.editId);
  renderCustomers($('search').value); closeM('m-edit'); toast('Διαγράφηκε','warn');
};

/* ================= ΕΝΕΡΓΕΙΕΣ ΠΕΛΑΤΗ ================= */
function custLevel(v){ v = v||0; if (v>=50) return {n:'VIP',c:'#7A5AF8'}; if (v>=25) return {n:'Gold',c:'#C8871F'}; if (v>=10) return {n:'Silver',c:'#8A8A8A'}; return {n:'Bronze',c:'#A0703C'}; }

function openAction(id){
  const c = state.customers.find(x => String(x.id) === String(id)); if (!c) return;
  state.activeId = c.id;
  const req = state.store.points_required, disc = state.store.discount_amount;
  const pts = c.points || 0, can = pts >= req, pct = Math.min(100, Math.round(pts / req * 100));
  const gifts = Math.floor(pts / req);
  const lvl = custLevel(c.visits);
  const nm = c.name ? `${c.name} ${c.surname||''}` : `Πελάτης (${c.phone||'—'})`;
  $('act-name').textContent = nm.trim();

  $('act-body').innerHTML = `
    <div class="ring ${can?'done':''}" style="--p:${pct}">
      <div class="in"><b>${pts}</b><span>πόντοι</span></div>
    </div>
    <div class="reward-note ${can?'ready':'progress'}">
      ${can ? `${ICON.gift} <b>Δικαιούται δώρο ${esc(fmt(disc))}</b>${gifts>1?`<span class="gifts-avail">Διαθέσιμα ×${gifts}</span>`:''}` : `Ακόμη <b>${req-pts}</b> για δώρο ${esc(fmt(disc))}`}
    </div>
    <div class="cust-meta">
      <span><span class="lvl" style="background:${lvl.c}">${lvl.n}</span></span>
      <span><b>${c.visits||0}</b> επισκέψεις</span>
      <span>Σύνολο αγορών <b>${esc(fmt(c.total_spent))}</b></span>
    </div>
    <button class="btn btn-green" id="a-redeem" ${can?'':'disabled'}>Εξαργύρωση δώρου (−${req} ${ICON.star})</button>

    <div class="eyebrow">Προσθήκη πόντων</div>
    <div class="quick">
      <button class="q" data-add="1">${ICON.coffee}<span>+1</span></button>
      <button class="q" data-add="2">${ICON.coffee}<span>+2</span></button>
      <button class="q" data-add="3">${ICON.coffee}<span>+3</span></button>
    </div>
    <div class="custom">
      <input type="number" id="a-pts" inputmode="numeric" placeholder="Πόντοι">
      <input type="number" id="a-eur" inputmode="decimal" step="0.10" placeholder="Τζίρος €">
      <button class="btn btn-dark" id="a-custom">+</button>
    </div>
    <button class="btn btn-ghost" id="a-edit">Επεξεργασία στοιχείων</button>`;

  $('act-body').querySelectorAll('[data-add]').forEach(b => b.onclick = () => addPoints(+b.dataset.add, 0));
  $('a-custom').onclick = () => { const p=parseInt($('a-pts').value)||0, e=parseFloat($('a-eur').value)||0; if(p<=0&&e<=0){toast('Γράψε πόντους ή ποσό','warn');return;} addPoints(p,e); };
  $('a-redeem').onclick = redeem;
  $('a-edit').onclick = openEdit;
  openM('m-action');
}

function logTx(type, pts, eur, custId){
  const row = { client_id: uuid(), store_id:state.store.id, customer_id:custId||null, type, points:pts||0, amount:eur||0, created_by:state.user.id };
  state.txns.push({ ...row, created_at: new Date().toISOString() });
  pushOp({ k:'txn', row });
}

let undoTimer = null;
async function addPoints(coffees, euros){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  const req = state.store.points_required;
  const prev = { points: c.points||0, visits: c.visits||0, total: c.total_spent||0 };
  const newP = prev.points + coffees;
  c.points = newP; c.visits = prev.visits + 1; c.total_spent = prev.total + euros;
  openAction(c.id); renderCustomers($('search').value);
  saveCustomerRow(c);
  logTx('ADD_PTS', coffees, euros, c.id);
  if (Math.floor(prev.points/req) < Math.floor(newP/req)) openM('m-reward');
  undoAddToast(c.id, coffees, euros, prev);
}

/* Undo 5 δευτ. — αντί να σβήσει την κίνηση (append-only), γράφει αντίστροφη κίνηση */
function undoAddToast(custId, coffees, euros, prev){
  clearTimeout(undoTimer);
  const el = document.createElement('div');
  el.className = 'toast success undo-toast';
  el.innerHTML = `<span>+${coffees} πόντοι</span><button>Αναίρεση</button>`;
  $('toasts').appendChild(el);
  const kill = () => { el.style.opacity='0'; el.style.transform='translateY(-8px)'; setTimeout(()=>el.remove(),320); };
  el.querySelector('button').onclick = async () => {
    clearTimeout(undoTimer); kill(); closeM('m-reward');
    const c = state.customers.find(x => String(x.id) === String(custId)); if (!c) return;
    c.points = prev.points; c.visits = prev.visits; c.total_spent = prev.total;
    if (state.activeId === custId) openAction(custId);
    renderCustomers($('search').value);
    saveCustomerRow(c);
    logTx('ADD_PTS', -coffees, -euros, custId);
    toast('Αναιρέθηκε','warn');
  };
  undoTimer = setTimeout(kill, 5000);
}

async function redeem(){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  const req = state.store.points_required;
  if ((c.points||0) < req){ toast('Δεν επαρκούν οι πόντοι','error'); return; }
  const newP = c.points - req; c.points = newP;
  openAction(c.id); renderCustomers($('search').value);
  saveCustomerRow(c);
  logTx('REDEEM', req, 0, c.id);
  toast('Επιτυχής εξαργύρωση!','success');
}

/* ================= ΣΤΑΤΙΣΤΙΚΑ ================= */
$('btn-stats').onclick = () => { drawStats('today'); openM('m-stats'); };
$('stat-tabs').querySelectorAll('.tab').forEach(t => t.onclick = () => {
  $('stat-tabs').querySelectorAll('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on'); drawStats(t.dataset.period);
});
function drawStats(period){
  const now = new Date(); let start = new Date(0);
  if (period==='today') start = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  else if (period==='week'){ const d = now.getDay()||7; start = new Date(now.getFullYear(),now.getMonth(),now.getDate()-d+1); }
  else if (period==='month') start = new Date(now.getFullYear(),now.getMonth(),1);
  else if (period==='year') start = new Date(now.getFullYear(),0,1);
  let nw=0,pts=0,red=0,eur=0;
  state.txns.forEach(t => { if (new Date(t.created_at) >= start){
    if (t.type==='NEW_CUST') nw++;
    if (t.type==='ADD_PTS'){ pts += t.points; eur += Number(t.amount); }
    if (t.type==='REDEEM') red++;
  }});
  $('s-new').textContent = nw; $('s-pts').textContent = pts; $('s-red').textContent = red; $('s-eur').textContent = fmt(eur);
  drawChart();
}

function drawChart(){
  const now = new Date(); const days = [];
  for (let i=6; i>=0; i--){ days.push({ d:new Date(now.getFullYear(),now.getMonth(),now.getDate()-i), pts:0 }); }
  state.txns.forEach(t => {
    if (t.type !== 'ADD_PTS') return;
    const dt = new Date(t.created_at);
    const day = days.find(x => x.d.getFullYear()===dt.getFullYear() && x.d.getMonth()===dt.getMonth() && x.d.getDate()===dt.getDate());
    if (day) day.pts += t.points;
  });
  const max = Math.max(1, ...days.map(x => Math.max(0, x.pts)));
  const wd = ['Κυ','Δε','Τρ','Τε','Πε','Πα','Σα'];
  $('stat-chart').innerHTML =
    `<div class="bars">${days.map(x => { const v=Math.max(0,x.pts), h=Math.round(v/max*100); return `<div class="bar ${v?'has':''}" style="height:${Math.max(3,h)}%">${v?`<span>${v}</span>`:''}</div>`; }).join('')}</div>` +
    `<div class="lbls">${days.map(x => `<div>${wd[x.d.getDay()]}</div>`).join('')}</div>`;
}

/* ================= ΡΥΘΜΙΣΕΙΣ (admin) ================= */
$('btn-settings').onclick = () => {
  $('set-code').textContent = state.store.join_code;
  $('set-req').value = state.store.points_required;
  $('set-disc').value = state.store.discount_amount;
  renderStaff(); openM('m-settings');
};

/* Ορισμός δικού σου κωδικού εισόδου (αντί για τον τυχαίο) */
$('btn-save-code').onclick = async () => {
  const code = ($('set-newcode').value || '').trim().toUpperCase().replace(/\s+/g,'');
  if (!/^[A-Z0-9]{4,12}$/.test(code)){ toast('Κωδικός 4-12 χαρακτήρες (A-Z, 0-9)','warn'); return; }
  loader(true,'Αλλαγή κωδικού…');
  const { error } = await sb.from('stores').update({ join_code: code }).eq('id', state.store.id);
  loader(false);
  if (error){ toast(error.code === '23505' ? 'Ο κωδικός χρησιμοποιείται ήδη αλλού' : 'Σφάλμα αλλαγής','error'); return; }
  state.store.join_code = code; $('set-code').textContent = code; $('set-newcode').value = '';
  toast('Ο κωδικός εισόδου άλλαξε','success');
};
$('btn-save-set').onclick = async () => {
  const req = parseInt($('set-req').value), disc = parseFloat($('set-disc').value);
  if (isNaN(req)||req<1){ toast('Μη έγκυροι πόντοι','warn'); return; }
  if (isNaN(disc)||disc<0){ toast('Μη έγκυρο ποσό','warn'); return; }
  loader(true,'Αποθήκευση…');
  const { error } = await sb.from('stores').update({ points_required:req, discount_amount:disc }).eq('id', state.store.id);
  loader(false);
  if (error){ toast('Σφάλμα','error'); return; }
  state.store.points_required = req; state.store.discount_amount = disc;
  toast('Οι ρυθμίσεις αποθηκεύτηκαν','success'); closeM('m-settings');
};

/* Αλλαγή καταστήματος — επιστροφή στην οθόνη επιλογής/δημιουργίας χωρίς αποσύνδεση */
$('btn-switch-store').onclick = () => {
  if (state.channel){ sb.removeChannel(state.channel); state.channel = null; }
  localStorage.removeItem(STORE_KEY);
  closeM('m-settings');
  renderStorePicker(); screen('screen-stores');
};

/* Διαγραφή καταστήματος (μόνο Διαχειριστής, μέσω RLS) */
$('btn-delete-store').onclick = async () => {
  if (!confirm(`Οριστική διαγραφή του καταστήματος «${state.store.name}»;\n\nΘα διαγραφούν ΟΛΟΙ οι πελάτες, πόντοι και το ιστορικό αυτού του καταστήματος. Δεν αναιρείται.`)) return;
  loader(true,'Διαγραφή…');
  const { error } = await sb.from('stores').delete().eq('id', state.store.id);
  loader(false);
  if (error){ toast('Σφάλμα διαγραφής — χρειάζεσαι ρόλο Διαχειριστή','error'); return; }
  if (state.channel){ sb.removeChannel(state.channel); state.channel = null; }
  localStorage.removeItem(STORE_KEY); state.store = null;
  closeM('m-settings');
  toast('Το κατάστημα διαγράφηκε','warn');
  await loadMemberships();
};

async function renderStaff(){
  const box = $('staff-list'); box.innerHTML = '<div class="empty" style="padding:16px">Φόρτωση…</div>';
  const { data, error } = await sb.from('memberships')
    .select('id,role,active,user_id,display_name').eq('store_id', state.store.id).order('created_at');
  if (error){ box.innerHTML = '<div class="empty" style="padding:16px">Σφάλμα φόρτωσης</div>'; return; }
  box.innerHTML = (data||[]).map(m => {
    const me = m.user_id === state.user.id;
    const roleCls = !m.active ? 'off' : (m.role==='admin'?'admin':'staff');
    const roleTxt = !m.active ? 'Ανενεργός' : (m.role==='admin'?'Διαχ/στής':'Προσωπικό');
    return `<div class="staff">
      <div class="staff-main"><b>${esc(m.display_name||'Μέλος')}${me?' (εσύ)':''}</b><span>${roleTxt}</span></div>
      <span class="pill ${roleCls}">${roleTxt}</span>
      ${me ? '' : `<button class="btn btn-sm ${m.active?'btn-ghost':'btn-green'}" data-toggle="${m.id}" data-active="${m.active}">${m.active?'Απενεργ.':'Ενεργ.'}</button>`}
    </div>`;
  }).join('') || '<div class="empty" style="padding:16px">Κανένα μέλος</div>';
  box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    loader(true,'…');
    const { error } = await sb.from('memberships').update({ active: b.dataset.active!=='true' }).eq('id', b.dataset.toggle);
    loader(false);
    if (error) toast('Σφάλμα','error'); else renderStaff();
  });
}

$('btn-csv').onclick = () => {
  if (!state.customers.length){ toast('Δεν υπάρχουν πελάτες','warn'); return; }
  let csv = '\uFEFFΌνομα,Επώνυμο,Τηλέφωνο,Πόντοι,Επισκέψεις\n';
  state.customers.forEach(c => {
    const f = v => `"${String(v??'').replace(/"/g,'""')}"`;
    csv += [f(c.name),f(c.surname),f(c.phone),c.points||0,c.visits||0].join(',') + '\n';
  });
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = `kofi_pelates_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

/* ---- Πλήρες backup (JSON) — για μεταφορά αργότερα στη σουίτα ---- */
function exportBackup(){
  const phoneOf = (cid) => (state.customers.find(x => x.id === cid) || {}).phone || null;
  const snapshot = {
    kind: 'kofi-loyalty-backup', version: 1, exported_at: new Date().toISOString(),
    store: { name: state.store.name, points_required: state.store.points_required, discount_amount: state.store.discount_amount },
    customers: state.customers.map(c => ({ name:c.name, surname:c.surname, phone:c.phone, points:c.points||0, visits:c.visits||0, total_spent:c.total_spent||0, created_at:c.created_at })),
    txns: state.txns.map(t => ({ type:t.type, points:t.points, amount:t.amount, phone:phoneOf(t.customer_id), created_at:t.created_at }))
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type:'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `kofi_loyalty_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  localStorage.setItem('kofi_bak_last_' + state.store.id, new Date().toISOString().slice(0,10));
  toast('Το backup ημέρας κατέβηκε','success');
}
$('btn-backup').onclick = exportBackup;
$('btn-backup-day').onclick = exportBackup;

/* Αυτόματο τοπικό snapshot (rolling 7 ημερών, στη συσκευή) */
function autoLocalBackup(){
  if (!state.store) return;
  const today = new Date().toISOString().slice(0,10);
  const pref = 'kofi_autobak_' + state.store.id + '_';
  const snap = { exported_at:new Date().toISOString(), customers: state.customers.map(c => ({ name:c.name, surname:c.surname, phone:c.phone, points:c.points||0, visits:c.visits||0, total_spent:c.total_spent||0 })) };
  try {
    localStorage.setItem(pref + today, JSON.stringify(snap));
    const keys = Object.keys(localStorage).filter(k => k.startsWith(pref)).sort();
    while (keys.length > 7){ localStorage.removeItem(keys.shift()); }
  } catch(_){}
}
/* Υπενθύμιση backup στο κλείσιμο (μία φορά ανά είσοδο, μετά τις 18:00) */
function maybeRemindBackup(){
  if (state.remindedBackup || !state.store) return;
  state.remindedBackup = true;
  const now = new Date(); if (now.getHours() < 18) return;
  const today = now.toISOString().slice(0,10);
  if (localStorage.getItem('kofi_bak_last_' + state.store.id) === today) return;
  if (state.txns.some(t => (t.created_at||'').slice(0,10) === today))
    toast('Θυμήσου το backup ημέρας 📦 — κουμπί ⬇ πάνω','warn');
}

/* ---- Επαναφορά από backup (JSON) ---- */
$('btn-restore').onclick = () => $('file-restore').click();
$('file-restore').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  let data; try { data = JSON.parse(await file.text()); } catch(_) { toast('Μη έγκυρο JSON','error'); return; }
  if (data.kind !== 'kofi-loyalty-backup' || !Array.isArray(data.customers)){ toast('Δεν είναι backup KOFI Loyalty','error'); return; }
  const existing = new Set(state.customers.filter(c => c.phone).map(c => c.phone));
  const fresh = data.customers.filter(c => !c.phone || !existing.has(c.phone));
  if (!fresh.length){ toast('Όλοι οι πελάτες υπάρχουν ήδη','warn'); return; }
  if (!confirm(`Προσθήκη ${fresh.length} πελατών στο τρέχον κατάστημα; (δεν διαγράφεται τίποτα)`)) return;
  loader(true,'Επαναφορά…');
  try {
    const { data: ins, error } = await sb.from('customers').insert(
      fresh.map(c => ({ store_id:state.store.id, name:c.name||null, surname:c.surname||null, phone:c.phone||null,
        points:c.points||0, visits:c.visits||0, total_spent:c.total_spent||0, created_by:state.user.id }))
    ).select();
    if (error) throw error;
    const byPhone = {}; ins.forEach(c => { if (c.phone) byPhone[c.phone] = c.id; });
    if (Array.isArray(data.txns) && data.txns.length){
      const rows = data.txns.filter(t => t.phone && byPhone[t.phone])
        .map(t => ({ store_id:state.store.id, customer_id:byPhone[t.phone], type:t.type||'ADD_PTS', points:t.points||0, amount:t.amount||0, created_by:state.user.id }));
      if (rows.length) await sb.from('loyalty_txns').insert(rows);
    }
    await refresh();
    toast(`Επαναφορά: ${ins.length} πελάτες`,'success'); closeM('m-settings');
  } catch(err){ console.error(err); toast('Σφάλμα επαναφοράς','error'); }
  loader(false);
};

/* ---- Εισαγωγή πελατών από CSV (όνομα, επώνυμο, τηλέφωνο) ---- */
function parseCSV(text){
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const out = []; let row = [], field = '', inQ = false;
  for (let i=0; i<text.length; i++){
    const ch = text[i];
    if (inQ){ if (ch === '"'){ if (text[i+1] === '"'){ field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field=''; }
    else if (ch === '\n'){ row.push(field); out.push(row); row=[]; field=''; }
    else field += ch;
  }
  if (field !== '' || row.length){ row.push(field); out.push(row); }
  return out.filter(r => r.some(c => String(c).trim() !== ''));
}
$('btn-import').onclick = () => $('file-import').click();
$('file-import').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  const rows = parseCSV(await file.text());
  if (!rows.length){ toast('Άδειο ή μη αναγνώσιμο CSV','error'); return; }
  let start = 0, ci = { name:0, surname:1, phone:2 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const find = (keys) => head.findIndex(h => keys.some(k => h.includes(k)));
  const iN = find(['όνομα','ονομα','name','first']), iS = find(['επώνυμο','επωνυμο','surname','last']), iP = find(['τηλ','κινητ','phone','mobile']);
  if (iN > -1 || iS > -1 || iP > -1){ start = 1; ci = { name:iN>-1?iN:0, surname:iS>-1?iS:1, phone:iP>-1?iP:2 }; }
  const existing = new Set(state.customers.filter(c => c.phone).map(c => c.phone));
  const seen = new Set(); const toAdd = [];
  for (let i=start; i<rows.length; i++){
    const r = rows[i];
    const name = (r[ci.name]||'').trim(), surname = (r[ci.surname]||'').trim(), phone = (r[ci.phone]||'').trim();
    if (!name && !phone) continue;
    if (phone && (existing.has(phone) || seen.has(phone))) continue;
    if (phone) seen.add(phone);
    toAdd.push({ store_id:state.store.id, name:name||null, surname:surname||null, phone:phone||null, created_by:state.user.id });
  }
  if (!toAdd.length){ toast('Κανένας νέος πελάτης για εισαγωγή','warn'); return; }
  if (!confirm(`Εισαγωγή ${toAdd.length} πελατών;`)) return;
  loader(true,'Εισαγωγή…');
  try {
    const { data: ins, error } = await sb.from('customers').insert(toAdd).select();
    if (error) throw error;
    await refresh();
    toast(`Εισήχθησαν ${ins.length} πελάτες`,'success'); closeM('m-settings');
  } catch(err){ console.error(err); toast('Σφάλμα εισαγωγής','error'); }
  loader(false);
};

/* ================= REALTIME ================= */
function subscribeRealtime(){
  if (state.channel){ sb.removeChannel(state.channel); state.channel=null; }
  state.channel = sb.channel('store-' + state.store.id)
    .on('postgres_changes', { event:'*', schema:'public', table:'customers', filter:`store_id=eq.${state.store.id}` }, silentSync)
    .on('postgres_changes', { event:'*', schema:'public', table:'loyalty_txns', filter:`store_id=eq.${state.store.id}` }, silentSync)
    .subscribe();
}
let syncTimer = null;
function silentSync(){
  if (document.querySelector('.modal.on')) return; // μη διακόπτεις ενεργή ενέργεια
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (opQueue.length || !navigator.onLine) return;
    const [c,t] = await Promise.all([
      sb.from('customers').select('*').is('deleted_at', null).eq('store_id', state.store.id).order('created_at',{ascending:false}),
      sb.from('loyalty_txns').select('*').eq('store_id', state.store.id)
    ]);
    if (c.data) state.customers = c.data;
    if (t.data) state.txns = t.data;
    renderCustomers($('search').value);
  }, 600);
}

/* ================= ANALYTICS (admin) ================= */
$('btn-analytics').onclick = openAnalytics;
async function openAnalytics(){
  openM('m-analytics');
  const cust = state.customers, txns = state.txns;
  const totalSpent = cust.reduce((s,c)=>s+Number(c.total_spent||0),0);
  $('an-avg').textContent = fmt(cust.length ? totalSpent/cust.length : 0);
  $('an-ret').textContent = (cust.length ? Math.round(cust.filter(c=>(c.visits||0)>=2).length / cust.length * 100) : 0) + '%';
  const redeemed = new Set(txns.filter(t=>t.type==='REDEEM').map(t=>t.customer_id));
  $('an-conv').textContent = (cust.length ? Math.round(redeemed.size / cust.length * 100) : 0) + '%';
  $('an-gifts').textContent = txns.filter(t=>t.type==='REDEEM').length;

  const topC = [...cust].sort((a,b)=>Number(b.total_spent||0)-Number(a.total_spent||0)).slice(0,5);
  const medal = (i)=> i===0?'gold':i===1?'silver':i===2?'bronze':'';
  $('an-top-cust').innerHTML = topC.length ? topC.map((c,i)=>{
    const nm = ((c.name||'Πελάτης')+' '+(c.surname||'')).trim();
    return `<div class="rank"><div class="n ${medal(i)}">${i+1}</div><div class="rank-main"><b>${esc(nm)}</b><span>${c.visits||0} επισκ. · ${c.points||0} πόντοι</span></div><div class="val">${esc(fmt(c.total_spent))}</div></div>`;
  }).join('') : '<div class="empty" style="padding:16px">Χωρίς δεδομένα</div>';

  const { data: members } = await sb.from('memberships').select('user_id,display_name').eq('store_id', state.store.id);
  const nameOf = {}; (members||[]).forEach(m=>nameOf[m.user_id]=m.display_name||'Μέλος');
  const counts = {};
  txns.forEach(t=>{ if(t.type==='ADD_PTS' && t.created_by && t.points>0) counts[t.created_by]=(counts[t.created_by]||0)+1; });
  const topS = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  $('an-top-staff').innerHTML = topS.length ? topS.map(([uid,n],i)=>
    `<div class="rank"><div class="n ${medal(i)}">${i+1}</div><div class="rank-main"><b>${esc(nameOf[uid]||'Μέλος')}</b><span>καταχωρήσεις πόντων</span></div><div class="val">${n}</div></div>`
  ).join('') : '<div class="empty" style="padding:16px">Χωρίς δεδομένα</div>';
}

/* modal close buttons + backdrop */
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeM(b.dataset.close));
document.querySelectorAll('.modal').forEach(m => m.onclick = (e) => { if (e.target === m) closeM(m.id); });

/* service worker */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

boot();
