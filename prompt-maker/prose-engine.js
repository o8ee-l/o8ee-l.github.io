/* prose-engine.js — 文章化エンジン (Phase 1)
 *
 * 中間表現（index.html 側 buildProseContext() の戻り値）と
 * MAKER_PROSE_TPL（prose-templates.js）から、EN / JP の自然文を生成する純粋関数群。
 * DOM・localStorage・グローバル状態 S には一切依存しない（入力は ctx のみ）。
 *
 * 文章化ルール（Phase 1 実装範囲）:
 *  - 英語は主語・動詞を補って再構築する。主語は gender から決める
 *    （女の子=She / 男の子=He / 中性的=They / 未指定=The character、2人=The two characters）。
 *  - 2人モードは Character A / Character B / Scene に分離し、外見情報を混ぜない。
 *  - 非対称ポーズ（posePair の "one ... the other ..."）は行為者を A/B に割り当てず、
 *    "One of the two characters is ..." の不特定形にする。
 *  - 同義重複の統合は「完全一致の節・文の重複排除」まで。異義の描写は落とさない。
 *  - quality とネガティブは文章化対象外（quality はタグ列のまま別行、ネガは従来処理）。
 *  - 人数固定文・gender 合算文は生成結果の外（ctx.headEn / countEn 等）として前置する。
 *  - 背景3カテゴリは optFrag / jpLabel の合成済み断片をブロックとして受け取り、
 *    抑制・色調文などの既存挙動をそのまま引き継ぐ。
 *
 * boost の文章モード専用表現（Phase 1 の定義）:
 *  強調対象の文は通常どおり生成し、その直後に
 *    "Especially emphasized: {合成済み frag 全文}."
 *  という強調文を1文追加する。元の強調対象（frag）は削除も変更もしない。
 *  （タグモードの (frag:1.3) や繰り返し表現は文章モードでは使わない。）
 */
