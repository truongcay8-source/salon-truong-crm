'use strict';
// Sổ đặt lịch (tab "Tháng 11"…): mỗi dòng giờ có cột "Thu tiền" + "Tiền Tip" cho cả dòng.
// Tách tiền từng ô (thợ) → lượt làm. Khách trả dư so với giá dịch vụ → cộng vào TIP CHUNG.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Số tiền ghi tay: "685k", "1250", "(180)", "1tr", "1tr086k", "1tr235" → đồng
function amounts(text) {
  const phones = (fold(text).match(/(?:\+?84|0)[\d.\s]{8,12}\d/g) || []).map((p) => p.replace(/\D/g, ''));
  let s = fold(text)
    .replace(/(?:\+?84|0)[\d.\s]{8,12}\d/g, ' ') // SĐT
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, ' ') // giờ
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ').replace(/\b(nap|nap the|tra truoc)\b.*$/, ' ').replace(/\b(voucher|vocher|voch|vc|the|phieu)\s*\d+(?:[.,]\d+)?\s*(tr|trieu|k)?\w*/g, ' ')
    .replace(/\b(lv|level|kh|cm|ml|g|so)\s*\d+/g, ' ').replace(/\d+\s*(cm|ml|phut|%|lan|buoi|nam)\b/g, ' ');
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(tr|trieu|m)\s*(\d{1,3})?\s*k?|(\d{2,4}(?:[.,]\d{3})*)\s*(k|nghin|ngan|d|đ)?/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) { out.push({ v: Math.round(Number(m[1].replace(',', '.')) * 1e6 + (m[3] ? Number(m[3].padEnd(3, '0')) * 1000 : 0)), at: m.index }); continue; }
    const raw = m[4].replace(/[.,]/g, '');
    if (raw.length >= 3 && !m[5] && phones.some((p) => p.endsWith(raw))) continue; // đuôi SĐT ghi kèm tên khách
    let n = Number(raw);
    if (raw.length >= 6) { /* đã là đồng */ } else if (n >= 30 && n <= 9999) n *= 1000; else continue;
    out.push({ v: n, at: m.index, end: m.index + m[0].length });
  }
  return { list: out, s };
}

// Từ khóa → dịch vụ chuẩn (bảng giá 15/11/2026). size M khi không ghi độ dài.
const KW = [
  [/phu thu/, null],
  [/goi den/, 'Gội đen thảo dược phủ bạc (nam)'],
  [/cham chan/, 'Chấm chân'],
  [/ep side/, 'Ép side nam (500–700)'],
  [/highlight/, 'Half highlight – M (ngang vai)'],
  [/gloss/, 'Glossing (tráng màu) – M (ngang vai)'],
  [/cao rau/, 'Cạo râu'],
  [/balayage/, 'Balayage – M (ngang vai)'],
  [/tay\b(?! da chet)/, 'Tẩy tóc (gồm dưỡng Olaplex) – M (ngang vai)', 'Tẩy nam (600–800)'],
  [/nhuom/, 'Nhuộm tóc – M (ngang vai)', 'Nhuộm nam (700–1.000)'],
  [/\b(uon|duoi)\b/, 'Uốn / Duỗi – M (ngang vai)', 'Uốn – Duỗi nam (800–1.200)'],
  [/phuc hoi|hap/, 'Chữa trị 3 bước Milbon Grand Linkage – trên vai'],
  [/u lanh/, 'Ủ lạnh'],
  [/tay da chet/, 'Rửa mặt tẩy da chết'],
  [/rua mat|\brm\b/, 'Rửa mặt'],
  [/massage|masage|matxa/, 'Massage đầu'],
  [/\bgoi\b/, 'Gội'],
  [/\btk\b|tao kieu/, null, null, 'tk'],
  [/\bct mai\b|cat mai/, null, null, 'mai'],
  [/\bcat\b|\bct\b/, null, null, 'cat'],
];
const MALE = /^(a|anh|chu|ong|bo|b|cau)\b/, FEMALE = /^(c|chi|co|ba|me|ch)\b/;

