const roleLabels={OWNER:'Lãnh đạo',MANAGER:'Quản lý',STAFF:'Nhân viên',RECEPTION:'Lễ tân / Thu ngân',PENDING:'Chờ duyệt'};
const statusLabels={PENDING:'Chờ duyệt',ACTIVE:'Đã duyệt',SUSPENDED:'Tạm khóa'};
const canSeeRevenue = r => ['OWNER','MANAGER'].includes(r);
const canManageStaff = r => ['OWNER','MANAGER'].includes(r);
const canSeeAllCommission = r => ['OWNER','MANAGER'].includes(r);
const canExport = r => r==='OWNER';

const seed={
 accounts:[
  {id:1,username:'admin',password:'123456',name:'Vinh',phone:'',role:'OWNER',status:'ACTIVE'},
  {id:2,username:'manager',password:'123456',name:'Trường',phone:'',role:'MANAGER',status:'ACTIVE'},
  {id:3,username:'stylist1',password:'123456',name:'Stylist An',phone:'',role:'STAFF',status:'ACTIVE'},
  {id:4,username:'reception',password:'123456',name:'Lễ tân Mai',phone:'',role:'RECEPTION',status:'ACTIVE'},
  {id:5,username:'newstaff',password:'123456',name:'Nguyễn Minh Demo',phone:'0911222333',role:null,status:'PENDING'}
 ],
 customers:[
  {id:'KH0001',name:'Nguyễn Thu Hà',phone:'0912345678',source:'Instagram',stylist:'Trường',last:'2026-09-28',visits:6,spend:12850000,tier:'VIP',note:'Thích màu lạnh, không quá sáng'},
  {id:'KH0002',name:'Trần Minh Anh',phone:'0988112233',source:'Giới thiệu',stylist:'Stylist An',last:'2026-10-01',visits:3,spend:4250000,tier:'Member',note:'Tóc yếu phần đuôi'},
  {id:'KH0003',name:'Lê Hoàng Nam',phone:'0909887766',source:'Google Maps',stylist:'Trường',last:'2026-09-15',visits:4,spend:3100000,tier:'Member',note:'Cắt nam 4 tuần/lần'}
 ],
 bookings:[
  {id:1,date:'2026-10-03',time:'09:00',customer:'Nguyễn Thu Hà',service:'Nhuộm + cắt',stylist:'Trường',status:'Đã đến',price:2500000},
  {id:2,date:'2026-10-03',time:'10:00',customer:'Trần Minh Anh',service:'Treatment',stylist:'Stylist An',status:'Đã xác nhận',price:650000},
  {id:3,date:'2026-10-03',time:'14:00',customer:'Lê Hoàng Nam',service:'Cắt nam',stylist:'Trường',status:'Đã xác nhận',price:575000}
 ],
 staff:[
  {id:1,name:'Trường',role:'MANAGER',username:'manager',commission:27,status:'Đang làm'},
  {id:2,name:'Stylist An',role:'STAFF',username:'stylist1',commission:20,status:'Đang làm'},
  {id:3,name:'Kỹ thuật viên Bình',role:'STAFF',username:'stylist2',commission:12,status:'Đang làm'},
  {id:4,name:'Lễ tân Mai',role:'RECEPTION',username:'reception',commission:0,status:'Đang làm'},
  {id:5,name:'Phụ tóc Lan',role:'STAFF',username:'assistant1',commission:8,status:'Đang làm'}
 ],
 commissions:[
  {staff:'Trường',service:9800000,product:1100000,bonus:1000000,adjustment:0},
  {staff:'Stylist An',service:5250000,product:650000,bonus:500000,adjustment:-100000},
  {staff:'Kỹ thuật viên Bình',service:2850000,product:0,bonus:300000,adjustment:0},
  {staff:'Phụ tóc Lan',service:1700000,product:0,bonus:150000,adjustment:0}
 ],
 hair:[
  {customer:'Nguyễn Thu Hà',date:'2026-09-28',stylist:'Trường',service:'Nhuộm + cắt',formula:'7.1 + 8.13, oxy 6%',condition:'Tóc khô nhẹ phần đuôi',note:'Lần sau ưu tiên màu lạnh'},
  {customer:'Trần Minh Anh',date:'2026-10-01',stylist:'Stylist An',service:'Treatment',formula:'Keratin phục hồi',condition:'Tóc yếu sau tẩy',note:'Hẹn lại sau 25-30 ngày'}
 ]
};