(function(){
"use strict";
const TPL = window.MAKER_PROSE_TPL || { subjects: {}, en: { cats: {} }, jp: {} };
const SUBJ = TPL.subjects || {};
const KIND = id => ((TPL.en.cats || {})[id] || {}).kind || "fallback";
const TPLCAT = id => (TPL.en.cats || {})[id] || {};

/* ---------------- helpers ---------------- */
function cap(s){ s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function period(s){ s = String(s || "").replace(/[\s.]+$/, ""); return s ? s + "." : s; }
function dedupArr(a){ const seen = new Set(), out = []; (a || []).forEach(x => { if(x && !seen.has(x)){ seen.add(x); out.push(x); } }); return out; }
function joinFlow(clauses){ return dedupArr(clauses).join(", "); }
function joinList(clauses){
  const c = dedupArr(clauses);
  if(c.length <= 1) return c.join("");
  if(c.length === 2) return c[0] + " and " + c[1];
  return c.slice(0, -1).join(", ") + ", and " + c[c.length - 1];
}
const MASS = { skin: 1, hair: 1 };
const NO_ART = /^(a|an|the|no|two|both|one|all|some|any|from|with|in|on|at|by|of|her|his|their|the)\b/i;
function aNP(clause){
  const c = String(clause || "").trim();
  if(!c || NO_ART.test(c) || /\d/.test(c.charAt(0))) return c;
  const last = (c.split(/\s+/).pop() || "").toLowerCase().replace(/[^a-z]/g, "");
  if(MASS[last]) return c;
  if(/(s|sh|ch|x|z)$/.test(last) && !/ss$/.test(last)) return c; /* 複数形らしき語尾には付けない */
  return (/^[aeiou]/i.test(c) ? "an " : "a ") + c;
}
function stripHead(clause, heads){
  let c = String(clause || "").trim();
  (heads || []).forEach(h => {
    const suf = " " + h;
    if(c.length > suf.length && c.slice(-suf.length) === suf) c = c.slice(0, -suf.length);
  });
  return c;
}
function ingLed(clause){ return /^[a-z]+ing\b/i.test(String(clause || "").trim()); }
/* frag 内の中立表現を、選択中キャラの代名詞へ寄せる（節単位で適用） */
function norm(clauses, subj){
  return (clauses || []).map(c => String(c)
    .replace(/the character's/g, subj.pl)
    .replace(/the character/g, subj.o)
    .replace(/\bthe hair\b/g, subj.pl + " hair")
    .replace(/(?<!\b(?:her|his|their)\s)\bown\b/g, subj.pl + " own")
    .replace(/\bat viewer\b/g, "at the viewer"));
}
function subjFor(ctx, who){
  if(who === "scene") return ctx.pair ? (SUBJ.pair || SUBJ.unknown) : subjFor(ctx, "A");
  const g = (ctx.genders || {})[who] || "unknown";
  return SUBJ[g] || SUBJ.unknown || { s: "The character", p: "The character's", pl: "the character's", o: "the character", be: "is", has: "has" };
}
/* boost: 強調文を対象文の直後へ追加（元の frag は変更しない） */
function withBoost(sentences, item){
  if(item && item.boosted && item.frag) sentences.push(period("Especially emphasized: " + item.frag));
  return sentences;
}

/* ---------------- EN: 文ビルダー ---------------- */
function sentFallback(item, subj){
  const f = joinFlow(norm(item.clauses, subj));
  return f ? [period(cap(f))] : [];
}
function sentHas(item, subj, raw){
  const cs = norm(item.clauses, subj);
  if(!cs.length) return [];
  const list = raw ? joinList(cs) : joinList([aNP(cs[0])].concat(cs.slice(1)));
  return [period(subj.s + " " + subj.has + " " + list)];
}
function sentBePoss(item, subj, tpl){
  const cs = norm(item.clauses, subj);
  if(!cs.length) return [];
  const pred = stripHead(cs[0], tpl.strip) || cs[0];
  let s = subj.p + " " + tpl.noun + " " + (tpl.plural ? "are" : subj.be) + " " + pred;
  if(cs.length > 1) s += ", " + joinFlow(cs.slice(1));
  return [period(s)];
}
const BODY_LED = /^(head|face|chin|hand|hands|arm|arms|leg|legs|body|shoulder|shoulders|waist|hip|hips|eyes|gaze)\b/i;
function sentPoseSolo(item, subj){
  let cs = norm(item.clauses, subj);
  if(!cs.length) return [];
  if(ingLed(cs[0])) return [period(subj.s + " " + subj.be + " " + joinFlow(cs))];
  cs = cs.map(c => BODY_LED.test(c) ? subj.pl + " " + c : c);
  return [period(subj.s + " " + subj.be + " posed with " + joinFlow(cs))];
}
function sentPosePair(item){
  const pair = SUBJ.pair || SUBJ.unknown;
  const cs = norm(item.clauses, pair);
  if(!cs.length) return [];
  const asym = [], rest = [];
  cs.forEach(c => { if(/^one\s/i.test(c) && /the other/.test(c)) asym.push(c); else rest.push(c); });
  const out = [];
  const sym = rest.slice();
  if(sym.length && /^two (people|characters)\b/i.test(sym[0])){
    const stripped = sym[0].replace(/^two (people|characters)\s*/i, "");
    if(stripped) sym[0] = stripped; else sym.shift();
  }
  if(sym.length){
    if(ingLed(sym[0])) out.push(period("The two characters are " + joinFlow(sym)));
    else if(/^with\s/i.test(sym[0])) out.push(period("The two characters have " + joinFlow([sym[0].replace(/^with\s+/i, "")].concat(sym.slice(1)))));
    else out.push(period("The two characters are shown together: " + joinFlow(sym)));
  }
  asym.forEach(c => { out.push(period("One of the two characters is " + c.replace(/^one\s+/i, ""))); });
  return out;
}
function sentShootStyle(item, subj){
  const cs = norm(item.clauses, subj);
  if(!cs.length) return [];
  const m = cs[0].match(/^(.*?)\s+style(?:\s+(?:portrait|photo|photography))?$/i);
  if(m && m[1]){
    let s = "The image is presented in " + m[1] + " style";
    if(cs.length > 1) s += ", " + joinFlow(cs.slice(1));
    return [period(s)];
  }
  return sentFallback(item, subj);
}
function sentEyeColor(item, subj){
  if(item.flags && item.flags.oddColors){
    let c1 = null, c2 = null;
    item.clauses.forEach(c => {
      let m = c.match(/anatomical left eye\s+(.+)$/); if(m) c1 = m[1];
      m = c.match(/anatomical right eye\s+(.+)$/); if(m) c2 = m[1];
    });
    if(c1 && c2) return [period(subj.s + " " + subj.has + " heterochromia, two different colored eyes: " + subj.pl + " anatomical left eye is " + c1 + " and " + subj.pl + " anatomical right eye is " + c2 + ", with mismatched eye colors")];
    return sentFallback(item, subj);
  }
  if(item.flags && item.flags.gradColors){
    let pair = null;
    item.clauses.forEach(c => { const m = c.match(/^(.+?) and (.+?) gradient irises$/); if(m) pair = [m[1], m[2]]; });
    if(pair) return [period(subj.p + " eyes have gradient irises, a two-tone gradient of " + pair[0] + " and " + pair[1])];
    return sentFallback(item, subj);
  }
  if(item.clauses.length === 1){
    const m = item.clauses[0].match(/^(.+?) eyes$/);
    if(m) return [period(subj.p + " eyes are " + m[1])];
  }
  return sentFallback(item, subj);
}
function itemSentences(catId, item, subj){
  const kind = KIND(catId);
  let out = [];
  switch(kind){
    case "skip": out = []; break;
    case "has": out = sentHas(item, subj, false); break;
    case "hasRaw": out = sentHas(item, subj, true); break;
    case "bePoss": out = sentBePoss(item, subj, TPLCAT(catId)); break;
    case "proportions": {
      const cs = norm(item.clauses, subj);
      if(cs.length) out = [period(subj.p + " proportions are " + joinFlow(cs))];
      break;
    }
    case "irisMotif": {
      const cs = norm(item.clauses, subj);
      if(cs.length) out = [period(subj.p + " irises feature " + joinList(cs))];
      break;
    }
    case "tattoo": {
      const f = norm([item.frag], subj)[0];
      if(f) out = [period(subj.s + " " + subj.has + " " + aNP(f))];
      break;
    }
    case "wears": {
      const cs = norm(item.clauses, subj);
      if(cs.length){
        const lead = aNP(cs[0]);
        out = [period(cs.length === 1 ? subj.s + " wears " + lead : subj.s + " wears " + lead + ": " + joinList(cs.slice(1)))];
      }
      break;
    }
    case "poseSolo": out = sentPoseSolo(item, subj); break;
    case "posePair": out = sentPosePair(item); break;
    case "gaze": {
      const cs = norm(item.clauses, subj);
      if(cs.length) out = ingLed(cs[0]) ? [period(subj.s + " " + subj.be + " " + joinFlow(cs))] : sentFallback(item, subj);
      break;
    }
    case "framing": {
      const cs = norm(item.clauses, subj);
      if(cs.length){ let s = "The shot is " + aNP(cs[0]); if(cs.length > 1) s += ", " + joinFlow(cs.slice(1)); out = [period(s)]; }
      break;
    }
    case "angle": {
      const cs = norm(item.clauses, subj);
      if(cs.length){ let s = "The view is " + aNP(cs[0]); if(cs.length > 1) s += ", " + joinFlow(cs.slice(1)); out = [period(s)]; }
      break;
    }
    case "shootStyle": out = sentShootStyle(item, subj); break;
    case "eyeColor": out = sentEyeColor(item, subj); break;
    case "effects": {
      const cs = norm(item.clauses, subj);
      if(cs.length) out = [period("The image features " + joinList(cs))];
      break;
    }
    default: out = sentFallback(item, subj);
  }
  return withBoost(out, item);
}

/* ---------------- EN: ブロック組み立て ---------------- */
function hairColorWord(item){
  if(!item || (item.flags && item.flags.multiColors)) return null;
  if(item.clauses.length === 1){
    const m = item.clauses[0].match(/^(.+?) hair$/);
    if(m) return m[1];
  }
  return null;
}
function assembleHair(cats, subj){
  const byId = {};
  cats.forEach(c => { byId[c.catId] = c; });
  const out = [];
  const hairItem = byId["hair"] && byId["hair"].items[0];
  const colorItem = byId["hairColor"] && byId["hairColor"].items[0];
  const colorWord = hairColorWord(colorItem);
  let colorConsumed = false;
  if(hairItem){
    const cs = norm(hairItem.clauses, subj);
    if(cs.length){
      let clauses = cs.slice();
      if(colorWord){
        colorConsumed = true;
        if(/(^|\s)hair$/.test(clauses[0]) && clauses[0] !== "hair") clauses[0] = clauses[0].replace(/\s*hair$/, " " + colorWord + " hair");
        else clauses = [colorWord + " hair"].concat(clauses);
      }
      ["hairLength", "hairTexture"].forEach(id => {
        const c = byId[id];
        if(c) c.items.forEach(it => { clauses = clauses.concat(norm(it.clauses, subj)); });
      });
      out.push(period(subj.s + " " + subj.has + " " + joinList(clauses)));
    }
    withBoost(out, hairItem);
  }
  ["hairLength", "hairTexture"].forEach(id => {
    if(hairItem) return; /* 統合済み */
    const c = byId[id];
    if(c) c.items.forEach(it => { out.push.apply(out, itemSentences(id, it, subj)); });
  });
  if(colorItem && !colorConsumed){
    if(colorWord) out.push.apply(out, withBoost([period(subj.p + " hair " + subj.be + " " + colorWord)], colorItem));
    else out.push.apply(out, withBoost(sentFallback(colorItem, subj), colorItem));
  }
  if(colorItem && colorConsumed) withBoost(out, colorItem);
  cats.forEach(c => {
    if(["hair", "hairLength", "hairTexture", "hairColor"].indexOf(c.catId) >= 0) return;
    c.items.forEach(it => { out.push.apply(out, itemSentences(c.catId, it, subj)); });
  });
  return out;
}
function bgColorSentence(item, bgItem, subj){
  const word = item.flags && item.flags.word;
  if(bgItem && bgItem.flags && bgItem.flags.scene && word){
    return [period("The whole background scenery is tinted in " + word + " tones")];
  }
  return sentFallback(item, subj);
}
function assembleSceneBlock(cats, subj){
  const byId = {};
  cats.forEach(c => { byId[c.catId] = c; });
  const out = [];
  const bgItem = byId["background"] && byId["background"].items[0];
  if(bgItem){
    const cs = norm(bgItem.clauses, subj);
    if(cs.length){
      let s = (bgItem.flags && bgItem.flags.scene)
        ? "Behind " + subj.o + " is " + aNP(cs[0])
        : "The background is " + aNP(cs[0]);
      if(cs.length > 1) s += ", " + joinFlow(cs.slice(1));
      out.push.apply(out, withBoost([period(s)], bgItem));
    }
  }
  if(byId["bgPattern"]) byId["bgPattern"].items.forEach(it => {
    const cs = norm(it.clauses, subj);
    if(cs.length){
      const lead = stripHead(cs[0], ["background"]);
      out.push.apply(out, withBoost([period("The background is covered with " + joinList([lead].concat(cs.slice(1))))], it));
    }
  });
  if(byId["bgColor"]) byId["bgColor"].items.forEach(it => {
    out.push.apply(out, withBoost(bgColorSentence(it, bgItem, subj), it));
  });
  cats.forEach(c => {
    if(["background", "bgPattern", "bgColor"].indexOf(c.catId) >= 0) return;
    c.items.forEach(it => { out.push.apply(out, itemSentences(c.catId, it, subj)); });
  });
  return out;
}
function sectionSentences(blocks, subj, isScene){
  const tagged = [];
  (blocks || []).forEach(b => {
    let sents = [];
    if(!isScene && b.cats.some(c => c.catId === "hair" || c.catId === "hairColor")) sents = assembleHair(b.cats, subj);
    else if(isScene && b.cats.some(c => ["background", "bgPattern", "bgColor"].indexOf(c.catId) >= 0)) sents = assembleSceneBlock(b.cats, subj);
    else b.cats.forEach(c => c.items.forEach(it => { sents = sents.concat(itemSentences(c.catId, it, subj)); }));
    if(sents.length) tagged.push({ block: b.block, sents });
  });
  return tagged;
}
function flattenTagged(tagged){
  const out = [];
  tagged.slice().sort((a, b) => a.block - b.block).forEach(t => { out.push.apply(out, t.sents); });
  return out;
}
function buildEn(ctx){
  if(!ctx || ctx.empty) return "";
  const parts = [];
  if(ctx.pair){
    const head = [ctx.headEn];
    if(ctx.countEn && ctx.countEn.length) head.push(ctx.countEn.join(", "));
    parts.push(head.join("\n"));
    const a = flattenTagged(sectionSentences(ctx.charA, subjFor(ctx, "A"), false));
    if(a.length) parts.push("Character A: " + a.join(" "));
    const b = flattenTagged(sectionSentences(ctx.charB, subjFor(ctx, "B"), false));
    if(b.length) parts.push("Character B: " + b.join(" "));
    const sc = flattenTagged(sectionSentences(ctx.scene, subjFor(ctx, "scene"), true));
    if(sc.length) parts.push("Scene: " + sc.join(" "));
  } else {
    parts.push(ctx.headEn);
    const subj = subjFor(ctx, "A");
    const all = sectionSentences(ctx.charA, subj, false).concat(sectionSentences(ctx.scene, subj, true));
    const sents = flattenTagged(all);
    if(sents.length) parts.push(sents.join(" "));
  }
  if(ctx.quality && ctx.quality.length){
    const q = ctx.quality.map(it => it.frag).filter(Boolean);
    if(q.length) parts.push(q.join(", "));
  }
  if(ctx.extra && ctx.extra.length) parts.push(ctx.extra.join(", "));
  if(ctx.freeText) parts.push(ctx.freeText);
  return parts.filter(Boolean).join("\n\n");
}

/* ---------------- JP: 既存 jp の再構成 ---------------- */
function jpSentencesOf(items){
  const seen = new Set(), out = [];
  (items || []).forEach(it => {
    if(!it.jp) return;
    it.jp.split("。").map(s => s.trim()).filter(Boolean).forEach(s => {
      if(!seen.has(s)){ seen.add(s); out.push(s); }
    });
  });
  return out;
}
function jpParagraphs(blocks){
  const seen = new Set(), paras = [];
  (blocks || []).slice().sort((a, b) => a.block - b.block).forEach(b => {
    const sents = [];
    b.cats.forEach(c => c.items.forEach(it => {
      if(!it.jp) return;
      it.jp.split("。").map(s => s.trim()).filter(Boolean).forEach(s => {
        if(!seen.has(s)){ seen.add(s); sents.push(s); }
      });
    }));
    if(sents.length) paras.push(sents.join("。") + "。");
  });
  return paras;
}
function jpQualityPara(ctx){
  const sents = jpSentencesOf(ctx.quality || []);
  return sents.length ? sents.join("。") + "。" : "";
}
function buildJp(ctx){
  if(!ctx || ctx.empty) return "";
  const lines = [];
  if(ctx.pair){
    lines.push(ctx.headJp);
    if(ctx.countJp && ctx.countJp.length) lines.push(ctx.countJp.join("、"));
    const a = jpParagraphs(ctx.charA);
    if(a.length) lines.push("A：\n" + a.join("\n"));
    const b = jpParagraphs(ctx.charB);
    if(b.length) lines.push("B：\n" + b.join("\n"));
    const sc = jpParagraphs(ctx.scene);
    const q = jpQualityPara(ctx);
    if(q) sc.push(q);
    if(sc.length) lines.push("共通：\n" + sc.join("\n"));
  } else {
    lines.push(ctx.headJp);
    const paras = jpParagraphs((ctx.charA || []).concat(ctx.scene || []));
    const q = jpQualityPara(ctx);
    if(q) paras.push(q);
    if(paras.length) lines.push(paras.join("\n"));
  }
  if(ctx.freeText) lines.push(ctx.freeText);
  return lines.filter(Boolean).join("\n");
}

window.MakerProse = { buildEn: buildEn, buildJp: buildJp, version: 1 };
})();
