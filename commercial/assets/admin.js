(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const statuses = ['New','Under Review','Contacted','Approved','Rejected'];
  let rows = [], page = 1, total = 0, limit = 30, debounce;
  function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = String(text); return n; }
  function shortDate(text) { return new Date(text).toLocaleDateString('en-LK', { year:'numeric',month:'short',day:'numeric' }); }
  function textCell(row, title, detail, cls) { const td = el('td',cls); td.append(el('strong','',title),el('small','',detail)); row.append(td); return td; }
  async function request(path, options={}) {
    const response = await fetch(path, { credentials:'same-origin', ...options });
    let body; try { body=await response.json(); } catch { body={error:'Unexpected server response.'}; }
    if (!response.ok) { const error = new Error(body.error || 'Request failed.'); error.code = response.status; throw error; }
    return body;
  }
  function showLogin() { $('loginPanel').hidden = false; $('dashboard').hidden = true; $('logoutBtn').hidden = true; }
  function showDashboard() { $('loginPanel').hidden = true; $('dashboard').hidden = false; $('logoutBtn').hidden = false; }
  function filterPath() {
    const p = new URLSearchParams({page:String(page)});
    if ($('statusFilter').value) p.set('status', $('statusFilter').value);
    if ($('typeFilter').value) p.set('type', $('typeFilter').value);
    if ($('searchInput').value.trim()) p.set('q', $('searchInput').value.trim());
    return '/commercial/api/submissions?' + p;
  }
  async function load() {
    $('tableError').textContent = '';
    $('tableInfo').textContent = 'Loading registrations...';
    try {
      const result = await request(filterPath());
      showDashboard(); rows = result.rows || []; total = result.total; page = result.page; limit = result.limit;
      render();
    } catch(e) {
      if (e.code === 401) { showLogin(); return; }
      $('tableError').textContent = e.message;
      $('tableInfo').textContent = 'Could not load registrations.';
    }
  }
  function render() {
    const tb = $('tableBody'); tb.replaceChildren();
    $('totalCount').textContent = total.toLocaleString('en-LK');
    $('pageCount').textContent = page;
    $('visibleCount').textContent = rows.length;
    $('tableInfo').textContent = total ? `Showing ${(page-1)*limit+1}–${(page-1)*limit+rows.length} of ${total}` : 'No matching registrations';
    $('prevBtn').disabled = page <= 1;
    $('nextBtn').disabled = page * limit >= total;
    if (!rows.length) { const tr=el('tr'),td=el('td','','No properties found.');td.colSpan=6;td.style.padding='44px 20px';td.style.textAlign='center';tr.append(td);tb.append(tr);return; }
    for (const item of rows) {
      const tr = el('tr');
      textCell(tr, `CP-${String(item.id).padStart(5,'0')}`,shortDate(item.submitted_at));
      textCell(tr,item.full_name,item.phone);
      textCell(tr,item.property_type,item.property_size ? `${item.property_size} ${item.size_unit}` : 'Size not provided');
      const loc = textCell(tr,item.city,item.district);
      const maps = el('a','map-small','View map ↗');maps.href=item.maps_url;maps.target='_blank';maps.rel='noopener noreferrer';loc.append(maps);
      const statusTd=el('td');const select=el('select','status-select');select.setAttribute('aria-label',`Update status for CP-${item.id}`);
      for(const status of statuses){const o=el('option','',status);o.value=status;o.selected=item.status===status;select.append(o);}
      select.addEventListener('change',async () => {
        const old=item.status;select.disabled=true;
        try { await request('/commercial/api/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,status:select.value})});item.status=select.value; }
        catch(e){select.value=old;$('tableError').textContent=e.message;}
        finally{select.disabled=false;}
      });
      statusTd.append(select);tr.append(statusTd);
      const td=el('td');const view=el('button','view-btn','Details ↗');view.type='button';view.addEventListener('click',()=>detail(item));td.append(view);tr.append(td);tb.append(tr);
    }
  }
  function detail(item) {
    $('detailTitle').textContent = `CP-${String(item.id).padStart(5,'0')} · ${item.property_type}`;
    const fieldValues = [
      ['Registered',new Date(item.submitted_at).toLocaleString('en-LK')],['Status',item.status],
      ['Full name',item.full_name],['Contact',item.phone],['WhatsApp',item.whatsapp||'—'],['Email',item.email],
      ['Property type',item.property_type],['Address',item.address],['City / town',item.city],['District',item.district],
      ['Property size',item.property_size?`${item.property_size} ${item.size_unit}`:'—'],
      ['Coordinates',`${item.latitude}, ${item.longitude}`],['Additional information',item.description||'—'],
      ['Email notification',item.notification_sent?'Sent':'Not sent / not configured']
    ];
    const list=$('detailList');list.replaceChildren();
    for (const [k,v] of fieldValues) list.append(el('dt','',k),el('dd','',v));
    $('detailMap').href=item.maps_url;
    $('detailDialog').showModal();
  }
  function exportCsv() {
    if (!rows.length) return;
    const columns=[['id','Reference'],['submitted_at','Submitted At'],['full_name','Name'],['phone','Phone'],['whatsapp','WhatsApp'],['email','Email'],['property_type','Type'],['address','Address'],['city','City'],['district','District'],['property_size','Size'],['size_unit','Unit'],['latitude','Latitude'],['longitude','Longitude'],['maps_url','Google Maps Link'],['status','Status'],['notification_sent','Email Sent'],['description','Notes']];
    const csvCell=value=>{
      let s=String(value??'');
      // Prevent spreadsheet formula injection from user-supplied fields.
      if (/^[\s]*[=+\-@\t\r]/.test(s)) s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const lines=[columns.map(x=>csvCell(x[1])).join(','),...rows.map(r=>columns.map(([k])=>csvCell(k==='id'?`CP-${String(r.id).padStart(5,'0')}`:r[k])).join(','))];
    const blob = new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=`celeste-properties-page-${page}.csv`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
  }
  $('loginForm').addEventListener('submit',async(e)=>{
    e.preventDefault();$('loginError').textContent='';
    try{await request('/commercial/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});$('adminPassword').value='';await load();}
    catch(error){$('loginError').textContent=error.message;}
  });
  $('logoutBtn').addEventListener('click',async()=>{try{await request('/commercial/api/logout',{method:'POST'});}catch{}showLogin();});
  $('refreshBtn').addEventListener('click',()=>load());
  $('exportBtn').addEventListener('click',exportCsv);
  $('prevBtn').addEventListener('click',()=>{if(page>1){page--;load();}});
  $('nextBtn').addEventListener('click',()=>{if(page*limit<total){page++;load();}});
  $('statusFilter').addEventListener('change',()=>{page=1;load();});
  $('typeFilter').addEventListener('change',()=>{page=1;load();});
  $('searchInput').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{page=1;load();},320);});
  $('closeDialog').addEventListener('click',()=>$('detailDialog').close());
  $('closeDialogBottom').addEventListener('click',()=>$('detailDialog').close());
  $('detailDialog').addEventListener('click',(e)=>{if(e.target===$('detailDialog'))$('detailDialog').close();});
  load();
})();