const state={user:null,page:'dashboard',data:JSON.parse(localStorage.getItem('salonCRMData')||'null')||seed};
function save(){localStorage.setItem('salonCRMData',JSON.stringify(state.data));}
function money(v){return new Intl.NumberFormat('vi-VN').format(v)+'đ';}
function el(id){return document.getElementById(id)}

const navByRole={
 OWNER:['dashboard','customers','bookings','hair','staff','commission','reports'],
 MANAGER:['dashboard','customers','bookings','hair','staff','commission','reports'],
 STAFF:['customers','bookings','hair','commission'],
 RECEPTION:['customers','bookings','hair']
};
const navMeta={dashboard:['Tổng quan','Dashboard'],customers:['Khách hàng','Khách hàng'],bookings:['Lịch hẹn','Lịch hẹn'],hair:['Hồ sơ tóc','Hồ sơ tóc'],staff:['Nhân viên','Nhân viên'],commission:['Hoa hồng','Hoa hồng'],reports:['Báo cáo','Báo cáo']};

function login(){
 const u=state.data.accounts.find(x=>x.username===el('loginUser').value.trim()&&x.password===el('loginPass').value);
 const msg=el('authMessage'); msg.textContent='';
 if(!u){msg.textContent='Sai tài khoản hoặc mật khẩu.';return;}
 if(u.status==='PENDING'){msg.textContent='Tài khoản đang Chờ duyệt. Quản lý cần gán vai trò trước khi bạn có thể sử dụng CRM.';return;}
 if(u.status!=='ACTIVE'){msg.textContent='Tài khoản đang bị tạm khóa. Vui lòng liên hệ quản lý.';return;}
 state.user=u; state.page=navByRole[u.role][0];
 el('loginView').classList.add('hidden'); el('appView').classList.remove('hidden');
 renderNav(); render();
}
function logout(){state.user=null; el('appView').classList.add('hidden');el('loginView').classList.remove('hidden');}

function renderNav(){
 el('nav').innerHTML=navByRole[state.user.role].map(p=>`<button class="nav-btn ${state.page===p?'active':''}" data-page="${p}">${navMeta[p][0]}</button>`).join('');
 document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;renderNav();render();});
 el('currentUserBox').innerHTML=`<div class="user-mini"><strong>${state.user.name}</strong><span>${roleLabels[state.user.role]}</span></div>`;
}
function setHeader(title,sub){el('pageTitle').textContent=title;el('pageSubtitle').textContent=sub;}
function render(){
 const allowed=navByRole[state.user.role]; if(!allowed.includes(state.page))state.page=allowed[0];
 ({dashboard:renderDashboard,customers:renderCustomers,bookings:renderBookings,hair:renderHair,staff:renderStaff,commission:renderCommission,reports:renderReports}[state.page])();
}

