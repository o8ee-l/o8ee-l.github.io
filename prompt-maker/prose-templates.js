/* prose-templates.js — 文章化エンジン用テンプレート定義 (Phase 1)
 *
 * 役割: カテゴリ別の文型割り当て・主語テーブル・文型パラメータを保持する。
 * data.js は変更しない。文型の調整はこのファイルだけで完結させる。
 *
 * kind 一覧（文の組み立て方は prose-engine.js 側の同名ビルダーが担う）:
 *   skip        … 文章化しない（gender: 主語・代名詞の決定専用）
 *   fallback    … frag をそのまま1文にする（文頭を大文字化し句点を付ける）
 *   has         … "{S} has {aNP(lead)}, {rest}." 型（名詞句列を所有文に）
 *   hasRaw      … has と同じだが先頭節へ冠詞を付けない（合成済み断片向け）
 *   bePoss      … "{P} {noun} {be} {lead(頭名詞除去)}, {rest}." 型
 *   proportions … "{P} proportions are {clauses}." 型（bodyType）
 *   hairMain / hairLength / hairColor … 髪ブロック専用（エンジン側で統合処理）
 *   eyeColor    … 色語抽出＋オッドアイ/グラデの合成断片パース
 *   irisMotif   … "{P} irises feature {clauses}." 型
 *   tattoo      … 合成済み断片（サイズ+本体+部位）を "{S} has a {frag}." に埋め込む
 *   wears       … "{S} wears {aNP(lead)}: {rest}." 型（outfit の部品列挙）
 *   poseSolo / posePair / gaze … 動作・視線文型
 *   framing / angle / shootStyle … 撮影系文型
 *   bgColor / background / bgPattern … 背景ブロック統合専用（エンジン側で合成）
 *   effects     … "The image features {clauses}." 型
 *   qualityTags … 文章化対象外（タグ列のまま別行に配置）
 */
window.MAKER_PROSE_TPL = {
  version: 1,

  /* 主語・代名詞テーブル。gender の選択から決まる。
     s=主格, p=所有格(文頭用), pl=所有格(小文字), o=目的格, be/has=動詞の形 */
  subjects: {
    female:  { s: "She",           p: "Her",            pl: "her",            o: "her",         be: "is",  has: "has"  },
    male:    { s: "He",            p: "His",            pl: "his",            o: "him",         be: "is",  has: "has"  },
    neutral: { s: "They",          p: "Their",          pl: "their",          o: "them",        be: "are", has: "have" },
    unknown: { s: "The character", p: "The character's", pl: "the character's", o: "the character", be: "is", has: "has" },
    pair:    { s: "The two characters", p: "Their",     pl: "their",          o: "them",        be: "are", has: "have" }
  },

  en: {
    cats: {
      gender:      { kind: "skip" },
      age:         { kind: "fallback" },
      bodyType:    { kind: "proportions" },
      skinColor:   { kind: "has" },

      hairLength:  { kind: "hairLength" },
      hairTexture: { kind: "has" },
      hair:        { kind: "hairMain" },
      bangs:       { kind: "bePoss", noun: "bangs",    strip: ["bangs"], plural: true },
      forehead:    { kind: "bePoss", noun: "forehead", strip: ["forehead"] },
      sidelocks:   { kind: "has" },
      hairPlus:    { kind: "has" },
      hairColor:   { kind: "hairColor" },
      colorOption: { kind: "hasRaw" },

      eyeShape:    { kind: "bePoss", noun: "eyes",     strip: ["eyes"], plural: true },
      eyeColor:    { kind: "eyeColor" },
      pupilShape:  { kind: "bePoss", noun: "pupils",   strip: ["pupil", "pupils"], plural: true },
      irisMotif:   { kind: "irisMotif" },
      eyeTexture:  { kind: "has" },
      eyebrows:    { kind: "bePoss", noun: "eyebrows", strip: ["eyebrows"], plural: true },
      faceDetail:  { kind: "has" },
      tattoo:      { kind: "tattoo" },
      mouth:       { kind: "has" },
      expression:  { kind: "has" },
      eyeExpression: { kind: "bePoss", noun: "eyes",   strip: ["eyes", "gaze"], plural: true },

      outfit:      { kind: "wears" },
      features:    { kind: "has" },

      poseSolo:    { kind: "poseSolo" },
      posePair:    { kind: "posePair" },
      gazeSolo:    { kind: "gaze" },
      gazePair:    { kind: "gaze" },

      framing:     { kind: "framing" },
      angle:       { kind: "angle" },
      shootStyle:  { kind: "shootStyle" },

      bgColor:     { kind: "bgColor" },
      background:  { kind: "background" },
      bgPattern:   { kind: "bgPattern" },
      effects:     { kind: "effects" },

      quality:     { kind: "qualityTags" }
    }
  },

  jp: {
    /* 2人モードのセクション見出し（現行 buildJapanese と同一表記） */
    sectionPair: { A: "A：", B: "B：", scene: "共通：" },
    /* 文の接続は既存 jp をそのまま使い、句読点の正規化と文単位の重複排除のみ行う */
    joinBlocksWith: "\n"
  }
};
