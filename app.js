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
      sb.from('customers').select('*').eq('store_id', state.store.id).order('created_at',{ascending:false}),
      sb.from('loyalty_txns').select('*').eq('store_id', state.store.id),
      sb.from('stores').select('*').eq('id', state.store.id).single()
    ]);
    if (c.error) throw c.error;
    state.customers = c.data || [];
    state.txns = t.data || [];
    if (s.data) state.store = s.data;
    renderCustomers($('search').value);
  } catch(e){ console.error(e); toast('Σφάλμα σύνδεσης με το cloud','error'); }
  loader(false);
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
    return `<div class="row" data-id="${c.id}">
      <div class="ava">${esc(init)}</div>
      <div class="row-main"><b>${esc(nm)} ${esc(c.surname||'')}</b><span>${esc(c.phone||'Χωρίς τηλέφωνο')}</span></div>
      <div class="row-pts"><b>${ICON.star} ${c.points||0}</b><span>${c.visits||0} επισκ.</span></div>
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
};

function openEdit(){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  closeM('m-action'); state.editId = c.id;
  $('edit-title').textContent = 'Επεξεργασία πελάτη';
  $('edit-name').value = c.name || ''; $('edit-surname').value = c.surname || ''; $('edit-phone').value = c.phone || '';
  $('btn-del').classList.remove('hidden');
  openM('m-edit');
}

$('btn-save-cust').onclick = async () => {
  const name = $('edit-name').value.trim(), phone = $('edit-phone').value.trim();
  if (!name && !phone){ toast('Χρειάζεται όνομα ή τηλέφωνο','warn'); return; }
  const payload = { name, surname:$('edit-surname').value.trim(), phone };
  loader(true,'Αποθήκευση…');
  if (state.editId === null){
    const { data, error } = await sb.from('customers')
      .insert({ ...payload, store_id:state.store.id, created_by:state.user.id }).select().single();
    if (!error){
      state.customers.unshift(data);
      await logTx('NEW_CUST', 0, 0, data.id);
      toast('Ο πελάτης προστέθηκε','success');
    } else toast(error.code==='23505' ? 'Υπάρχει ήδη πελάτης με αυτό το τηλέφωνο' : 'Σφάλμα προσθήκης','error');
  } else {
    const { error } = await sb.from('customers').update(payload).eq('id', state.editId);
    if (!error){ const c = state.customers.find(x => x.id === state.editId); if (c) Object.assign(c, payload); toast('Ενημερώθηκε','success'); }
    else toast('Σφάλμα ενημέρωσης','error');
  }
  loader(false); $('search').value=''; renderCustomers(''); closeM('m-edit');
};

$('btn-del').onclick = async () => {
  if (!confirm('Οριστική διαγραφή πελάτη;')) return;
  loader(true,'Διαγραφή…');
  const { error } = await sb.from('customers').delete().eq('id', state.editId);
  loader(false);
  if (!error){ state.customers = state.customers.filter(x => x.id !== state.editId); renderCustomers($('search').value); closeM('m-edit'); toast('Διαγράφηκε','warn'); }
  else toast('Σφάλμα διαγραφής','error');
};

/* ================= ΕΝΕΡΓΕΙΕΣ ΠΕΛΑΤΗ ================= */
function openAction(id){
  const c = state.customers.find(x => String(x.id) === String(id)); if (!c) return;
  state.activeId = c.id;
  const req = state.store.points_required, disc = state.store.discount_amount;
  const pts = c.points || 0, can = pts >= req, pct = Math.min(100, Math.round(pts / req * 100));
  const nm = c.name ? `${c.name} ${c.surname||''}` : `Πελάτης (${c.phone||'—'})`;
  $('act-name').textContent = nm.trim();

  $('act-body').innerHTML = `
    <div class="ring ${can?'done':''}" style="--p:${pct}">
      <div class="in"><b>${pts}</b><span>πόντοι</span></div>
    </div>
    <div class="reward-note ${can?'ready':'progress'}">
      ${can ? `${ICON.gift} <b>Δικαιούται δώρο ${esc(fmt(disc))}</b>` : `Ακόμη <b>${req-pts}</b> για δώρο ${esc(fmt(disc))}`}
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

async function logTx(type, pts, eur, custId){
  const tx = { store_id:state.store.id, customer_id:custId||null, type, points:pts||0, amount:eur||0, created_by:state.user.id };
  const { data } = await sb.from('loyalty_txns').insert(tx).select().single();
  if (data) state.txns.push(data);
}

async function addPoints(coffees, euros){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  const req = state.store.points_required;
  const oldP = c.points||0, newP = oldP + coffees;
  c.points = newP; c.visits = (c.visits||0)+1; c.total_spent = (c.total_spent||0)+euros;
  openAction(c.id); renderCustomers($('search').value);
  const { error } = await sb.from('customers')
    .update({ points:newP, visits:c.visits, total_spent:c.total_spent }).eq('id', c.id);
  if (error){ toast('Αποτυχία συγχρονισμού','error'); return; }
  await logTx('ADD_PTS', coffees, euros, c.id);
  if (Math.floor(oldP/req) < Math.floor(newP/req)) openM('m-reward');
  else toast(`+${coffees} πόντοι`,'success');
}

async function redeem(){
  const c = state.customers.find(x => String(x.id) === String(state.activeId)); if (!c) return;
  const req = state.store.points_required;
  if ((c.points||0) < req){ toast('Δεν επαρκούν οι πόντοι','error'); return; }
  const newP = c.points - req; c.points = newP;
  openAction(c.id); renderCustomers($('search').value);
  const { error } = await sb.from('customers').update({ points:newP }).eq('id', c.id);
  if (error){ toast('Αποτυχία εξαργύρωσης','error'); return; }
  await logTx('REDEEM', req, 0, c.id);
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
}

/* ================= ΡΥΘΜΙΣΕΙΣ (admin) ================= */
$('btn-settings').onclick = () => {
  $('set-code').textContent = state.store.join_code;
  $('set-req').value = state.store.points_required;
  $('set-disc').value = state.store.discount_amount;
  renderStaff(); openM('m-settings');
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
$('btn-backup').onclick = () => {
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
  toast('Το backup κατέβηκε','success');
};

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
    const [c,t] = await Promise.all([
      sb.from('customers').select('*').eq('store_id', state.store.id).order('created_at',{ascending:false}),
      sb.from('loyalty_txns').select('*').eq('store_id', state.store.id)
    ]);
    if (c.data) state.customers = c.data;
    if (t.data) state.txns = t.data;
    renderCustomers($('search').value);
  }, 600);
}

/* modal close buttons + backdrop */
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeM(b.dataset.close));
document.querySelectorAll('.modal').forEach(m => m.onclick = (e) => { if (e.target === m) closeM(m.id); });

/* service worker */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});

boot();