function renderDashboard(){
 if(!canSeeRevenue(state.user.role)){state.page='customers';renderNav();render();return;}
 setHeader('Dashboard','Tổng quan vận hành Salon Trường');
 const revenue=18600000, todayCustomers=14, newCustomers=4, returnRate=71;
 el('content').innerHTML=`
 <div class="grid cards">
  <div class="card metric"><span>Doanh thu hôm nay</span><strong>${money(revenue)}</strong><small>+8,4% so với hôm qua</small></div>
  <div class="card metric"><span>Khách đã đến</span><strong>${todayCustomers}</strong><small>4 khách mới</small></div>
  <div class="card metric"><span>Bill trung bình</span><strong>${money(Math.round(revenue/todayCustomers))}</strong><small>Theo khách đã thanh toán</small></div>
  <div class="card metric"><span>Tỷ lệ khách quay lại</span><strong>${returnRate}%</strong><small>Mục tiêu ≥ 70%</small></div>
 </div>
 <div class="split">
  <div>
   <div class="section-title"><h3>Lịch hôm nay</h3><span>03/10/2026</span></div>
   <div class="table-wrap"><table><thead><tr><th>Giờ</th><th>Khách</th><th>Dịch vụ</th><th>Stylist</th><th>Trạng thái</th></tr></thead><tbody>${state.data.bookings.map(b=>`<tr><td>${b.time}</td><td>${b.customer}</td><td>${b.service}</td><td>${b.stylist}</td><td><span class="badge ${b.status==='Đã đến'?'success':'warning'}">${b.status}</span></td></tr>`).join('')}</tbody></table></div>
  </div>
  <div>
   <div class="section-title"><h3>Hiệu suất stylist</h3><span>Tháng 10</span></div>
   <div class="card list">
    ${[{n:'Trường',v:82},{n:'Stylist An',v:68},{n:'Kỹ thuật viên Bình',v:55}].map(x=>`<div class="list-item"><div><strong>${x.n}</strong><span>Mức lấp đầy lịch</span><div class="kpi-bar"><i style="width:${x.v}%"></i></div></div><strong>${x.v}%</strong></div>`).join('')}
   </div>
  </div>
 </div>
 <div class="section-title"><h3>Khách cần chăm sóc lại</h3><span>32 khách</span></div>
 <div class="table-wrap"><table><thead><tr><th>Khách</th><th>Lần gần nhất</th><th>Dịch vụ</th><th>Stylist</th><th>Gợi ý</th></tr></thead><tbody>
  <tr><td>Nguyễn Thu Hà</td><td>28/09</td><td>Nhuộm + cắt</td><td>Trường</td><td>Nhắc kiểm tra màu sau 30 ngày</td></tr>
  <tr><td>Lê Hoàng Nam</td><td>15/09</td><td>Cắt nam</td><td>Trường</td><td>Nhắc đặt lịch tuần tới</td></tr>
 </tbody></table></div>`;
}

