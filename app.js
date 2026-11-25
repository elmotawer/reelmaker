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
const DEFAULTS = { mtext: 'gemini-3.8-flash', mtts: 'gemini-3.8-flash-tts' };
let blob = null, blobUrl = null;

// ---------- storage (safe if blocked) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return (v === null || v === '') ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
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
  $('gkeyWrap').hidden = paid();
  $('acctIn').hidden = !me; $('acctOut').hidden = !!me;
  if (me) $('acctInfo').textContent = `${me.email} | الباقة: ${PLAN_NAMES[plan()]}` + (paid() ? ` | تنتهي ${new Date(me.planUntil).toLocaleDateString('ar-EG')}` : '');
  if (typeof updWarn === 'function') updWarn();
}

// ---------- settings ----------
function loadSettings() {
  $('gkey').value = store.get('gkey', '');
  $('mtext').value = store.get('mtext', DEFAULTS.mtext);
  $('mtts').value = store.get('mtts', DEFAULTS.mtts);
  $('ytid').value = store.get('ytid', '');
  refreshUsage();
}
function doSave(manual) {
  ['gkey', 'mtext', 'mtts', 'ytid'].forEach(k => { const v = $(k).value.trim(); if (v) store.set(k, v); else { try { localStorage.removeItem(k); } catch {} } });
  const ok = $('saved');
  if (ok) { ok.textContent = manual ? '✅ تم الحفظ' : '✅ تم الحفظ تلقائيا'; ok.hidden = false; clearTimeout(doSave.t); doSave.t = setTimeout(() => { ok.hidden = true; }, 4000); }
  if (manual) status('تم الحفظ');
}
(function () {
  const b = $('save'); let last = 0;
  const fire = e => { if (e && e.cancelable) e.preventDefault(); const n = Date.now(); if (n - last < 400) return; last = n; doSave(true); };
  b.addEventListener('click', fire); b.addEventListener('touchend', fire);
  ['gkey', 'mtext', 'mtts', 'ytid'].forEach(k => { const el = $(k); el.addEventListener('input', () => doSave(false)); el.addEventListener('change', () => doSave(false)); el.addEventListener('blur', () => doSave(false)); });
})();


function status(t) { const s = $('status'); s.hidden = false; s.textContent = t; }

// ---------- Gemini ----------
const TEXT_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
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
    for (let t = 0; t < 4; t++) {
      try { return await geminiOnce(list[mi], body); }
      catch (e) {
        last = e;
        const busy = !e.code || [429, 500, 502, 503, 504].includes(e.code);
        if (e.proxy && [401, 402, 403].includes(e.code)) throw new Error('مشكلة في حسابك أو باقتك (' + e.code + '). سجّل دخول تاني أو راجع الباقة.');
        if (e.proxy && e.code === 503 && /key_missing/.test(e.detail)) throw new Error('الخدمة غير جاهزة بعد، جرّب لاحقا.');
        if (!e.proxy && (e.code === 401 || e.code === 403) || (!e.proxy && e.code === 400 && /API key/i.test(e.detail || ''))) throw new Error('مفتاح Gemini غير صالح أو غير مفعّل. راجع الإعدادات.');
        if (!busy) break; // bad/unknown model: try the next one right away
        if (t < 3) { status('السيرفر مزدحم، بحاول تاني... (' + (t + 2) + '/4)'); await sleepMs(1500 * Math.pow(2, t)); }
      }
    }
    if (mi < list.length - 1) status('النموذج مشغول، بجرّب نموذج تاني...');
  }
  throw new Error('السيرفر مزدحم دلوقتي ومقدرتش أكمل. جرّب كمان دقيقة. (' + ((last && last.message) || '') + ')');
}
async function scriptChunk(idea, tone, n, prev, first, total) {
  const ctxt = prev.length ? ` المشاهد السابقة (لا تكررها وكمّل من بعدها): ${prev.slice(-4).join(' | ')}.` : '';
  const prompt = `اكتب ${first ? 'سيناريو' : 'تكملة سيناريو'} فيديو بالعربية الفصحى المبسطة أو بلهجة مفهومة للجميع. الفكرة: ${idea}. الأسلوب: ${tone}. ` +
    `إجمالي مشاهد الفيديو ${total}، المطلوب الآن ${n} مشهدا.${ctxt} كل مشهد جملتان قصيرتان على الأكثر (10 إلى 22 كلمة). ` +
    (first ? 'المشهد الأول خطاف قوي. ' : 'لا تضف خطافا جديدا. ') + (prev.length + n >= total ? 'المشهد الأخير دعوة للمتابعة. ' : 'لا تختم الفيديو بعد. ') +
    `أرجع JSON فقط بالشكل: {"title":"عنوان قصير","description":"وصف مع 3 هاشتاجات","scenes":["..."]}`;
  const j = await gemini(store.get('mtext', DEFAULTS.mtext), {
    contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' }
  }, TEXT_FALLBACKS);
  const out = JSON.parse(j.candidates[0].content.parts.map(p => p.text || '').join(''));
  if (!out.scenes || !out.scenes.length) throw new Error('سيناريو فارغ');
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
    all = all.concat(out.scenes.map(String).slice(0, n + 3));
  }
  return { title: head.title, description: head.description, scenes: all.slice(0, scenes) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function demoScript(idea, n) {
  const base = ['هل تعلم أن فكرتك تستحق فيديو؟', idea, 'ابدأ بخطوة صغيرة اليوم', 'كن مستمرا ولا تتوقف', 'شارك الفيديو مع صديق يحتاجه', 'تابعنا للمزيد من الأفكار'];
  const mid = base.slice(1, 5), sc = [base[0]]; while (sc.length < n - 1) sc.push(...mid); sc.length = Math.max(2, n - 1); sc.push(base[5]);
  return { title: idea.slice(0, 60), description: idea + ' #shorts #عربي #أفكار', scenes: sc };
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
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function drawFrame(ctx, scenes, bounds, t, total, theme, idx) {
  let i = bounds.findIndex(b => t < b); if (i < 0) i = scenes.length - 1;
  const start = i ? bounds[i - 1] : 0, p = (t - start) / (bounds[i] - start);
  const [c1, c2] = THEMES[theme], a = (i % 2 ? 1 : -1);
  const g = ctx.createLinearGradient(0, 0, W * (1 + 0.3 * Math.sin(i)), H); g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#fff';
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(W * ((k * 0.27 + i * 0.13 + a * p * 0.1) % 1), H * ((k * 0.19 + 0.1 + p * 0.08) % 1), 90 + k * 40, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, 10); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W * t / total, 10);
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 60px Tahoma, Arial, sans-serif';
  const lines = wrap(ctx, scenes[i], W - 120), lh = 90, y0 = H / 2 - (lines.length - 1) * lh / 2;
  const sc = 0.92 + 0.08 * Math.min(1, p * 6); ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
  ctx.globalAlpha = Math.min(1, 0.4 + p * 8);
  lines.forEach((l, k) => { ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(l, W / 2, y0 + k * lh); ctx.fillStyle = '#fff'; ctx.fillText(l, W / 2, y0 + k * lh); });
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.font = '28px Tahoma, Arial'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.direction = "ltr"; ctx.fillText(`${i + 1} / ${scenes.length}`, W / 2, H - 80);
}

// ---------- render to video (in browser) ----------
function pickMime() {
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
async function render(scenes, audioBuf, ctxA, theme, bounds) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const dur = audioBuf.duration + 0.6;
  const dest = ctxA.createMediaStreamDestination(), src = ctxA.createBufferSource(); src.buffer = audioBuf; src.connect(dest);
  const stream = cv.captureStream(FPS); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = pickMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: dur > 150 ? 2.5e6 : 4e6 } : {}), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(500); const t0 = ctxA.currentTime + 0.1; src.start(t0); drawFrame(c, scenes, bounds, 0, dur, theme);
  await new Promise(res => { (function tick() { const t = ctxA.currentTime - t0; if (t >= dur) return res(); drawFrame(c, scenes, bounds, Math.max(0, t), dur, theme); status(`جاري التصوير ${Math.round(100 * t / dur)}% (باقي ${fmt(dur - t)}) لا تقفل الشاشة`); requestAnimationFrame(tick); })(); });
  rec.stop(); await done;
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}

