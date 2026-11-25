'use strict';
const $ = id => document.getElementById(id);
let W = 720, H = 1280; const FPS = 30;
const VF_NUMBER = '01041920904';      // رقم فودافون كاش (مؤكد)
const CONTACT_WA = '201041920904';    // واتساب للتواصل (مؤكد)
const PAY_API = 'https://sawalef-server.onrender.com';
const PRICES = { starter: 299, pro: 499, business: 999 };
const MAXSEC = { free: 60, starter: 300, pro: 600, business: 1800 };
const PLAN_NAMES = { free: 'مجاني', starter: 'Starter', pro: 'Pro', business: 'Business' };
const PLANS = { free: 3, starter: 20, pro: 40, business: 100 };
const THEMES = [['#4a148c','#d500f9'],['#0d47a1','#00b0ff'],['#bf360c','#ffab00'],['#1b5e20','#76ff03']];
const DEFAULTS = { mtext: 'gemini-3.5-flash-lite', mtts: 'gemini-3.8-flash-tts' };
let blob = null, blobUrl = null;

// ---------- storage (safe if blocked) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return (v === null || v === '') ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const OLD_TEXT = ['gemini-3.8-flash', 'gemini-3.6-flash'];
function textModel() { const m = store.get('mtext', DEFAULTS.mtext); return OLD_TEXT.includes(m) ? DEFAULTS.mtext : m; }
function monthKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); }
let me = null;
function plan() { return me ? me.plan : 'free'; }
const paid = () => plan() !== 'free';
const hasKey = () => paid() || !!store.get('gkey', '');
function used() { return paid() ? me.used : +store.get('used-' + monthKey(), 0); }
function limit() { return paid() ? me.limit : PLANS.free; }
function maxSecs() { return paid() ? me.maxSecs : MAXSEC.free; }
function refreshUsage() {
  $('usage').textContent = `الباقة: ${PLAN_NAMES[plan()]} | المستخدم هذا الشهر: ${used()} من ${limit()} | أقصى مدة: ${maxSecs() / 60} دقيقة`;
  $('gkeyWrap').hidden = paid(); $('pixWrap').hidden = paid();
  $('acctIn').hidden = !me; $('acctOut').hidden = !!me;
  if (me) $('acctInfo').textContent = `${me.email} | الباقة: ${PLAN_NAMES[plan()]}` + (paid() ? ` | تنتهي ${new Date(me.planUntil).toLocaleDateString('ar-EG')}` : '');
  if (typeof updWarn === 'function') updWarn();
}

// ---------- settings ----------
function loadSettings() {
  $('gkey').value = store.get('gkey', ''); $('pixkey').value = store.get('pixkey', '');
  $('mtext').value = textModel();
  $('mtts').value = store.get('mtts', DEFAULTS.mtts);
  $('ytid').value = store.get('ytid', '');
  refreshUsage();
}
function doSave(manual) {
  ['gkey', 'pixkey', 'mtext', 'mtts', 'ytid'].forEach(k => { const v = $(k).value.trim(); if (v) store.set(k, v); else { try { localStorage.removeItem(k); } catch {} } });
  const ok = $('saved');
  if (ok) { ok.textContent = manual ? '✅ تم الحفظ' : '✅ تم الحفظ تلقائيا'; ok.hidden = false; clearTimeout(doSave.t); doSave.t = setTimeout(() => { ok.hidden = true; }, 4000); }
  if (manual) status('تم الحفظ');
}
(function () {
  const b = $('save'); let last = 0;
  const fire = e => { if (e && e.cancelable) e.preventDefault(); const n = Date.now(); if (n - last < 400) return; last = n; doSave(true); };
  b.addEventListener('click', fire); b.addEventListener('touchend', fire);
  ['gkey', 'pixkey', 'mtext', 'mtts', 'ytid'].forEach(k => { const el = $(k); el.addEventListener('input', () => doSave(false)); el.addEventListener('change', () => doSave(false)); el.addEventListener('blur', () => doSave(false)); });
})();


let statusScrolled = true;
function status(t) { const s = $('status'); s.hidden = false; s.textContent = t; if (!statusScrolled) { statusScrolled = true; try { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} } }