const PRODUCT = /cream|fiber|\bsap\b|\bgom\b|wax|clay|pomade|tong do|\bxit\b|dau goi|dau xa|sampoo|shampoo|serum|tinh dau|\bkem\b|san pham|\bsp\b|\d\s*gr\b/;
function guessGender(text, svcByName, level, amt) {
  const f = fold(text).trim();
  if (MALE.test(f) || /\bnam\b/.test(f)) return 'nam';
  if (FEMALE.test(f) || /\bnu\b/.test(f)) return 'nữ';
  if (level && amt) { // gần giá cắt nam hay nữ của cấp thợ hơn
    const pm = (svcByName(`Cắt tóc nam – ${level}`) || {}).price || 0, pf = (svcByName(`Cắt tóc nữ – ${level}`) || {}).price || 0;
    if (pm && pf) return Math.abs(amt - pf) < Math.abs(amt - pm) ? 'nữ' : 'nam';
  }
  return 'nam';
}

// → { items:[{service_id,name,price,fixed}], explicit, surcharge }
function parseEntry(text, staff, svcByName, services, hint) {
  const { list, s } = amounts(text);
  // phụ thu ghi kèm: "+ 200 phụ thu"
  let surcharge = 0;
  const ps = s.indexOf('phu thu');
  const nums = list.filter((a) => {
    if (ps >= 0 && a.at < ps && ps - (a.end || a.at) < 6) { surcharge += a.v; return false; }
    return true;
  });
  const items = [];
  // Ô do app/chat tạo sẵn: "… – Cắt tóc nam – Director"
  const ff = fold(text);
  const named = !/–/.test(text) ? [] : services.filter((x) => x.active && x.name.length > 3 && ff.includes(fold(x.name))).sort((a, b) => b.name.length - a.name.length);
  const used = new Set();
  for (const x of named) { if ([...used].some((u) => fold(u).includes(fold(x.name)))) continue; used.add(x.name); items.push({ service_id: x.id, name: x.name, price: x.price, fixed: !/–\s*\d|\(\d/.test(x.name) && !/[SMLX]{1,2} \(/.test(x.name) }); }
  if (!items.length) {
    const male = guessGender(text, svcByName, staff && staff.level, nums.reduce((t, a) => t + a.v, 0) || hint || 0) === 'nam';
    for (const [re, svc, svcMale, kind] of KW) {
      if (!re.test(s)) continue;
      if (re.source === 'phu thu') continue;
      let name = male && svcMale ? svcMale : svc;
      if (kind === 'tk') name = male ? 'Tạo kiểu nam (50/70/100)' : 'Tạo kiểu bằng máy/lược (100/120/150)';
      if (kind === 'mai') { if (!staff || !staff.level) continue; name = `Cắt mái – ${staff.level}`; }
      if (kind === 'cat') { if (!staff || !staff.level || items.some((i) => /^Cắt/.test(i.name))) continue; name = `Cắt tóc ${male ? 'nam' : 'nữ'} – ${staff.level}`; }
      if (re.source.includes('tay da chet')) { const i = items.findIndex((x) => /^Tẩy/.test(x.name)); if (i >= 0) items.splice(i, 1); }
      const sv = svcByName(name);
      if (sv && !items.some((i) => i.service_id === sv.id)) items.push({ service_id: sv.id, name: sv.name, price: sv.price, fixed: !/[–(]\s*\d|\d\)|– [SMLX]{1,2} \(/.test(sv.name), at: s.search(re) });
    }
    // Chỉ ghi bán sản phẩm (sáp, dầu gội…)
    if (!items.length && PRODUCT.test(s)) { const sv = svcByName('Bán sản phẩm'); items.push({ service_id: sv ? sv.id : null, name: 'Sản phẩm: ' + String(text).replace(/\([^)]*\)/g, '').slice(0, 50).trim(), price: sv ? sv.price : 0, fixed: false, grp: 'Bán sản phẩm' }); }
    // Không ghi dịch vụ: thợ cắt → cắt theo cấp; thợ phụ (không có cấp) → gội
    if (!items.length) {
      const name = staff && staff.level ? `Cắt tóc ${male ? 'nam' : 'nữ'} – ${staff.level}` : 'Gội';
      const sv = svcByName(name);
      if (sv) items.push({ service_id: sv.id, name: sv.name, price: sv.price, fixed: true });
    }
  }
  // Ghép số tiền ghi ngay sau từ khóa ("gội 100+ủ lạnh 160+tk 100")
  // "…=3270": số sau dấu = là tổng của ô
  const eq = s.match(/=\s*(\d[\d.,]*)\s*(k|tr)?/);
  const pairNums = eq ? nums.filter((a) => a.at < eq.index) : nums;
  if (items.length > 1 && pairNums.length === items.length) {
    const byPos = [...items].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    byPos.forEach((it, i) => { it.price = pairNums[i].v; it.fixed = true; });
  }
  // Trừ thẻ tri ân / voucher: "sử dụng voucher 1tr", "trừ voucher 1000", "dung vocher 1trieu"
  const vm = fold(text).match(/(tru|su dung|dung|sd)\s*(the tri an|the|voucher|vocher|voch|vc)\s*(\d+(?:[.,]\d+)?)?\s*(tr|trieu|k)?/);
  let voucher = 0;
  if (vm) { const n = vm[3] ? Number(vm[3].replace(',', '.')) : 0; voucher = !n ? 1000000 : vm[4] === 'k' ? n * 1000 : vm[4] ? n * 1e6 : n >= 30 ? n * 1000 : n * 1e6; }
  let explicit = nums.reduce((t, a) => t + a.v, 0);
  if (eq) { const tot = nums.find((a) => a.at >= eq.index); if (tot) explicit = tot.v; }
  return { items, explicit, surcharge, voucher };
}

// Đặt tiền từng mục cho đủ đúng số tiền của ô (dư/thiếu dồn vào mục cuối)
function fitItems(items, amount) {
  const sum = items.reduce((t, i) => t + i.price, 0);
  if (!items.length) return items;
  if (items.length === 1) { items[0].price = amount; return items; }
  const d = amount - sum;
  items[items.length - 1].price = Math.max(0, items[items.length - 1].price + d);
  return items;
}

// row: { amount, tip, entries:[{text, staff, parsed}] } → mỗi entry: { amount, tip, surcharge, extraTip }
function splitRow(row) {
  const es = row.entries;
  for (const e of es) e.est = e.parsed.items.reduce((t, i) => t + i.price, 0);
  const known = es.filter((e) => e.parsed.explicit > 0);
  const unknown = es.filter((e) => !(e.parsed.explicit > 0));
  for (const e of known) e.amount = e.parsed.explicit;
  let extraTip = 0;
  const R = row.amount || 0;
  const knownSum = known.reduce((t, e) => t + e.amount + e.parsed.surcharge, 0);
  const vTotal = es.reduce((t, e) => t + (e.parsed.voucher || 0), 0);
  if (R > 0 && knownSum > R && vTotal && knownSum - R <= vTotal + 1000 && !unknown.length) {
    // Trừ thẻ tri ân: doanh số vẫn đủ giá dịch vụ, phần thẻ trả = chênh lệch (giao cho ô ghi dùng thẻ)
    let gap = knownSum - R;
    for (const e of es.filter((x) => x.parsed.voucher).sort((a, b) => b.amount - a.amount)) { const v = Math.min(gap, e.parsed.voucher, e.amount); e.voucher = v; gap -= v; }
    if (gap > 0) { const big = [...es].sort((a, b) => b.amount - a.amount)[0]; big.voucher = (big.voucher || 0) + gap; }
  } else if (R > 0 && knownSum > R) {
    // Ghi giá cao hơn tiền thu (trả bằng thẻ/voucher, nạp thẻ…): lấy đúng tiền sổ thu, chia theo tỷ lệ
    let left = R;
    es.forEach((e, i) => { const base = e.parsed.explicit || e.est; const v = i === es.length - 1 ? left : Math.round(R * base / (knownSum + unknown.reduce((t, x) => t + x.est, 0)) / 1000) * 1000; e.amount = Math.max(0, v - e.parsed.surcharge); left -= v; e.check = true; });
  } else if (R > 0) {
    const rem = R - known.reduce((t, e) => t + e.amount + e.parsed.surcharge, 0) - unknown.reduce((t, e) => t + e.parsed.surcharge, 0);
    if (!unknown.length) { if (rem > 0) extraTip = rem; }
    else {
      const est = unknown.reduce((t, e) => t + e.est, 0);
      const allFixed = unknown.every((e) => e.parsed.items.length && e.parsed.items.every((i) => i.fixed));
      if (allFixed && rem > est && est > 0) { extraTip = rem - est; for (const e of unknown) e.amount = e.est; }
      else if (rem > 0) {
        let left = rem;
        unknown.forEach((e, i) => { const v = i === unknown.length - 1 ? left : Math.round((est ? rem * e.est / est : rem / unknown.length) / 1000) * 1000; e.amount = v; left -= v; });
      } else for (const e of unknown) e.amount = e.est; // dòng ghi thiếu tiền: lấy giá bảng
    }
  } else for (const e of unknown) e.amount = e.est;
  // Tiền dư: có ghi mua sản phẩm → tiền bán sản phẩm; dư nhỏ (≤ 20% giá dịch vụ, dưới 300k) → tip chung; dư lớn → ghi "chưa rõ", cần kiểm tra
  let extraProduct = 0, extraOther = 0;
  if (extraTip > 0) {
    const first = es[0];
    if (es.some((e) => PRODUCT.test(fold(e.text)))) { extraProduct = extraTip; extraTip = 0; }
    else if (extraTip >= 300000 || extraTip > Math.max(50000, 0.2 * es.reduce((t, e) => t + e.amount, 0))) { extraOther = extraTip; extraTip = 0; first.check = 'more'; }
  }
  es.forEach((e, i) => { e.tip = i === 0 ? (row.tip || 0) + extraTip : 0; e.extraTip = i === 0 ? extraTip : 0; e.extraProduct = i === 0 ? extraProduct : 0; e.extraOther = i === 0 ? extraOther : 0; });
  return es;
}

// Tên khách: bỏ SĐT, giá, từ dịch vụ, chữ trong ngoặc
function cleanName(text) {
  let s = String(text).replace(/^\s*\d{1,2}[:h]\d{2}\s*/, '').split(/\s[–-]\s/)[0];
  s = s.replace(/\([^)]*\)?/g, ' ').replace(/[|/]/g, ' ').replace(/(?:\+?84|0)[\d.\s]{8,12}\d/g, ' ');
  const f = fold(s);
  const stop = f.search(/[-=]|\b(phu|cat|ct|nhuom|uon|duoi|goi|tk|tao kieu|ep|tay|massage|masage|u lanh|hap|phuc hoi|mai|rua mat|cham chan|highlight|su dung|ck|off|tra|chuyen|tm|voucher)\b|\d/);
  if (stop > 0) s = s.slice(0, stop);
  s = s.replace(/[+,.:;]+$/, '').replace(/\s+/g, ' ').trim();
  return s.length >= 2 ? s.slice(0, 60) : null;
}

module.exports = { PRODUCT, amounts, parseEntry, splitRow, fitItems, cleanName, fold };