const fmt = x => { x = Math.max(0, Math.round(x)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
// ---------- main flow ----------
$('go').onclick = async () => {
  const idea = $('idea').value.trim(); if (!idea) return status('اكتب الفكرة أولا');
  if (used() >= limit()) return status('وصلت للحد الشهري للباقة. اختر باقة أعلى من قسم الباقات.');
  const secs = getSecs();
  if (secs > maxSecs()) return status(`باقتك (${PLAN_NAMES[plan()]}) تسمح بفيديو حتى ${maxSecs() / 60} دقيقة. اختر مدة أقصر أو باقة أعلى.`);
  if (paid()) {
    try {
      const r = await fetch(PAY_API + '/reel/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get('tok', '') }, body: JSON.stringify({ secs }) });
      const j = await r.json();
      if (!r.ok) return status(j.error === 'monthly_limit' ? 'وصلت للحد الشهري للباقة.' : j.error === 'too_long' ? 'المدة أطول من باقتك.' : j.error === 'plan_required' ? 'باقتك انتهت. جدّد من قسم الباقات.' : 'تعذر البدء، سجّل دخول تاني.');
      vid = j.vid; me = Object.assign(me, j.me); refreshUsage();
    } catch { return status('تعذر الاتصال بالسيرفر (ممكن بيصحى)، جرّب بعد دقيقة.'); }
  } else if (!store.get('gkey', '')) status('بدون مفتاح Gemini هيطلع فيديو تجريبي. أضف مفتاحك المجاني من الإعدادات.');
  const nScenes = secs <= 45 ? Math.round(secs / 5) : Math.ceil(secs / 8);
  W = $('orient').value === 'h' ? 1280 : 720; H = $('orient').value === 'h' ? 720 : 1280;
  $('go').disabled = true; $('result').hidden = true;
  let lock = null; try { if (secs > 60 && navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch {}
  try {
    status('جاري كتابة السيناريو...'); const s = await makeScript(idea, $('tone').value, nScenes);
    const ctxA = new (window.AudioContext || window.webkitAudioContext)();
    status('جاري توليد الصوت...'); const au = await makeAudioLong(s.scenes, $('voice').value, ctxA);
    blob = await render(s.scenes, au.buf, ctxA, +$('theme').value, au.bounds);
    if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(blob);
    $('player').src = blobUrl; $('title').value = s.title; $('desc').value = s.description;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; $('download').href = blobUrl; $('download').download = 'reel.' + ext;
    $('result').hidden = false; if (!paid()) store.set('used-' + monthKey(), used() + 1); refreshUsage(); status('تم! الفيديو جاهز.');
    window.__lastBlobSize = blob.size;
  } catch (e) { status('خطأ: ' + e.message); }
  if (lock) try { lock.release(); } catch {}
  $('go').disabled = false;
};
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
