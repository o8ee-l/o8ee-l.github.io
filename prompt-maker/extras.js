/* ============================================================
 * extras.js — debug-lab 追加機能（GA4アクセス分析＋お知らせ）
 * ------------------------------------------------------------
 * 【GA4】
 * - 測定IDは index.html 先頭の window.GA_MEASUREMENT_ID で設定する。
 * - IDが空欄の間は、タグの読み込み・イベント送信・同意UI表示を
 *   一切行わない（このモジュールは完全に無効になる）。
 * - IDが設定されていても、利用者が「同意する」を選ぶまでは
 *   gtag.js を読み込まない。拒否した場合は以後読み込まない。
 * - 同意状態は localStorage（eru-maker-ga-consent）に保存し、
 *   フッターの「アクセス解析の設定」からいつでも変更できる。
 * - イベントは操作が成功したときだけ track() 経由で送る。
 *   プロンプト本文・自由入力・手動編集内容は絶対に送らない
 *   （イベント名と、許可リストにある集計用属性のみ）。
 * 【お知らせポップアップ】
 * - 設定は notice-config.js（window.MAKER_NOTICE）に分離。
 * - 表示状態は localStorage（eru-maker-notice-state）に保存:
 *   { lastSeenNoticeId, snoozeUntil }
 * - 同意UIと同時には表示しない（表示キューで直列化し、
 *   同意UIを先に処理する）。
 * ============================================================ */