// ---------- Gemini ----------
const TEXT_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
const TTS_FALLBACKS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
let vid = null;
async function geminiOnce(model, body) {
  if (paid()) {
    const r = await fetch(PAY_API + '/reel/gen', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('tok', '') }, body: JSON.stringify({ vid, model, body }) });
    if (!r.ok) { const e = new Error('Gemini ' + r.status); e.code = r.status; e.detail = (await r.text()).slice(0, 300); e.proxy = true; throw e; }
    return r.json();
  }
  const key = store.get('gkey', '');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body)
  });
  if (!r.ok) { const e = new Error('Gemini ' + r.status); e.code = r.status; e.detail = (await r.text()).slice(0, 300); throw e; }
  return r.json();
}
// Retries with backoff, then falls through a list of other models. Shows friendly Arabic progress.
async function gemini(model, body, fallbacks) {
  const list = [model].concat((fallbacks || []).filter(m => m !== model));
  let last;
  for (let mi = 0; mi < list.length; mi++) {
    const tries = mi < list.length - 1 ? 2 : 4;
    for (let t = 0; t < tries; t++) {
      try { return await geminiOnce(list[mi], body); }
      catch (e) {
        last = e;
        const busy = !e.code || [429, 500, 502, 503, 504].includes(e.code);
        if (e.proxy && [401, 402, 403].includes(e.code)) throw new Error('مشكلة في حسابك أو باقتك (' + e.code + '). سجّل دخول تاني أو راجع الباقة.');
        if (e.proxy && e.code === 503 && /key_missing/.test(e.detail)) throw new Error('الخدمة غير جاهزة بعد، جرّب لاحقا.');
        if (!e.proxy && (e.code === 401 || e.code === 403) || (!e.proxy && e.code === 400 && /API key/i.test(e.detail || ''))) throw new Error('مفتاح Gemini غير صالح أو غير مفعّل. راجع الإعدادات.');
        if (!busy) break; // bad/unknown model: try the next one right away
        if (t < tries - 1) { status('السيرفر مزدحم، بحاول تاني... (' + (t + 2) + '/' + tries + ')'); await sleepMs(1500 * Math.pow(2, t)); }
      }
    }
    if (mi < list.length - 1) status('النموذج مشغول، بجرّب نموذج تاني...');
  }
  if (last && last.code === 429) throw new Error(last.proxy ? 'عدد الطلبات كتير في الدقيقة أو وصلت لحد الخدمة. استنى دقيقة وجرّب تاني.' : 'وصل مفتاح Gemini لحد الاستخدام المجاني (حصة في الدقيقة أو اليوم، Google هي اللي بتحددها). استنى شوية أو استخدم مفتاح من حساب تاني.');
  throw new Error('السيرفر مزدحم دلوقتي ومقدرتش أكمل. جرّب كمان دقيقة. (' + ((last && last.message) || '') + ')');
}
const normScene = x => typeof x === 'string' ? { t: x, img: '', e: '✨' } : { t: String(x.t || x.text || ''), img: String(x.img || x.image || ''), e: String(x.e || x.emoji || '✨').slice(0, 4) };
async function scriptChunk(idea, tone, n, prev, first, total) {
  const ctxt = prev.length ? ` المشاهد السابقة (لا تكررها وكمّل من بعدها): ${prev.slice(-4).map(x => x.t).join(' | ')}.` : '';
  const prompt = `اكتب ${first ? 'سيناريو' : 'تكملة سيناريو'} فيديو بالعربية الفصحى المبسطة أو بلهجة مفهومة للجميع. الفكرة: ${idea}. الأسلوب: ${tone}. ` +
    `إجمالي مشاهد الفيديو ${total}، المطلوب الآن ${n} مشهدا.${ctxt} كل مشهد جملتان قصيرتان على الأكثر (10 إلى 22 كلمة). ` +
    (first ? 'المشهد الأول خطاف قوي. ' : 'لا تضف خطافا جديدا. ') + (prev.length + n >= total ? 'المشهد الأخير دعوة للمتابعة. ' : 'لا تختم الفيديو بعد. ') +
    `لكل مشهد أضف "img": وصف بصري قصير بالإنجليزية (2 إلى 4 كلمات مفتاحية بسيطة وملموسة مثل: sunrise mountains، لا تستخدم أفكارا مجردة) للبحث عن صورة فوتوغرافية مناسبة للمشهد، و"e": إيموجي واحد مناسب. ` +
    `أرجع JSON فقط بالشكل: {"title":"عنوان قصير","description":"وصف مع 3 هاشتاجات","scenes":[{"t":"نص المشهد","img":"sunrise mountains","e":"🌅"}]}`;
  const j = await gemini(textModel(), {
    contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' }
  }, TEXT_FALLBACKS);
  const out = JSON.parse(j.candidates[0].content.parts.map(p => p.text || '').join(''));
  if (!out.scenes || !out.scenes.length) throw new Error('سيناريو فارغ');
  out.scenes = out.scenes.map(normScene).filter(x => x.t);
  return out;
}
async function makeScript(idea, tone, scenes) {
  if (!hasKey()) return demoScript(idea, scenes);
  const CH = 15; let all = [], head = null;
  while (all.length < scenes) {
    const n = Math.min(CH, scenes - all.length);
    status(`جاري كتابة السيناريو... (${all.length} من ${scenes} مشهد)`);
    let out, tries = 0;
    for (;;) { try { out = await scriptChunk(idea, tone, n, all, !head, scenes); break; } catch (e) { if (++tries >= 3) throw e; await sleep(3000 * tries); } }
    if (!head) head = out;
    all = all.concat(out.scenes.slice(0, n + 3));
  }
  all = all.slice(0, scenes);
  return { title: head.title, description: head.description, scenes: all.map(x => x.t), imgs: all.map(x => x.img || idea), emojis: all.map(x => x.e) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function demoScript(idea, n) {
  const base = ['هل تعلم أن فكرتك تستحق فيديو؟', idea, 'ابدأ بخطوة صغيرة اليوم', 'كن مستمرا ولا تتوقف', 'شارك الفيديو مع صديق يحتاجه', 'تابعنا للمزيد من الأفكار'];
  const em = ['🤔', '💡', '🚀', '💪', '🤝', '🔔'], mid = [1, 2, 3, 4], idx = [0];
  while (idx.length < n - 1) idx.push(...mid); idx.length = Math.max(2, n - 1); idx.push(5);
  return { title: idea.slice(0, 60), description: idea + ' #shorts #عربي #أفكار', scenes: idx.map(i => base[i]), imgs: idx.map(() => idea), emojis: idx.map(i => em[i]) };
}
async function makeAudio(text, voice, ctx) {
  if (!hasKey()) { // demo: soft tone, 2.3s per scene-ish
    const sec = Math.max(8, text.length / 12), sr = 24000, buf = ctx.createBuffer(1, sr * sec, sr), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.05 * Math.sin(2 * Math.PI * 330 * i / sr) * (Math.sin(i / sr * 3) > 0 ? 1 : 0.2);
    return buf;
  }
  const j = await gemini(store.get('mtts', DEFAULTS.mtts), {
    contents: [{ parts: [{ text: 'اقرأ بحماس وبوضوح: ' + text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
  }, TTS_FALLBACKS);
  const part = j.candidates[0].content.parts.find(p => p.inlineData);
  const bin = atob(part.inlineData.data), n = bin.length >> 1;
  const rate = +((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || 24000);
  const buf = ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; d[i] = v / 32768; }
  return buf;
}

async function makeAudioLong(scenes, voice, ctx) {
  const G = 4, bufs = [], bounds = []; let total = 0;
  const groups = []; for (let i = 0; i < scenes.length; i += G) groups.push(scenes.slice(i, i + G));
  for (let gi = 0; gi < groups.length; gi++) {
    status(`جاري توليد الصوت... (${gi + 1} من ${groups.length})`);
    let buf, tries = 0;
    for (;;) { try { buf = await makeAudio(groups[gi].join('. '), voice, ctx); break; } catch (e) { if (++tries >= 3) throw e; await sleep(4000 * tries); } }
    const lens = groups[gi].map(x => x.length), sum = lens.reduce((a, b) => a + b, 0); let acc = 0;
    lens.forEach(l => { acc += l; bounds.push(total + acc / sum * buf.duration); });
    total += buf.duration; bufs.push(buf);
    if (gi < groups.length - 1 && hasKey()) await sleep(paid() ? 4500 : 1500);
  }
  const rate = bufs[0].sampleRate, out = ctx.createBuffer(1, bufs.reduce((a, b) => a + Math.round(b.length * rate / b.sampleRate), 0), rate), d = out.getChannelData(0); let off = 0;
  for (const b of bufs) { const x = b.getChannelData(0); d.set(x, off); off += x.length; }
  bounds[bounds.length - 1] = out.duration + 0.6;
  return { buf: out, bounds };
}

// ---------- canvas drawing ----------
// ---------- images (free: Pollinations AI, Wikimedia fallback, gradient+emoji last) ----------
async function fetchImg(url, ms) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('img ' + r.status);
    const b = await r.blob(); if (!/^image\//.test(b.type)) throw new Error('not image');
    const im = new Image(); im.src = URL.createObjectURL(b); await im.decode(); return im;
  } finally { clearTimeout(to); }
}
const BAD_TITLE = /beer|wine|alcohol|vodka|whisk|cocktail|bikini|nude|naked|bar |pub |cigarette|smok|drunk|map|diagram|flag|logo|coat of arms|chart|graph|icon|symbol|poster|stamp|seal|portrait of|signature|scan|manuscript|\.svg/i;
const pxCache = {};
async function pixabayUrls(kw) {
  const o = W > H ? 'landscape' : 'portrait', ck = o + kw.toLowerCase();
  if (pxCache[ck]) return pxCache[ck]; // Pixabay terms: cache results (24h); kept for this session
  let urls = [];
  if (paid()) {
    const r = await fetch(PAY_API + '/reel/pixabay?o=' + o + '&q=' + encodeURIComponent(kw), { headers: authH() });
    if (r.ok) urls = ((await r.json()).photos || []).map(p => p.src);
  } else {
    const k = store.get('pixkey', ''); if (!k) return [];
    const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(k)}&image_type=photo&safesearch=true&per_page=8&min_width=600&orientation=${o === 'landscape' ? 'horizontal' : 'vertical'}&q=${encodeURIComponent(kw)}`);
    if (r.ok) urls = ((await r.json()).hits || []).map(h => h.largeImageURL || h.webformatURL).filter(Boolean);
  }
  if (urls.length) pxCache[ck] = urls; return urls;
}
async function wikiUrls(kw) {
  const r = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(kw + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1000&format=json&origin=*`)).json();
  return Object.values((r.query || {}).pages || {}).filter(p => !BAD_TITLE.test(p.title || '')).map(p => p.imageinfo && p.imageinfo[0])
    .filter(i => i && /jpeg/.test(i.mime) && i.thumburl && i.width >= 800 && i.height >= 500).map(i => i.thumburl);
}
async function getImage(kw, seed) {
  kw = String(kw || '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  const queries = [kw, kw.split(' ').slice(0, 2).join(' '), kw.split(' ')[0]].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const src of [pixabayUrls, wikiUrls]) {
    for (const q of queries) {
      try {
        const urls = await src(q);
        for (let k = 0; k < Math.min(3, urls.length); k++) { try { return await fetchImg(urls[(seed + k) % urls.length], 25000); } catch {} }
      } catch {}
    }
  }
  try { // last try: free AI image (limited to 1 image per 45s per IP, so often refused)
    const pw = W > H ? 1024 : 576, ph = W > H ? 576 : 1024;
    return await fetchImg(`https://image.pollinations.ai/prompt/${encodeURIComponent(kw + ', cinematic, no text')}?width=${pw}&height=${ph}&nologo=true&seed=${seed}`, 30000);
  } catch {}
  return null;
}
async function loadImages(st) {
  const n = st.scenes.length, every = Math.max(1, Math.ceil(n / 24)), keys = [];
  for (let i = 0; i < n; i += every) keys.push(i);
  const got = {}; let done = 0, next = 0;
  async function worker() { while (next < keys.length) { const k = keys[next++]; got[k] = await getImage(st.imgs[k] || st.idea, k + 1); status(`جاري تجهيز الصور... (${++done} من ${keys.length})`); } }
  await Promise.all([worker(), worker()]);
  st.bitmaps = st.scenes.map((_, i) => got[i - i % every] || null);
  st.imgOk = st.bitmaps.filter(Boolean).length;
}

// ---------- canvas drawing: Ken Burns + crossfade + synced word captions ----------
function sceneRange(st, i) { return [i ? st.bounds[i - 1] : 0, st.bounds[i]]; }
function drawScene(c, st, i, p) {
  const im = st.bitmaps && st.bitmaps[i];
  if (im) {
    const base = Math.max(W / im.naturalWidth, H / im.naturalHeight), dir = i % 2 ? 1 : -1;
    const z = 1.06 + 0.14 * (i % 2 ? p : 1 - p), s = base * z, iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    const px = dir * (iw - W) * 0.35 * (p - 0.5), py = (i % 3 - 1) * (ih - H) * 0.25 * (p - 0.5);
    c.drawImage(im, W / 2 - iw / 2 + px, H / 2 - ih / 2 + py, iw, ih);
  } else {
    const [c1, c2] = THEMES[st.theme], g = c.createLinearGradient(0, 0, W * (1 + 0.3 * Math.sin(i)), H); g.addColorStop(0, c1); g.addColorStop(1, c2);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.12; c.fillStyle = '#fff';
    for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(W * ((k * 0.27 + i * 0.13 + p * 0.1) % 1), H * ((k * 0.19 + 0.1 + p * 0.08) % 1), 90 + k * 40, 0, 7); c.fill(); }
    c.globalAlpha = 1; c.font = `${Math.min(W, H) * 0.3}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.direction = 'ltr';
    c.save(); c.translate(W / 2, H * 0.35 + Math.sin(p * 6) * 14); c.scale(1 + 0.08 * p, 1 + 0.08 * p); c.fillText((st.emojis && st.emojis[i]) || '✨', 0, 0); c.restore();
  }
}
function drawCaption(c, st, i, t) {
  const [s0, s1] = sceneRange(st, i), text = st.scenes[i], words = text.split(/\s+/).filter(Boolean);
  const fs = Math.round(Math.min(W, H) * (W > H ? 0.075 : 0.08)), lh = fs * 1.5, maxW = W * 0.88;
  c.font = `bold ${fs}px Tahoma, Arial, sans-serif`; c.direction = 'rtl'; c.textBaseline = 'middle'; c.textAlign = 'right';
  const sp = c.measureText(' ').width, ww = words.map(w => c.measureText(w).width);
  const lines = []; let cur = [], cw = 0;
  words.forEach((w, k) => { const add = ww[k] + (cur.length ? sp : 0); if (cw + add > maxW && cur.length) { lines.push(cur); cur = []; cw = 0; } cw += ww[k] + (cur.length ? sp : 0); cur.push(k); });
  if (cur.length) lines.push(cur);
  const tot = words.reduce((a, w) => a + w.length + 1, 0), a0 = s0 + 0.1, a1 = Math.max(a0 + 0.3, s1 - 0.15); let acc = 0;
  const starts = words.map(w => { const v = acc; acc += w.length + 1; return a0 + (a1 - a0) * v / tot; });
  let cwi = 0; starts.forEach((v, k) => { if (t >= v) cwi = k; });
  const blockH = lines.length * lh, y0 = (W > H ? H * 0.80 : H * 0.70) - blockH / 2 + lh / 2;
  const g = c.createLinearGradient(0, y0 - lh * 1.5, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = g; c.fillRect(0, y0 - lh * 1.5, W, H - y0 + lh * 1.5);
  const pop = Math.min(1, (t - starts[cwi]) * 8);
  lines.forEach((ln, li) => {
    const lw = ln.reduce((a, k) => a + ww[k], 0) + sp * (ln.length - 1); let x = W / 2 + lw / 2; const y = y0 + li * lh;
    ln.forEach(k => {
      const cur = k === cwi, past = k < cwi;
      c.save(); if (cur) { c.translate(x - ww[k] / 2, y); c.scale(1 + 0.12 * (1 - pop) + 0.06, 1 + 0.12 * (1 - pop) + 0.06); c.translate(-(x - ww[k] / 2), -y); }
      c.lineWidth = fs * 0.2; c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(words[k], x, y);
      c.fillStyle = cur ? '#ffd740' : past ? '#ffffff' : 'rgba(255,255,255,.62)'; c.fillText(words[k], x, y); c.restore();
      x -= ww[k] + sp;
    });
  });
}
function drawFrame(c, st, t, total) {
  const n = st.scenes.length; let i = st.bounds.findIndex(b => t < b); if (i < 0) i = n - 1;
  const [s0, s1] = sceneRange(st, i), p = Math.max(0, Math.min(1, (t - s0) / (s1 - s0)));
  c.globalAlpha = 1; drawScene(c, st, i, p);
  const fade = 0.4;
  if (i > 0 && t - s0 < fade) { /* new scene fades in over the previous one */
    const q = (t - s0) / fade; c.globalAlpha = 1; c.save(); drawScene(c, st, i - 1, 1); c.restore();
    c.globalAlpha = q; drawScene(c, st, i, p); c.globalAlpha = 1;
  }
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, 10); c.fillStyle = '#fff'; c.fillRect(0, 0, W * t / total, 10);
  drawCaption(c, st, i, t);
}

// ---------- render to video (in browser) ----------
function pickMime() {
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
async function render(st, audioBuf, ctxA, music) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const dur = audioBuf.duration + 0.6;
  const dest = ctxA.createMediaStreamDestination(), src = ctxA.createBufferSource(); src.buffer = audioBuf; src.connect(dest);
  let oscs = [];
  if (music) { // royalty-free synthesized ambient pad (no external music used)
    const mg = ctxA.createGain(); mg.gain.value = 0.035; mg.connect(dest);
    const lfo = ctxA.createOscillator(), lg = ctxA.createGain(); lfo.frequency.value = 0.15; lg.gain.value = 0.015; lfo.connect(lg); lg.connect(mg.gain); oscs.push(lfo);
    [110, 164.81, 220, 261.63, 329.63].forEach((f, k) => { const o = ctxA.createOscillator(); o.type = k % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (k - 2) * 4; o.connect(mg); oscs.push(o); });
  }
  const stream = cv.captureStream(FPS); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = pickMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: dur > 150 ? 2.5e6 : 4e6 } : {}), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  window.__dbg = { c, st, dur, cv }; rec.start(500); const t0 = ctxA.currentTime + 0.1; src.start(t0); oscs.forEach(o => { o.start(t0); o.stop(t0 + dur + 0.2); }); drawFrame(c, st, 0, dur);
  let last = -1, stall = 0;
  await new Promise((res, rej) => { (function tick() {
    const t = ctxA.currentTime - t0;
    if (t >= dur) return res();
    if (t <= 0.01) { if (++stall > 180) return rej(new Error('الصوت متوقف على متصفحك. اضغط إنشاء الفيديو تاني وسيب الشاشة شغالة.')); } else stall = 0;
    drawFrame(c, st, Math.max(0, t), dur); const pc = Math.round(100 * t / dur); if (pc !== last) { last = pc; status(`جاري التصوير ${pc}% (باقي ${fmt(dur - t)}) لا تقفل الشاشة`); }
    requestAnimationFrame(tick); })(); });
  rec.stop(); await done;
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}
const fmt = x => { x = Math.max(0, Math.round(x)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
// ---------- main flow ----------
$('go').onclick = async () => {
  let ctxA = null;
  try { ctxA = new (window.AudioContext || window.webkitAudioContext)(); if (ctxA.resume) ctxA.resume(); } catch {}
  statusScrolled = false; status('تم الضغط... جاري التجهيز');
  if (!ctxA) return status('خطأ: متصفحك لا يدعم الصوت المطلوب. جرّب Safari أو Chrome حديث.');
  const idea = $('idea').value.trim(); if (!idea) return status('اكتب الفكرة أولا');
  if (used() >= limit()) { status(`وصلت للحد الشهري لباقة ${PLAN_NAMES[plan()]}: ${used()} من ${limit()} فيديو.` + (paid() ? ' الحد بيتجدد أول الشهر.' : ' (العداد على جهازك)')); $('resetWrap').hidden = paid(); return; }
  const secs = getSecs();
  if (secs > maxSecs()) return status(`باقتك (${PLAN_NAMES[plan()]}) تسمح بفيديو حتى ${maxSecs() / 60} دقيقة. اختر مدة أقصر أو باقة أعلى.`);
  $('go').disabled = true; $('result').hidden = true;
  let lock = null;
  try {
    if (paid()) {
      let r, j;
      try { r = await fetch(PAY_API + '/reel/start', { method: 'POST', headers: authH(), body: JSON.stringify({ secs }) }); j = await r.json(); }
      catch { throw new Error('تعذر الاتصال بالسيرفر (ممكن بيصحى)، جرّب بعد دقيقة.'); }
      if (!r.ok) throw new Error(j.error === 'monthly_limit' ? 'وصلت للحد الشهري للباقة.' : j.error === 'too_long' ? 'المدة أطول من باقتك.' : j.error === 'plan_required' ? 'باقتك انتهت. جدّد من قسم الباقات.' : 'تعذر البدء، سجّل دخول تاني.');
      vid = j.vid; me = Object.assign(me, j.me); refreshUsage();
    } else if (!store.get('gkey', '')) status('بدون مفتاح Gemini هيطلع فيديو تجريبي. أضف مفتاحك المجاني من الإعدادات.');
    const nScenes = secs <= 45 ? Math.round(secs / 5) : Math.ceil(secs / 8);
    W = $('orient').value === 'h' ? 1280 : 720; H = $('orient').value === 'h' ? 720 : 1280;
    try { if (secs > 60 && navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch {}
    status('جاري كتابة السيناريو...'); const s = await makeScript(idea, $('tone').value, nScenes);
    const st = { idea, scenes: s.scenes, imgs: s.imgs, emojis: s.emojis, theme: +$('theme').value, bitmaps: null, bounds: [] };
    const imgP = loadImages(st).catch(() => { st.bitmaps = st.scenes.map(() => null); });
    status('جاري توليد الصوت...'); const au = await makeAudioLong(s.scenes, $('voice').value, ctxA);
    st.bounds = au.bounds; await imgP;
    if (!st.bitmaps) st.bitmaps = st.scenes.map(() => null);
    if (ctxA.state === 'suspended') await Promise.race([ctxA.resume(), sleep(3000)]);
    blob = await render(st, au.buf, ctxA, $('music').checked);
    if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(blob);
    $('player').src = blobUrl; $('title').value = s.title; $('desc').value = s.description;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; $('download').href = blobUrl; $('download').download = 'reel.' + ext;
    $('result').hidden = false; if (!paid()) store.set('used-' + monthKey(), used() + 1); refreshUsage();
    status('تم! الفيديو جاهز.' + (st.imgOk ? '' : ' (الصور مش متاحة دلوقتي فاستخدمت خلفيات ملونة)'));
    window.__lastBlobSize = blob.size; window.__st = { imgOk: st.imgOk, n: st.scenes.length };
  } catch (e) { status('خطأ: ' + (/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'مشكلة اتصال بالإنترنت أو بالخدمة. جرّب تاني.' : e.message)); }
  if (lock) try { lock.release(); } catch {}
  try { ctxA.close(); } catch {}
  $('go').disabled = false;
};
window.addEventListener('unhandledrejection', e => status('خطأ غير متوقع: ' + ((e.reason && e.reason.message) || e.reason)));
window.addEventListener('error', e => status('خطأ غير متوقع: ' + e.message));
$('share').onclick = async () => {
  const f = new File([blob], $('download').download, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: $('title').value, text: $('desc').value }); } catch {} }
  else status('المشاركة المباشرة غير مدعومة هنا. استخدم زر التحميل ثم ارفع الفيديو من تطبيق المنصة.');
};

// ---------- YouTube upload (needs your Google OAuth Client ID) ----------
function gis() { return new Promise((res, rej) => { if (window.google && google.accounts) return res(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل خدمة جوجل')); document.head.appendChild(s); }); }
$('yt').onclick = async () => {
  const cid = store.get('ytid', ''); if (!cid) return status('أضف Google OAuth Client ID في الإعدادات أولا (انظر README).');
  if (plan() === 'free') return status('الرفع على يوتيوب متاح من باقة Starter.');
  try {
    await gis();
    const token = await new Promise((res, rej) => google.accounts.oauth2.initTokenClient({ client_id: cid, scope: 'https://www.googleapis.com/auth/youtube.upload',
      callback: r => r.access_token ? res(r.access_token) : rej(new Error(r.error || 'رفض')) }).requestAccessToken());
    status('جاري الرفع...');
    const meta = { snippet: { title: ($('title').value + ' #Shorts').slice(0, 100), description: $('desc').value + '\n#Shorts', categoryId: '22' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } };
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type }, body: JSON.stringify(meta) });
    if (!init.ok) throw new Error('YouTube ' + init.status + ' ' + (await init.text()).slice(0, 200));
    const up = await fetch(init.headers.get('Location'), { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
    if (!up.ok) throw new Error('YouTube ' + up.status);
    const v = await up.json(); $('ytout').innerHTML = `تم الرفع (خاص). <a href="https://youtu.be/${v.id}" target="_blank" style="color:#9cf">youtu.be/${v.id}</a>`; status('تم الرفع على يوتيوب كفيديو خاص. غيّر الخصوصية من يوتيوب ستوديو.');
  } catch (e) { status('خطأ: ' + e.message); }
};
loadSettings();

// ---------- duration UI ----------
function getSecs() { const v = $('length').value; return v === 'custom' ? Math.max(1, Math.min(30, +$('customMin').value || 1)) * 60 : +v; }
function updWarn() {
  $('customWrap').hidden = $('length').value !== 'custom';
  const secs = getSecs(), w = $('longWarn');
  if (secs <= 60) { w.hidden = true; return; }
  const key = hasKey();
  w.hidden = false;
  w.textContent = `تنبيه: الفيديو الطويل (${fmt(secs)}) بيتصوّر في وقت حقيقي، يعني هياخد حوالي ${Math.ceil(secs / 60) + Math.ceil(secs / 60 / 3)} دقيقة أو أكتر. سيب الصفحة مفتوحة والشاشة شغالة ولا تغيّر التطبيق.` +
    (key ? ' الحدود المجانية لجوجل ممكن تبطّئ التوليد وتعمل إعادة محاولة تلقائية.' : ' (بدون مفتاح جوجل هيطلع فيديو تجريبي.)') +
    (secs > maxSecs() ? ` باقتك الحالية تسمح بحتى ${maxSecs() / 60} دقيقة فقط.` : '');
}
['length', 'customMin'].forEach(i => $(i).addEventListener('input', updWarn)); $('length').addEventListener('change', updWarn);
$('length').value = '30'; updWarn();

// ---------- accounts ----------
const authH = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('tok', '') });
function aMsg(t, cls) { const m = $('aMsg'); m.hidden = !t; m.textContent = t || ''; m.className = 'status ' + (cls || ''); }
async function authCall(kind) {
  const email = $('aEmail').value.trim(), password = $('aPass').value;
  if (!email || password.length < 6) return aMsg('اكتب إيميل صحيح وباسورد 6 أحرف أو أكتر', 'bad');
  aMsg('لحظة...', 'pend');
  try {
    const r = await fetch(PAY_API + '/reel/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json();
    if (!r.ok) return aMsg(j.error === 'exists' ? 'الإيميل ده مسجّل. اضغط دخول.' : j.error === 'wrong_login' ? 'الإيميل أو الباسورد غلط.' : j.error === 'too_many' ? 'محاولات كتير، استنى شوية.' : 'تعذر: ' + (j.error || r.status), 'bad');
    store.set('tok', j.token); me = j.me; aMsg(''); $('aPass').value = ''; refreshUsage(); checkPending();
    if (wantPlan) { const p = wantPlan; wantPlan = null; openPay(p); }
  } catch { aMsg('تعذر الاتصال بالسيرفر (ممكن بيصحى)، جرّب بعد دقيقة.', 'bad'); }
}
$('aLogin').onclick = () => authCall('login'); $('aSignup').onclick = () => authCall('signup');
$('logout').onclick = () => { store.set('tok', ''); me = null; $('pay').hidden = true; showPayStatus(''); refreshUsage(); };
async function loadMe() {
  if (!store.get('tok', '')) return refreshUsage();
  try { const r = await fetch(PAY_API + '/reel/me', { headers: authH() }); if (r.status === 401) { store.set('tok', ''); me = null; } else if (r.ok) me = await r.json(); } catch {}
  refreshUsage();
}

// ---------- Vodafone Cash payment (manual approval) ----------
let payPlan = null, wantPlan = null;
function payRef() { let r = store.get('payref', ''); if (!r) { r = 'RM-' + Math.random().toString(36).slice(2, 8).toUpperCase(); store.set('payref', r); } return r; }
function showPayStatus(t, cls) { const p = $('payStatus'); p.hidden = !t; p.textContent = t || ''; p.className = 'status ' + (cls || ''); }
function openPay(p) {
  payPlan = p; $('payPlan').textContent = PLAN_NAMES[p]; $('payAmount').textContent = PRICES[p];
  $('payNumber').textContent = VF_NUMBER; $('payRef').textContent = payRef(); $('pay').hidden = false; $('payMsg').hidden = true;
  $('pay').scrollIntoView({ behavior: 'smooth' });
}
document.querySelectorAll('.pick').forEach(b => b.onclick = () => {
  const p = b.dataset.plan;
  if (p === 'free') { $('pay').hidden = true; return aMsg(me ? '' : 'الباقة المجانية: ما تحتاجش حساب، أضف مفتاح Gemini من الإعدادات.', 'pend'), $('acct').scrollIntoView({ behavior: 'smooth' }); }
  if (!me) { wantPlan = p; aMsg('سجّل دخول أو أنشئ حساب الأول، وبعدها تكمل الدفع.', 'pend'); $('acct').scrollIntoView({ behavior: 'smooth' }); return; }
  openPay(p);
});
$('copyNum').onclick = async () => { try { await navigator.clipboard.writeText(VF_NUMBER); $('copyNum').textContent = 'تم النسخ'; } catch { $('copyNum').textContent = VF_NUMBER; } };
function payMsg(t, cls) { const m = $('payMsg'); m.hidden = false; m.textContent = t; m.className = 'status ' + (cls || ''); }
$('paySend').onclick = async () => {
  const sender = $('paySender').value.replace(/\D/g, ''), tx = $('payTx').value.trim();
  if (!payPlan || !me) return;
  if (sender.length < 10) return payMsg('اكتب رقم الموبايل اللي حوّلت منه', 'bad');
  if (tx.length < 4) return payMsg('اكتب رقم العملية من رسالة فودافون', 'bad');
  const ref = payRef();
  $('paySend').disabled = true;
  try {
    const r = await fetch(PAY_API + '/reel/pay', { method: 'POST', headers: authH(), body: JSON.stringify({ ref, plan: payPlan, sender, tx }) });
    if (!r.ok) throw new Error('server ' + r.status);
    store.set('pending', JSON.stringify({ ref, plan: payPlan }));
    payMsg('تم الإرسال. الحالة: قيد المراجعة. ابعت لقطة شاشة التحويل على واتساب وهتتفعل الباقة على حسابك بعد المراجعة.', 'pend');
    const text = `طلب اشتراك ReelMaker\nالحساب: ${me.email}\nالباقة: ${PLAN_NAMES[payPlan]}\nالمبلغ: ${PRICES[payPlan]} ج.م\nالمرجع: ${ref}\nمن رقم: ${sender}\nرقم العملية: ${tx}`;
    window.open(`https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`, '_blank');
    checkPending();
  } catch (e) { payMsg('تعذر الإرسال (السيرفر ممكن يكون بيصحى، جرّب بعد دقيقة): ' + e.message, 'bad'); }
  $('paySend').disabled = false;
};
async function checkPending() {
  if (!me) return;
  let p; try { p = JSON.parse(store.get('pending', 'null')); } catch {} if (!p) return;
  try {
    const r = await fetch(PAY_API + '/reel/status?ref=' + encodeURIComponent(p.ref), { headers: authH() }); if (!r.ok) return;
    const j = await r.json();
    if (j.status === 'approved') { store.set('pending', ''); store.set('payref', ''); await loadMe(); showPayStatus('تم تفعيل باقة ' + PLAN_NAMES[j.plan] + ' ✅', 'ok'); $('pay').hidden = true; }
    else if (j.status === 'rejected') { store.set('pending', ''); store.set('payref', ''); showPayStatus('تم رفض طلب الدفع. تواصل معنا على واتساب.', 'bad'); }
    else showPayStatus(`طلب ${PLAN_NAMES[p.plan]} (${p.ref}): قيد المراجعة`, 'pend');
  } catch {}
}
loadMe().then(checkPending); setInterval(checkPending, 60000);

// free counter is stored only on this device: let the owner reset it for testing
$('resetUsage').onclick = () => { store.set('used-' + monthKey(), 0); $('resetWrap').hidden = true; refreshUsage(); status('تم تصفير عداد الفيديوهات المجانية على جهازك.'); };
if (/[?&]reset=1/.test(location.search)) { store.set('used-' + monthKey(), 0); refreshUsage(); }