function renderCustomers(){
 setHeader('Khách hàng','Danh sách và lịch sử khách của salon');
 el('content').innerHTML=`<div class="filters"><input id="customerSearch" placeholder="Tìm tên hoặc SĐT"><select id="tierFilter"><option value="">Tất cả hạng</option><option>VIP</option><option>Member</option></select><button id="addCustomer" class="primary">+ Thêm khách</button>${canExport(state.user.role)?'<button class="secondary">Xuất Excel</button>':''}</div><div id="customerTable"></div>`;
 const draw=()=>{
  const q=el('customerSearch').value.toLowerCase(),t=el('tierFilter').value;
  const rows=state.data.customers.filter(c=>(!q||c.name.toLowerCase().includes(q)||c.phone.includes(q))&&(!t||c.tier===t));
  el('customerTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Mã</th><th>Khách</th><th>SĐT</th><th>Nguồn</th><th>Stylist</th><th>Lần cuối</th><th>Hạng</th>${canSeeRevenue(state.user.role)?'<th>Tổng chi tiêu</th>':''}</tr></thead><tbody>${rows.map(c=>`<tr><td>${c.id}</td><td><strong>${c.name}</strong><br><span style="color:#7b776f">${c.note||''}</span></td><td>${c.phone}</td><td>${c.source}</td><td>${c.stylist}</td><td>${c.last}</td><td><span class="badge">${c.tier}</span></td>${canSeeRevenue(state.user.role)?`<td>${money(c.spend)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
 };
 draw(); el('customerSearch').oninput=draw; el('tierFilter').onchange=draw; el('addCustomer').onclick=openCustomerModal;
}

function renderBookings(){
 setHeader('Lịch hẹn','Theo dõi booking và tránh trùng lịch stylist');
 const staffCols=['Trường','Stylist An','Kỹ thuật viên Bình']; const times=['09:00','10:00','11:00','14:00','15:00'];
 let cells=`<div class="cal-cell cal-head">Giờ</div>${staffCols.map(s=>`<div class="cal-cell cal-head">${s}</div>`).join('')}`;
 times.forEach(t=>{cells+=`<div class="cal-cell cal-head">${t}</div>`; staffCols.forEach(s=>{const b=state.data.bookings.find(x=>x.time===t&&x.stylist===s);cells+=`<div class="cal-cell">${b?`<div class="booking-chip"><strong>${b.customer}</strong><span>${b.service}</span></div>`:''}</div>`;});});
 el('content').innerHTML=`<div class="filters"><button id="addBooking" class="primary">+ Thêm lịch hẹn</button><select><option>03/10/2026</option></select></div><div class="calendar">${cells}</div>`;
 el('addBooking').onclick=openBookingModal;
}

function renderHair(){
 setHeader('Hồ sơ tóc','Lưu lịch sử, công thức và ghi chú kỹ thuật');
 el('content').innerHTML=`<div class="filters"><button id="addHair" class="primary">+ Thêm hồ sơ tóc</button></div><div class="table-wrap"><table><thead><tr><th>Khách</th><th>Ngày</th><th>Stylist</th><th>Dịch vụ</th><th>Công thức</th><th>Tình trạng tóc</th><th>Ghi chú</th></tr></thead><tbody>${state.data.hair.map(h=>`<tr><td>${h.customer}</td><td>${h.date}</td><td>${h.stylist}</td><td>${h.service}</td><td>${h.formula}</td><td>${h.condition}</td><td>${h.note}</td></tr>`).join('')}</tbody></table></div>`;
 el('addHair').onclick=openHairModal;
}

function renderStaff(){
 if(!canManageStaff(state.user.role)){state.page='customers';renderNav();render();return;}
 setHeader('Nhân viên','Duyệt tài khoản, gán vai trò và quản lý quyền truy cập');
 const pending=state.data.accounts.filter(a=>a.status==='PENDING');
 const activeAccounts=state.data.accounts.filter(a=>a.status==='ACTIVE'&&a.role!=='OWNER');
 el('content').innerHTML=`
 <div class="notice"><strong>Nguyên tắc bảo mật:</strong> tài khoản đăng ký mới không được vào CRM ngay. Mặc định là <b>Chờ duyệt</b>. Quản lý chỉ duyệt Nhân viên/Lễ tân; chỉ Lãnh đạo được cấp vai trò Quản lý.</div>
 <div class="section-title"><h3>Chờ duyệt</h3><span>${pending.length} tài khoản</span></div>
 ${pending.length?`<div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>SĐT</th><th>Tài khoản</th><th>Trạng thái</th><th>Gán vai trò</th><th></th></tr></thead><tbody>${pending.map(a=>`<tr><td>${a.name}</td><td>${a.phone||'-'}</td><td>${a.username}</td><td><span class="badge warning">Chờ duyệt</span></td><td><select id="approveRole_${a.id}">${state.user.role==='OWNER'?'<option value="STAFF">Nhân viên</option><option value="RECEPTION">Lễ tân / Thu ngân</option><option value="MANAGER">Quản lý</option>':'<option value="STAFF">Nhân viên</option><option value="RECEPTION">Lễ tân / Thu ngân</option>'}</select></td><td><button class="primary approve-account" data-id="${a.id}">Duyệt</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-card">Không có tài khoản nào đang chờ duyệt.</div>'}
 <div class="section-title"><h3>Nhân sự đang hoạt động</h3><button id="addStaff" class="primary">+ Tạo tài khoản nội bộ</button></div>
 <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Vai trò</th><th>Tài khoản</th><th>Trạng thái</th></tr></thead><tbody>${activeAccounts.map(a=>`<tr><td>${a.name}</td><td>${roleLabels[a.role]}</td><td>${a.username}</td><td><span class="badge success">Đã duyệt</span></td></tr>`).join('')}</tbody></table></div>`;
 document.querySelectorAll('.approve-account').forEach(btn=>btn.onclick=()=>approveAccount(+btn.dataset.id));
 el('addStaff').onclick=openStaffModal;
}

function approveAccount(id){
 const a=state.data.accounts.find(x=>x.id===id); if(!a)return;
 const role=el('approveRole_'+id).value;
 if(state.user.role!=='OWNER'&&role==='MANAGER')return alert('Chỉ Lãnh đạo được cấp quyền Quản lý.');
 a.role=role; a.status='ACTIVE';
 if(!state.data.staff.some(s=>s.username===a.username)) state.data.staff.push({id:Date.now(),name:a.name,role,username:a.username,commission:0,status:'Đang làm'});
 save(); renderStaff();
}

function commissionTotal(c){return c.service+c.product+c.bonus+c.adjustment}
function renderCommission(){
 setHeader('Hoa hồng',canSeeAllCommission(state.user.role)?'Theo dõi hoa hồng toàn đội':'Chỉ hiển thị hoa hồng của bạn');
 let data=state.data.commissions;
 if(!canSeeAllCommission(state.user.role)) data=data.filter(c=>c.staff===state.user.name);
 el('content').innerHTML=`<div class="grid cards">${data.map(c=>`<div class="card metric"><span>${c.staff}</span><strong>${money(commissionTotal(c))}</strong><small>Tạm tính tháng 10/2026</small></div>`).join('')}</div><div class="section-title"><h3>Chi tiết</h3><span>${canSeeAllCommission(state.user.role)?'Lãnh đạo / Quản lý':'Cá nhân'}</span></div><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>HH dịch vụ</th><th>HH sản phẩm</th><th>Thưởng KPI</th><th>Điều chỉnh</th><th>Tổng</th></tr></thead><tbody>${data.map(c=>`<tr><td>${c.staff}</td><td>${money(c.service)}</td><td>${money(c.product)}</td><td>${money(c.bonus)}</td><td>${money(c.adjustment)}</td><td><strong>${money(commissionTotal(c))}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

function renderReports(){
 if(!canSeeRevenue(state.user.role)){state.page='customers';renderNav();render();return;}
 setHeader('Báo cáo','Chỉ Lãnh đạo và Quản lý được xem doanh số');
 el('content').innerHTML=`<div class="grid cards"><div class="card metric"><span>Doanh thu tháng</span><strong>${money(238500000)}</strong><small>Mục tiêu 300 triệu</small></div><div class="card metric"><span>Khách mới</span><strong>86</strong><small>36% tổng khách</small></div><div class="card metric"><span>Khách quay lại</span><strong>69%</strong><small>Mục tiêu ≥ 70%</small></div><div class="card metric"><span>Doanh thu / khách</span><strong>${money(1325000)}</strong><small>Bill trung bình</small></div></div><div class="section-title"><h3>Doanh thu theo nguồn khách</h3></div><div class="table-wrap"><table><thead><tr><th>Nguồn</th><th>Khách mới</th><th>Doanh thu</th><th>Tỷ trọng</th></tr></thead><tbody><tr><td>Instagram</td><td>31</td><td>${money(52000000)}</td><td>22%</td></tr><tr><td>TikTok</td><td>25</td><td>${money(41000000)}</td><td>17%</td></tr><tr><td>Giới thiệu</td><td>18</td><td>${money(46000000)}</td><td>19%</td></tr><tr><td>Google Maps</td><td>12</td><td>${money(23000000)}</td><td>10%</td></tr></tbody></table></div>`;
}

function openModal(title,html){el('modalTitle').textContent=title;el('modalBody').innerHTML=`<div class="modal-body">${html}</div>`;el('modal').classList.remove('hidden');}
function closeModal(){el('modal').classList.add('hidden');}
function openCustomerModal(){
 openModal('Thêm khách hàng',`<div class="form-grid"><div><label>Họ tên</label><input id="cName"></div><div><label>Số điện thoại</label><input id="cPhone"></div><div><label>Nguồn khách</label><select id="cSource"><option>Instagram</option><option>TikTok</option><option>Facebook</option><option>Google Maps</option><option>Giới thiệu</option><option>Đi ngang</option></select></div><div><label>Stylist phụ trách</label><select id="cStylist"><option>Trường</option><option>Stylist An</option><option>Kỹ thuật viên Bình</option></select></div><div class="full"><label>Ghi chú</label><textarea id="cNote"></textarea></div></div><div class="form-actions"><button class="secondary" onclick="closeModal()">Hủy</button><button class="primary" id="saveCustomer">Lưu khách</button></div>`);
 setTimeout(()=>el('saveCustomer').onclick=()=>{if(!el('cName').value||!el('cPhone').value)return alert('Nhập họ tên và SĐT');const id='KH'+String(state.data.customers.length+1).padStart(4,'0');state.data.customers.push({id,name:el('cName').value,phone:el('cPhone').value,source:el('cSource').value,stylist:el('cStylist').value,last:'-',visits:0,spend:0,tier:'Member',note:el('cNote').value});save();closeModal();render();},0);
}
function openBookingModal(){
 const opts=state.data.customers.map(c=>`<option>${c.name}</option>`).join('');
 openModal('Thêm lịch hẹn',`<div class="form-grid"><div><label>Khách hàng</label><select id="bCustomer">${opts}</select></div><div><label>Dịch vụ</label><input id="bService" placeholder="Cắt / nhuộm / treatment"></div><div><label>Ngày</label><input id="bDate" type="date" value="2026-10-03"></div><div><label>Giờ</label><input id="bTime" type="time"></div><div><label>Stylist</label><select id="bStylist"><option>Trường</option><option>Stylist An</option><option>Kỹ thuật viên Bình</option></select></div><div><label>Giá dự kiến</label><input id="bPrice" type="number"></div></div><div class="form-actions"><button class="secondary" onclick="closeModal()">Hủy</button><button class="primary" id="saveBooking">Lưu lịch</button></div>`);
 setTimeout(()=>el('saveBooking').onclick=()=>{const conflict=state.data.bookings.some(b=>b.date===el('bDate').value&&b.time===el('bTime').value&&b.stylist===el('bStylist').value);if(conflict)return alert('Stylist đã có lịch ở khung giờ này');state.data.bookings.push({id:Date.now(),date:el('bDate').value,time:el('bTime').value,customer:el('bCustomer').value,service:el('bService').value,stylist:el('bStylist').value,status:'Đã xác nhận',price:+el('bPrice').value||0});save();closeModal();render();},0);
}
function openHairModal(){
 const opts=state.data.customers.map(c=>`<option>${c.name}</option>`).join('');
 openModal('Thêm hồ sơ tóc',`<div class="form-grid"><div><label>Khách</label><select id="hCustomer">${opts}</select></div><div><label>Ngày</label><input id="hDate" type="date" value="2026-10-03"></div><div><label>Stylist</label><select id="hStylist"><option>Trường</option><option>Stylist An</option><option>Kỹ thuật viên Bình</option></select></div><div><label>Dịch vụ</label><input id="hService"></div><div class="full"><label>Công thức</label><textarea id="hFormula"></textarea></div><div><label>Tình trạng tóc</label><input id="hCondition"></div><div><label>Ghi chú lần sau</label><input id="hNote"></div></div><div class="form-actions"><button class="secondary" onclick="closeModal()">Hủy</button><button class="primary" id="saveHair">Lưu hồ sơ</button></div>`);
 setTimeout(()=>el('saveHair').onclick=()=>{state.data.hair.unshift({customer:el('hCustomer').value,date:el('hDate').value,stylist:el('hStylist').value,service:el('hService').value,formula:el('hFormula').value,condition:el('hCondition').value,note:el('hNote').value});save();closeModal();render();},0);
}
function openStaffModal(){
 const roles=state.user.role==='OWNER'?'<option value="MANAGER">Quản lý</option><option value="STAFF">Nhân viên</option><option value="RECEPTION">Lễ tân / Thu ngân</option>':'<option value="STAFF">Nhân viên</option><option value="RECEPTION">Lễ tân / Thu ngân</option>';
 openModal('Tạo tài khoản nội bộ',`<div class="form-grid"><div><label>Họ tên</label><input id="sName"></div><div><label>Vai trò</label><select id="sRole">${roles}</select></div><div><label>Tài khoản</label><input id="sUsername"></div><div><label>Mật khẩu tạm</label><input id="sPassword" type="password" value="123456"></div><div><label>% hoa hồng</label><input id="sCommission" type="number" value="0"></div></div><div class="form-actions"><button class="secondary" onclick="closeModal()">Hủy</button><button class="primary" id="saveStaff">Tạo tài khoản</button></div>`);
 setTimeout(()=>el('saveStaff').onclick=()=>{if(!el('sName').value||!el('sUsername').value)return alert('Nhập tên và tài khoản');if(state.data.accounts.some(a=>a.username===el('sUsername').value.trim()))return alert('Tài khoản đã tồn tại');const role=el('sRole').value;if(state.user.role!=='OWNER'&&role==='MANAGER')return alert('Chỉ Lãnh đạo được tạo Quản lý');const account={id:Date.now(),name:el('sName').value,username:el('sUsername').value.trim(),password:el('sPassword').value||'123456',phone:'',role,status:'ACTIVE'};state.data.accounts.push(account);state.data.staff.push({id:Date.now()+1,name:account.name,role,username:account.username,commission:+el('sCommission').value||0,status:'Đang làm'});save();closeModal();render();},0);
}

function openRegisterModal(){
 openModal('Đăng ký tài khoản nhân viên',`<div class="notice">Tài khoản mới sẽ ở trạng thái <strong>Chờ duyệt</strong>. Bạn chưa thể xem dữ liệu salon cho đến khi Quản lý/Lãnh đạo gán vai trò.</div><div class="form-grid"><div><label>Họ tên</label><input id="rName"></div><div><label>Số điện thoại</label><input id="rPhone"></div><div><label>Tài khoản</label><input id="rUsername"></div><div><label>Mật khẩu</label><input id="rPassword" type="password"></div></div><div class="form-actions"><button class="secondary" onclick="closeModal()">Hủy</button><button class="primary" id="saveRegister">Gửi đăng ký</button></div>`);
 setTimeout(()=>el('saveRegister').onclick=()=>{const name=el('rName').value.trim(),username=el('rUsername').value.trim(),password=el('rPassword').value;if(!name||!username||!password)return alert('Nhập đủ họ tên, tài khoản và mật khẩu');if(state.data.accounts.some(a=>a.username===username))return alert('Tài khoản đã tồn tại');state.data.accounts.push({id:Date.now(),name,phone:el('rPhone').value.trim(),username,password,role:null,status:'PENDING'});save();closeModal();el('authMessage').textContent='Đã gửi đăng ký. Tài khoản đang Chờ duyệt và chưa thể truy cập dữ liệu salon.';},0);
}

el('loginBtn').onclick=login; el('registerBtn').onclick=openRegisterModal; el('logoutBtn').onclick=logout; el('closeModal').onclick=closeModal; el('modal').onclick=e=>{if(e.target===el('modal'))closeModal();};
el('quickCustomerBtn').onclick=()=>{state.page='customers';renderNav();render();setTimeout(()=>openCustomerModal(),50)};
el('quickBookingBtn').onclick=()=>{state.page='bookings';renderNav();render();setTimeout(()=>openBookingModal(),50)};