(function(){
  "use strict";

  var GA_ID = (window.GA_MEASUREMENT_ID || "").trim();
  var CONSENT_KEY = "eru-maker-ga-consent";
  var NOTICE_KEY = "eru-maker-notice-state";

  /* ---------- 汎用 ---------- */
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function $(id){ return document.getElementById(id); }
  function uiLang(){ return document.documentElement.lang === "en" ? "en" : "ja"; }

  /* ---------- 文言 ---------- */
  var STR = {
    ja: {
      consentText: "このサイトでは、利用状況を把握してより良くしていくため、Google Analyticsによるアクセス解析を行っています。同意いただいた場合のみ計測を開始します。入力したプロンプトの内容が送信されることはありません。",
      consentMore: "くわしく見る（プライバシーポリシー）",
      consentAgree: "同意する",
      consentDeny: "拒否する",
      consentClose: "閉じる",
      settingsBtn: "アクセス解析の設定",
      policy:
        "アクセス解析について\n" +
        "当サイトでは、サービスの利用状況を把握し、改善に役立てるため、Google LLC が提供するアクセス解析ツール「Google Analytics」を使用しています。\n" +
        "・計測は、利用者の同意がある場合にのみ開始します。同意がない場合、解析ツール自体が読み込まれることはありません。\n" +
        "・Google Analytics は Cookie を使用して、閲覧したページや機能の利用回数などを計測します。\n" +
        "・当サイトで入力したプロンプトの本文、自由入力の内容、手動で編集した内容などの文章データは、アクセス解析には送信されません。送信されるのは、機能が使われた回数などの集計に必要な最小限の操作情報のみです。\n" +
        "・収集されたデータの取り扱いについては、Google のプライバシーポリシーをご確認ください。\n" +
        "・同意の選択は、このサイトのフッターにある「アクセス解析の設定」からいつでも変更できます。"
    },
    en: {
      consentText: "This site uses Google Analytics to understand how it is used and to improve it. Measurement starts only if you agree. The prompts you type are never sent.",
      consentMore: "Details (privacy policy)",
      consentAgree: "Agree",
      consentDeny: "Decline",
      consentClose: "Close",
      settingsBtn: "Analytics settings",
      policy:
        "About analytics\n" +
        "This site uses Google Analytics, an analytics tool provided by Google LLC, to understand how the service is used and to improve it.\n" +
        "- Measurement starts only with your consent. Without consent, the analytics tool itself is never loaded.\n" +
        "- Google Analytics uses cookies to measure things such as pages viewed and how often features are used.\n" +
        "- Text data such as the prompt body you enter, free-text input, and manually edited content is never sent to analytics. Only the minimal operation information needed for aggregate counts, such as how often a feature was used, is sent.\n" +
        "- For how the collected data is handled, please see Google's privacy policy.\n" +
        "- You can change your consent choice at any time from \"Analytics settings\" in this site's footer."
    }
  };
  function t(){ return STR[uiLang()] || STR.ja; }

  /* ============================================================
   * GA4
   * ============================================================ */
  var gaLoaded = false;
  function getConsent(){ return lsGet(CONSENT_KEY); } /* "granted" | "denied" | null */

  function loadGa(){
    if(gaLoaded || !GA_ID) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    /* 広告系ストレージは使わない。読み込み時点で同意済みのため analytics のみ許可 */
    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  /* 送信してよいイベントと属性の許可リスト（本文データは一切含めない） */
  var EVENT_PARAMS = {
    prompt_generate: ["out_mode"],
    prompt_copy: ["target"],
    random_generate: ["scope"],
    preset_apply: ["kind"],
    clear_all: [],
    mode_switch: ["mode"],
    out_mode_switch: ["to"]
  };
  function track(name, params){
    if(!GA_ID || !gaLoaded) return;                 /* ID未設定 or 未読込なら何もしない */
    if(getConsent() !== "granted") return;          /* 同意がある場合のみ */
    if(!Object.prototype.hasOwnProperty.call(EVENT_PARAMS, name)) return;
    var clean = {};
    var allowed = EVENT_PARAMS[name];
    if(params){
      allowed.forEach(function(k){
        var v = params[k];
        if(typeof v === "string" || typeof v === "number" || typeof v === "boolean") clean[k] = v;
      });
    }
    try{ window.gtag("event", name, clean); }catch(e){}
  }

  window.MakerAnalytics = {
    track: track,
    getConsent: getConsent,
    isLoaded: function(){ return gaLoaded; },
    isEnabled: function(){ return !!GA_ID; }
  };

  /* ============================================================
   * 表示キュー（同意UI → お知らせ の順に直列化。同時表示しない）
   * ============================================================ */
  var uiQueue = [], uiBusy = false;
  function enqueueUi(fn){ uiQueue.push(fn); pumpUi(); }
  function pumpUi(){
    if(uiBusy) return;
    var fn = uiQueue.shift();
    if(!fn) return;
    uiBusy = true;
    fn(function(){ uiBusy = false; pumpUi(); });
  }

  /* ============================================================
   * 同意バナー
   * ============================================================ */
  var consentDone = null;
  function showConsentBanner(done){
    var banner = $("consentBanner");
    if(!banner){ done(); return; }
    var s = t();
    $("consentText").textContent = s.consentText;
    $("consentMoreSummary").textContent = s.consentMore;
    $("consentPolicy").textContent = s.policy;
    $("consentAgreeBtn").textContent = s.consentAgree;
    $("consentDenyBtn").textContent = s.consentDeny;
    $("consentCloseBtn").setAttribute("aria-label", s.consentClose);
    consentDone = done;
    banner.classList.remove("hidden");
    var b = $("consentAgreeBtn");
    if(b) b.focus();
  }
  function hideConsentBanner(){
    var banner = $("consentBanner");
    if(banner) banner.classList.add("hidden");
    if(consentDone){ var d = consentDone; consentDone = null; d(); }
  }
  function wireConsent(){
    var agree = $("consentAgreeBtn"), deny = $("consentDenyBtn"), close = $("consentCloseBtn");
    if(agree) agree.addEventListener("click", function(){
      lsSet(CONSENT_KEY, "granted");
      loadGa();
      hideConsentBanner();
    });
    if(deny) deny.addEventListener("click", function(){
      lsSet(CONSENT_KEY, "denied");
      hideConsentBanner();
    });
    if(close) close.addEventListener("click", function(){
      /* 決定せずに閉じる: この表示だけ閉じる。次回訪問時に再表示する */
      hideConsentBanner();
    });
  }
  /* フッターから同意を選び直せる導線（ID設定時のみ） */
  function addSettingsButton(){
    var footer = document.querySelector("footer.site");
    if(!footer || $("gaSettingsBtn")) return;
    var row = document.createElement("div");
    row.className = "ga-settings-row";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small";
    btn.id = "gaSettingsBtn";
    btn.textContent = t().settingsBtn;
    btn.addEventListener("click", function(){ enqueueUi(showConsentBanner); });
    row.appendChild(btn);
    footer.appendChild(row);
  }

  /* ============================================================
   * お知らせポップアップ
   * ============================================================ */
  function noticeState(){
    try{ return JSON.parse(lsGet(NOTICE_KEY) || "{}") || {}; }catch(e){ return {}; }
  }
  function saveNoticeState(st){ lsSet(NOTICE_KEY, JSON.stringify(st)); }

  var noticeCleanup = null;
  function showNotice(N, done){
    var modal = $("noticeModal");
    if(!modal){ done(); return; }
    $("noticeTitle").textContent = N.title || "UPDATE & INFORMATION";
    $("noticeDate").textContent = N.date || "";
    $("noticeBody").textContent = N.body || "";
    var up = $("noticeUpdates");
    up.innerHTML = "";
    if(Array.isArray(N.updates) && N.updates.length){
      var h = document.createElement("p");
      h.className = "notice-updates-title";
      h.textContent = uiLang() === "en" ? "What's new" : "今回の更新内容";
      up.appendChild(h);
      var ul = document.createElement("ul");
      N.updates.forEach(function(u){
        var li = document.createElement("li");
        li.textContent = u;
        ul.appendChild(li);
      });
      up.appendChild(ul);
    }
    var xBtn = $("noticeXBtn");
    if(N.xProfileUrl){
      xBtn.href = N.xProfileUrl;
      xBtn.classList.remove("hidden");
    } else {
      xBtn.classList.add("hidden");
      xBtn.removeAttribute("href");
    }

    var prevFocus = document.activeElement;
    var closed = false;
    function finish(markSeen){
      if(closed) return;
      closed = true;
      if(markSeen){
        var st = noticeState();
        st.lastSeenNoticeId = N.noticeId;
        saveNoticeState(st);
      }
      modal.classList.remove("open");
      document.removeEventListener("keydown", onKey, true);
      if(noticeCleanup === finish) noticeCleanup = null;
      if(prevFocus && prevFocus.focus) prevFocus.focus();
      done();
    }
    function onKey(e){
      if(e.key === "Escape"){ e.preventDefault(); finish(true); return; }
      if(e.key === "Tab"){
        var f = modal.querySelectorAll("button, a[href], [tabindex]");
        var list = [];
        f.forEach(function(el){ if(!el.classList.contains("hidden") && el.offsetParent !== null) list.push(el); });
        if(!list.length) return;
        var first = list[0], last = list[list.length - 1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    }
    noticeCleanup = finish;
    modal.onclick = function(e){ if(e.target === modal) finish(true); };
    $("noticeCloseBtn").onclick = function(){ finish(true); };
    $("noticeOkBtn").onclick = function(){ finish(true); };
    $("noticeSnoozeBtn").onclick = function(){
      var st = noticeState();
      st.snoozeUntil = Date.now() + 72 * 60 * 60 * 1000; /* 3日間表示しない = 72時間抑制 */
      saveNoticeState(st);
      finish(false);
    };
    document.addEventListener("keydown", onKey, true);
    modal.classList.add("open");
    var c = $("noticeCloseBtn");
    if(c) c.focus();
  }
  function maybeShowNotice(done){
    var N = window.MAKER_NOTICE;
    if(!N || !N.noticeId){ done(); return; }
    var st = noticeState();
    if(st.lastSeenNoticeId === N.noticeId){ done(); return; }
    if(st.snoozeUntil && st.snoozeUntil > Date.now()){ done(); return; }
    showNotice(N, done);
  }

  /* ============================================================
   * 初期化
   * ============================================================ */
  function init(){
    wireConsent();
    if(GA_ID){
      addSettingsButton();
      var c = getConsent();
      if(c === "granted") loadGa();
      else if(c !== "denied") enqueueUi(showConsentBanner); /* 未決定なら同意UIを先に */
    }
    enqueueUi(maybeShowNotice);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
