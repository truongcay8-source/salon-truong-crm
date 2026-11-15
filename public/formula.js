// Đọc công thức pha màu thợ gõ (vd "9nb 35ml 7glca 25ml oxi 20") → danh sách hóa chất + lượng để tính giá cốt.
// Dùng chung cho trình duyệt (window.parseFormula) và máy chủ/test (require).
(function (root) {
  'use strict';
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const squash = (s) => fold(s).replace(/[^a-z0-9.]/g, '');
  const OXI = /\b(oxi|oxy|oxit|oxidant|developer|activator|tro nhuom)\b/;
  const PCT_TO_VOL = { 1.5: 5, 3: 10, 6: 20, 9: 30, 12: 40 };
  const volOf = (n, unit) => (unit === '%' ? PCT_TO_VOL[n] || null : [5, 10, 20, 30, 40].includes(n) ? n : PCT_TO_VOL[n] || null);

  // materials: [{id, name, size, size_unit, formula_keys, formula_default, active, kind}]
  function parseFormula(text, materials) {
    const f = fold(text).replace(/[’'′]/g, "'");
    const mats = (materials || []).filter((m) => m.kind !== 'retail' && m.active !== 0);
    const keyed = [];
    for (const m of mats) for (const k of String(m.formula_keys || '').split(',')) { const s = squash(k); if (s.length >= 2) keyed.push({ k: s, m }); }
    keyed.sort((a, b) => b.k.length - a.k.length);
    const def = mats.find((m) => m.formula_default);
    const oxiMat = (vol) => mats.find((m) => { const x = fold(m.name).match(/(\d+)\s*vol/); return x && Number(x[1]) === vol && /activator|oxi|oxy|tro nhuom|developer/.test(fold(m.name)); });
    const ratioM = f.match(/\b1\s*[:/]\s*(\d+(?:[.,]\d+)?)/);
    const ratio = ratioM ? Number(ratioM[1].replace(',', '.')) : 1;

    const colors = [], oxis = [], unknown = [];
    const re = /(\d+(?:[.,]\d+)?)\s*(ml|gr|gam|g)(?![a-z])/g;
    let m, prev = 0;
    while ((m = re.exec(f))) {
      let label = f.slice(prev, m.index);
      prev = m.index + m[0].length;
      const cut = Math.max(label.lastIndexOf('+'), label.lastIndexOf(','), label.lastIndexOf(';'), label.lastIndexOf(':'), label.lastIndexOf('\n'), label.lastIndexOf('('));
      label = label.slice(cut + 1).trim().split(/\s+/).slice(-2).join(' ');
      const amt = Number(m[1].replace(',', '.'));
      if (!label || !(amt > 0)) continue;
      if (OXI.test(label)) { const v = label.match(/(\d+(?:[.,]\d+)?)\s*(%|vol)?/); oxis.push({ vol: v ? volOf(Number(v[1].replace(',', '.')), v[2]) : null, amt, label }); continue; }
      colors.push({ label, amt });
    }
    // "oxi 20" không ghi lượng → lấy bằng tổng lượng màu × tỷ lệ pha (mặc định 1:1)
    if (!oxis.length) {
      const o = f.match(/\b(?:oxi|oxy|oxit|oxidant|developer|activator)\s*(\d+(?:[.,]\d+)?)\s*(%|vol)?/);
      const total = colors.reduce((s, c) => s + c.amt, 0);
      if (o && total) oxis.push({ vol: volOf(Number(o[1].replace(',', '.')), o[2]), amt: Math.round(total * ratio * 10) / 10, label: o[0].trim(), guessed: true });
    }
    const lines = [], warn = [];
    const add = (mat, amt, label, guessed) => {
      if (!mat.size) { const w = `${mat.name}: chưa khai dung tích 1 tuýp/chai (vào Kho › Sửa để điền)`; if (!warn.includes(w)) warn.push(w); return; }
      const ex = lines.find((l) => l.material_id === mat.id);
      if (ex) { ex.amt = Math.round((ex.amt + amt) * 10) / 10; ex.labels.push(label); } else lines.push({ material_id: mat.id, name: mat.name, amt, unit: mat.size_unit, labels: [label], guessed: !!guessed });
    };
    for (const c of colors) {
      const s = squash(c.label);
      const hit = keyed.find((x) => s.includes(x.k));
      const mat = hit ? hit.m : /[a-z]/.test(s) && /\d/.test(s) ? def : null;
      if (mat) add(mat, c.amt, c.label, !hit); else unknown.push(c.label + ' ' + c.amt + 'ml');
    }
    for (const o of oxis) {
      const mat = o.vol ? oxiMat(o.vol) : null;
      if (mat) add(mat, o.amt, o.label + (o.guessed ? ` (= lượng màu × ${ratio})` : ''), o.guessed); else unknown.push(o.label + (o.vol ? ` (chưa có oxi ${o.vol}vol trong kho)` : ''));
    }
    return { lines, unknown, warn, ratio };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseFormula, fold };
  else root.parseFormula = parseFormula;
})(typeof window !== 'undefined' ? window : globalThis);
