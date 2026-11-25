'use strict';
const $ = id => document.getElementById(id);
const W = 720, H = 1280, FPS = 30;
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
function plan() { return store.get('plan', 'free'); }
function used() { return +store.get('used-' + monthKey(), 0); }
function refreshUsage() { $('usage').textContent = `الباقة: ${plan()} | المستخدم هذا الشهر: ${used()} من ${PLANS[plan()]}`; }

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
document.querySelectorAll('.pick').forEach(b => b.onclick = () => { store.set('plan', b.dataset.plan); refreshUsage(); });

function status(t) { const s = $('status'); s.hidden = false; s.textContent = t; }

// ---------- Gemini ----------
const TEXT_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
const TTS_FALLBACKS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
async function geminiOnce(model, body) {
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
        if (e.code === 401 || e.code === 403 || (e.code === 400 && /API key/i.test(e.detail || ''))) throw new Error('مفتاح Gemini غير صالح أو غير مفعّل. راجع الإعدادات.');
        if (!busy) break; // bad/unknown model: try the next one right away
        if (t < 3) { status('السيرفر مزدحم، بحاول تاني... (' + (t + 2) + '/4)'); await sleepMs(1500 * Math.pow(2, t)); }
      }
    }
    if (mi < list.length - 1) status('النموذج مشغول، بجرّب نموذج تاني...');
  }
  throw new Error('السيرفر مزدحم دلوقتي ومقدرتش أكمل. جرّب كمان دقيقة. (' + ((last && last.message) || '') + ')');
}
async function makeScript(idea, tone, scenes) {
  const key = store.get('gkey', '');
  if (!key) return demoScript(idea, scenes);
  const prompt = `اكتب سيناريو فيديو قصير (ريلز/شورتس) بالعربية الفصحى المبسطة أو بلهجة مفهومة للجميع. الفكرة: ${idea}. الأسلوب: ${tone}. ` +
    `عدد المشاهد: ${scenes}. كل مشهد جملة واحدة قصيرة (8 إلى 14 كلمة). المشهد الأول خطاف قوي يشد المشاهد، والأخير دعوة للمتابعة. ` +
    `أرجع JSON فقط بالشكل: {"title":"عنوان قصير","description":"وصف مع 3 هاشتاجات","scenes":["..."]}`;
  const j = await gemini(store.get('mtext', DEFAULTS.mtext), {
    contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' }
  }, TEXT_FALLBACKS);
  const txt = j.candidates[0].content.parts.map(p => p.text || '').join('');
  const out = JSON.parse(txt);
  if (!out.scenes || !out.scenes.length) throw new Error('سيناريو فارغ');
  return out;
}
function demoScript(idea, n) {
  const base = ['هل تعلم أن فكرتك تستحق فيديو؟', idea, 'ابدأ بخطوة صغيرة اليوم', 'كن مستمرا ولا تتوقف', 'شارك الفيديو مع صديق يحتاجه', 'تابعنا للمزيد من الأفكار'];
  return { title: idea.slice(0, 60), description: idea + ' #shorts #عربي #أفكار', scenes: base.slice(0, Math.max(3, Math.min(n, base.length))) };
}
async function makeAudio(text, voice, ctx) {
  const key = store.get('gkey', '');
  if (!key) { // demo: soft tone, 2.3s per scene-ish
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
async function render(scenes, audioBuf, ctxA, theme) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  const dur = audioBuf.duration + 0.6, lens = scenes.map(s => s.length), sum = lens.reduce((a, b) => a + b, 0);
  let acc = 0; const bounds = lens.map(l => (acc += l) / sum * audioBuf.duration); bounds[bounds.length - 1] = dur;
  const dest = ctxA.createMediaStreamDestination(), src = ctxA.createBufferSource(); src.buffer = audioBuf; src.connect(dest);
  const stream = cv.captureStream(FPS); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = pickMime(), rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : {}), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(500); const t0 = ctxA.currentTime + 0.1; src.start(t0); drawFrame(c, scenes, bounds, 0, dur, theme);
  await new Promise(res => { (function tick() { const t = ctxA.currentTime - t0; if (t >= dur) return res(); drawFrame(c, scenes, bounds, Math.max(0, t), dur, theme); status(`جاري التصوير ${Math.round(100 * t / dur)}%`); requestAnimationFrame(tick); })(); });
  rec.stop(); await done;
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}

// ---------- main flow ----------
$('go').onclick = async () => {
  const idea = $('idea').value.trim(); if (!idea) return status('اكتب الفكرة أولا');
  if (used() >= PLANS[plan()]) return status('وصلت للحد الشهري للباقة. اختر باقة أعلى من قسم الباقات.');
  $('go').disabled = true; $('result').hidden = true;
  try {
    status('جاري كتابة السيناريو...'); const s = await makeScript(idea, $('tone').value, +$('length').value);
    const ctxA = new (window.AudioContext || window.webkitAudioContext)();
    status('جاري توليد الصوت...'); const audio = await makeAudio(s.scenes.join('. '), $('voice').value, ctxA);
    blob = await render(s.scenes, audio, ctxA, +$('theme').value);
    if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(blob);
    $('player').src = blobUrl; $('title').value = s.title; $('desc').value = s.description;
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; $('download').href = blobUrl; $('download').download = 'reel.' + ext;
    $('result').hidden = false; store.set('used-' + monthKey(), used() + 1); refreshUsage(); status('تم! الفيديو جاهز.');
    window.__lastBlobSize = blob.size;
  } catch (e) { status('خطأ: ' + e.message); }
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
