// ===== JD 2026 — Email sender via Gmail =====
//
// This file is the source of truth for the Apps Script project. It is NOT served
// by the website (see the "ignore" list in firebase.json) — copy it into the Apps
// Script editor and redeploy whenever it changes.
//
// ⚠️ REDEPLOY: saving the code is not enough. The /exec URL keeps running the last
// DEPLOYED version. After pasting: Deploy → Manage deployments → ✏️ Edit →
// Version: New version → Deploy.
//
// ---------------------------------------------------------------------------
// Two jobs live here:
//
//   1. doPost()    — the website asks for one email to be sent, right now.
//   2. drainQueue() — an hourly time-driven trigger that picks up the emails the
//                     website could NOT send (Gmail's daily cap) out of the
//                     Firestore `mail_queue` collection and sends them.
//
// WHY A QUEUE: a consumer Gmail account can send to at most 100 recipients per
// day and that ceiling cannot be raised. When ~100 employees fill in a JD on the
// same day the cap is reached mid-batch. Instead of losing those emails (and
// telling the user to "try again", which can never work), the website writes them
// to Firestore and this script drains the backlog as quota frees up.
// ---------------------------------------------------------------------------

// กันบอทสุ่มยิง: ตั้ง token อะไรก็ได้ แล้วให้ frontend ส่งค่าเดียวกันมา
const SHARED_SECRET = 'jd2026-b8151ae17e08ed1bd62ebe1982f65197';

// โดเมนเว็บจริง (ปิดท้ายด้วย /) ลิงก์ในอีเมลต้องเป็น URL เต็มถึงจะกดได้
const BASE_URL = 'https://jd-online-colossal.web.app/';

// Firestore collection holding the emails that still have to go out.
const QUEUE_COLLECTION = 'mail_queue';

// How many queued emails one trigger run may send. Kept below the daily cap so a
// single run can never eat the whole quota — leaves room for people using the
// form live, whose emails matter more than a backlog item.
const DRAIN_BATCH_LIMIT = 60;

// Stop retrying a queue entry after this many failures so one permanently bad
// address cannot be retried hourly forever.
const MAX_QUEUE_ATTEMPTS = 5;

// Apps Script kills any execution that runs longer than 6 minutes. Being killed
// mid-loop is worse than stopping early: a message can be sent and then lose its
// "SENT" write, which would make the next run send it a second time. Stop well
// before the ceiling and let the next hourly run continue the backlog.
const DRAIN_TIME_BUDGET_MS = 4 * 60 * 1000;


// ═══════════════════════════ Web app entry points ═══════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.token !== SHARED_SECRET) {
      return json({ ok: false, code: 'UNAUTHORIZED', error: 'unauthorized' });
    }

    // The website asks "how many emails can I still send today?" through the same
    // POST endpoint rather than doGet, because a text/plain POST is the one shape
    // that reaches Apps Script without a CORS preflight it cannot answer.
    if (data.action === 'quota') {
      return json({ ok: true, remaining: remainingQuota() });
    }

    // Idempotency: the website retries when a response does not come back, but a
    // missing response does not mean the mail was not sent — Apps Script may have
    // delivered it and then failed to answer in time. Every retry carries the same
    // msg_id, so a repeat is answered with the first result instead of sending a
    // second copy (which would also burn another slot of the 100/day allowance).
    const msgId = String(data.msg_id || '');
    const cache = CacheService.getScriptCache();
    const cacheKey = msgId ? 'sent_' + msgId : '';

    if (cacheKey && cache.get(cacheKey)) {
      return json({ ok: true, deduped: true, remaining: remainingQuota() });
    }

    const result = sendOne({
      to: data.to,
      subject: data.subject,
      requesterName: data.requester_name,
      reviewUrl: data.review_url,
      accessCode: data.access_code
    });

    // Remember it only once the mail actually went out: a failed attempt must stay
    // retriable, otherwise a transient error would silently swallow the message.
    if (cacheKey && result.ok) cache.put(cacheKey, '1', 600); // 10 minutes

    return json(result);
  } catch (err) {
    return json({ ok: false, code: 'SCRIPT_ERROR', error: String(err), remaining: remainingQuota() });
  }
}

// เผื่อเปิด URL ตรงๆ ใน browser — ใช้เช็คโควตาคงเหลือได้เลยโดยไม่ต้องเปิด Apps Script
function doGet() {
  return json({ ok: true, msg: 'JD 2026 mailer is running', remaining: remainingQuota() });
}


// ═══════════════════════════ Sending ═══════════════════════════

// Send exactly one email. Returns the same {ok, code, remaining} shape to both
// callers (doPost and drainQueue) so failure handling lives in one place.
//
// `code` tells the caller what to DO about a failure, which matters because the
// three cases need opposite responses:
//   QUOTA_EXCEEDED — nothing is wrong with the message; queue it for tomorrow.
//   BAD_RECIPIENT  — the address can never work; queueing would retry forever.
//   SEND_FAILED    — transient; worth another go.
function sendOne(msg) {
  const rawTo = msg.to || '';
  const to = cleanEmail(rawTo);

  if (!to) {
    return { ok: false, code: 'BAD_RECIPIENT', error: 'ไม่ได้ระบุอีเมลปลายทาง', remaining: remainingQuota() };
  }
  if (!isPlainEmail(to)) {
    return {
      ok: false,
      code: 'BAD_RECIPIENT',
      error: 'อีเมลปลายทางไม่ถูกต้อง: "' + rawTo + '" (ต้องเป็นตัวอักษรภาษาอังกฤษ/ตัวเลขเท่านั้น ห้ามมีอักขระพิเศษหรือช่องว่าง)',
      remaining: remainingQuota()
    };
  }

  // Check BEFORE calling Gmail. GmailApp throws a generic exception when the cap
  // is hit, which is indistinguishable from a real error — asking first is what
  // lets us tell the user "saved, will send tomorrow" instead of "try again".
  const remaining = remainingQuota();
  if (remaining <= 0) {
    return { ok: false, code: 'QUOTA_EXCEEDED', error: 'โควตาส่งอีเมลของวันนี้เต็มแล้ว', remaining: 0 };
  }

  // ทำลิงก์ให้เป็น URL เต็มเสมอ (review_url ที่ส่งมาเป็น relative เช่น approval.html?id=...)
  let reviewUrl = (msg.reviewUrl || '').toString();
  if (reviewUrl && !/^https?:\/\//i.test(reviewUrl)) {
    reviewUrl = BASE_URL + reviewUrl.replace(/^\/+/, '');
  }

  const requester = msg.requesterName || '';
  const code = (msg.accessCode || '').toString();
  const subject = msg.subject || 'JD Document';

  const plain = [
    'Job Description รอการตรวจสอบ/ลงนาม' + (requester ? ' จากคุณ ' + requester : ''),
    reviewUrl ? 'เปิดเอกสาร: ' + reviewUrl : '',
    code ? 'รหัสเข้าถึงเอกสาร: ' + code : ''
  ].filter(String).join('\n\n');

  try {
    GmailApp.sendEmail(to, subject, plain, {
      htmlBody: buildEmailHtml(requester, reviewUrl, code),
      name: 'JD Online System'
    });
  } catch (err) {
    // Gmail still refused. Most likely the cap was crossed between our check and
    // the send (another tab sending at the same time), so treat a quota-shaped
    // message as queueable rather than as a hard failure.
    const text = String(err);
    const quotaish = /quota|limit|service invoked too many/i.test(text);
    return {
      ok: false,
      code: quotaish ? 'QUOTA_EXCEEDED' : 'SEND_FAILED',
      error: text,
      remaining: remainingQuota()
    };
  }

  return { ok: true, remaining: remainingQuota() };
}

function remainingQuota() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (err) {
    return -1; // unknown — callers treat a negative value as "don't block on this"
  }
}

// ดูโควตาคงเหลือแบบเร็ว: กด Run ฟังก์ชันนี้แล้วดูที่ Execution log
function checkQuota() {
  Logger.log('เหลือส่งได้อีก ' + remainingQuota() + ' ฉบับ');
}


// ═══════════════════════════ Recipient guard ═══════════════════════════

// อีเมลที่ผู้ใช้ paste มามักมีอักขระล่องหนติดมาด้วย (zero-width space, soft hyphen,
// combining mark) ซึ่งมองไม่เห็นบนหน้าจอแต่ทำให้ To: header มี byte นอก ASCII
// → Gmail ปฏิเสธทั้งฉบับด้วย "An error occurred. Your message was not sent."
// ตัดอักขระกลุ่มนี้ทิ้งก่อน แล้วค่อยตรวจ ตัวอักษรจริง ๆ (เช่นภาษาไทย) จะไม่ถูกตัด
// แต่จะไม่ผ่าน isPlainEmail() แทน
function cleanEmail(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')                              // control chars
    .replace(/[\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g, '') // invisible / bidi
    .replace(/[\u0300-\u036F\u0335]/g, '')                              // combining marks
    .trim();
}

// ASCII ล้วนและเป็นรูปแบบอีเมลจริง — เข้มกว่า regex ฝั่งหน้าเว็บที่ยอมรับทุกอย่างที่ไม่ใช่ช่องว่าง
function isPlainEmail(v) {
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(v);
}


// ═══════════════════════════ Queue drainer ═══════════════════════════

// Runs on the hourly trigger. Pulls PENDING rows out of Firestore and sends what
// today's remaining quota allows, highest priority first (employee signing links
// block a person's work; approver/HR digests do not).
function drainQueue() {
  const remaining = remainingQuota();
  if (remaining === 0) {
    Logger.log('drainQueue: โควตาหมด ยังไม่ส่ง');
    heartbeat({ ok: true, sent: 0, failed: 0, note: 'โควตาของวันนี้เต็มแล้ว รอส่งวันถัดไป' });
    return;
  }

  let rows;
  try {
    rows = fsQueryPending(DRAIN_BATCH_LIMIT);
  } catch (err) {
    Logger.log('drainQueue: อ่าน Firestore ไม่สำเร็จ — ' + err);
    // Best effort: if Firestore is unreachable this write fails too, and the admin
    // console will show a stale timestamp — which is itself the correct signal.
    heartbeat({ ok: false, sent: 0, failed: 0, note: 'อ่าน Firestore ไม่สำเร็จ: ' + String(err).slice(0, 200) });
    return;
  }
  if (!rows.length) {
    Logger.log('drainQueue: ไม่มีคิวค้าง');
    heartbeat({ ok: true, sent: 0, failed: 0, note: 'ไม่มีคิวค้าง' });
    return;
  }

  // Lower priority number = more urgent. Oldest first within the same priority.
  rows.sort(function (a, b) {
    const p = (a.priority || 5) - (b.priority || 5);
    return p !== 0 ? p : String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });

  let sent = 0, failed = 0, budget = remaining < 0 ? DRAIN_BATCH_LIMIT : remaining;
  let outOfTime = false;
  const startedAt = Date.now();

  for (const row of rows) {
    if (budget <= 0) break;
    if (Date.now() - startedAt > DRAIN_TIME_BUDGET_MS) { outOfTime = true; break; }

    const result = sendOne({
      to: row.to,
      subject: row.subject,
      requesterName: row.requesterName,
      reviewUrl: row.reviewUrl,
      accessCode: row.accessCode
    });

    if (result.ok) {
      fsPatch(row.name, { status: 'SENT', sentAt: nowIso(), lastError: '', lastCode: '' });
      sent++;
      budget--;
      continue;
    }

    if (result.code === 'QUOTA_EXCEEDED') break; // ไม่นับเป็นความล้มเหลว ไว้รอบหน้า

    const attempts = (row.attempts || 0) + 1;
    fsPatch(row.name, {
      status: attempts >= MAX_QUEUE_ATTEMPTS ? 'FAILED' : 'PENDING',
      attempts: attempts,
      lastError: String(result.error || '').slice(0, 500),
      lastCode: result.code || 'SEND_FAILED'
    });
    failed++;
  }

  const note = 'ส่งสำเร็จ ' + sent + ' ฉบับ' +
               (failed ? ' • ส่งไม่สำเร็จ ' + failed + ' ฉบับ' : '') +
               (outOfTime ? ' • หยุดเพราะครบเวลา 4 นาที รอบถัดไปจะส่งต่อ' : '');

  Logger.log('drainQueue: ' + note + ' เหลือโควตา ' + remainingQuota());
  heartbeat({ ok: failed === 0, sent: sent, failed: failed, note: note });
}

// ───────────────────── Heartbeat ─────────────────────
// The trigger is invisible: nobody can tell whether it ran, stopped, or was never
// installed. So every run stamps app_config/mailer_status, and admin.html reads it
// — a timestamp that stops advancing is the signal that the trigger is dead.
//
// Written with the same PATCH used for queue rows; Firestore creates the document
// on first write, so there is nothing to seed by hand.
function heartbeat(info) {
  try {
    fsPatch(fsDocName('app_config/mailer_status'), {
      lastRunAt: nowIso(),
      lastOk: info.ok === true,
      lastSent: info.sent || 0,
      lastFailed: info.failed || 0,
      lastRemaining: remainingQuota(),
      lastNote: String(info.note || '').slice(0, 300)
    });
  } catch (err) {
    Logger.log('heartbeat: เขียนสถานะไม่สำเร็จ — ' + err);
  }
}

// รันครั้งเดียวเพื่อติดตั้ง trigger รายชั่วโมง (กด Run แล้วอนุญาตสิทธิ์)
// รันซ้ำได้ ของเดิมจะถูกลบก่อนเสมอ จึงไม่เกิด trigger ซ้อน
function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'drainQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('drainQueue').timeBased().everyHours(1).create();
  Logger.log('ติดตั้ง trigger รายชั่วโมงเรียบร้อย');
}


// ═══════════════════════════ Firestore REST ═══════════════════════════
//
// SETUP (ทำครั้งเดียว) — Apps Script → ⚙️ Project Settings → Script Properties →
// Add script property ทีละตัว:
//
//   FIREBASE_PROJECT_ID   jd-online-2026
//   FIREBASE_CLIENT_EMAIL firebase-adminsdk-fbsvc@jd-online-2026.iam.gserviceaccount.com
//   FIREBASE_PRIVATE_KEY  -----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
//
// ค่า FIREBASE_PRIVATE_KEY ให้ copy มาจากไฟล์ .json ของ service account "ทั้งค่า
// ตามที่เห็นในไฟล์" รวม \n ที่เป็นตัวอักษรสองตัว ไม่ต้องแปลงอะไร — โค้ดข้างล่างแปลงให้เอง
//
// ⚠️ ห้าม hardcode private key ไว้ในไฟล์นี้ เพราะไฟล์นี้อยู่ใน git

function fsProps() {
  const p = PropertiesService.getScriptProperties();
  const projectId = p.getProperty('FIREBASE_PROJECT_ID');
  const clientEmail = p.getProperty('FIREBASE_CLIENT_EMAIL');
  const privateKey = (p.getProperty('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Properties ของ Firebase (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)');
  }
  return { projectId: projectId, clientEmail: clientEmail, privateKey: privateKey };
}

// Service-account OAuth token, cached for 50 minutes (they are valid for 60).
// A service account bypasses Firestore security rules, which is exactly why
// mail_queue can stay admin-only readable for browsers.
function fsToken() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fs_token');
  if (hit) return hit;

  const props = fsProps();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: props.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const b64 = function (s) {
    return Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  };
  const signingInput = b64(JSON.stringify(header)) + '.' + b64(JSON.stringify(claim));
  const signature = Utilities.computeRsaSha256Signature(signingInput, props.privateKey);
  const jwt = signingInput + '.' + Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  const body = JSON.parse(res.getContentText());
  if (!body.access_token) {
    throw new Error('ขอ access token ไม่สำเร็จ: ' + res.getContentText().slice(0, 300));
  }

  cache.put('fs_token', body.access_token, 3000);
  return body.access_token;
}

function fsBaseUrl() {
  return 'https://firestore.googleapis.com/v1/' + fsDocName('');
}

// Resource name of a document, e.g. "app_config/mailer_status" →
// "projects/<id>/databases/(default)/documents/app_config/mailer_status".
// This is what fsPatch takes: runQuery hands back names in exactly this form, so
// patching a query result and patching a known path go through the same code.
function fsDocName(path) {
  const base = 'projects/' + fsProps().projectId + '/databases/(default)/documents';
  return path ? base + '/' + path : base;
}

// อ่านคิวที่ยังไม่ได้ส่ง — ใช้ equality filter ตัวเดียวเพื่อให้ใช้ single-field index
// อัตโนมัติของ Firestore ไม่ต้องสร้าง composite index เพิ่ม (การเรียงลำดับทำในหน่วยความจำ)
function fsQueryPending(limit) {
  const res = UrlFetchApp.fetch(fsBaseUrl() + ':runQuery', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + fsToken() },
    payload: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: QUEUE_COLLECTION }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'PENDING' }
          }
        },
        limit: limit
      }
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('runQuery ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }

  // A runQuery response always returns at least one element; entries with no
  // `document` key are read-time markers, not results.
  return JSON.parse(res.getContentText())
    .filter(function (r) { return r.document; })
    .map(function (r) {
      const row = fromFsFields(r.document.fields || {});
      row.name = r.document.name; // full resource path, used by fsPatch
      return row;
    });
}

// เขียนทับเฉพาะฟิลด์ที่ระบุ (updateMask) เพื่อไม่ให้ข้อมูลอื่นในเอกสารหาย
function fsPatch(docName, fields) {
  const mask = Object.keys(fields)
    .map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); })
    .join('&');

  const res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + docName + '?' + mask, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + fsToken() },
    payload: JSON.stringify({ fields: toFsFields(fields) }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('fsPatch ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
}

// Firestore REST wraps every value in a type tag — these two convert both ways.
function fromFsFields(fields) {
  const out = {};
  Object.keys(fields).forEach(function (k) {
    const v = fields[k];
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('nullValue' in v) out[k] = null;
    else out[k] = null;
  });
  return out;
}

function toFsFields(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === 'number') out[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (k.endsWith('At') && /^\d{4}-\d{2}-\d{2}T/.test(v)) out[k] = { timestampValue: v };
    else out[k] = { stringValue: String(v) };
  });
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

// ตรวจว่าเชื่อม Firestore ได้จริงไหม — กด Run แล้วดู Execution log
// ควรรันอันนี้ให้ผ่านก่อนติดตั้ง trigger
function testFirestore() {
  const rows = fsQueryPending(5);
  Logger.log('เชื่อมต่อ Firestore สำเร็จ — มีคิวค้าง (แสดงสูงสุด 5): ' + rows.length);
  rows.forEach(function (r) {
    Logger.log('  → ' + r.to + ' | ' + r.kind + ' | priority ' + r.priority);
  });
}


// ═══════════════════════════ Email template ═══════════════════════════
// table + inline style เพื่อให้แสดงถูกใน Gmail/Outlook

function buildEmailHtml(requester, reviewUrl, code) {
  const codeBlock = code
    ? '<tr><td style="padding:8px 32px 0">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
          'style="background:#f4f7ff;border:1px dashed #b9c8f0;border-radius:12px">' +
          '<tr><td style="padding:18px 20px;text-align:center">' +
            '<div style="font-size:12px;color:#6b7785;letter-spacing:.4px;' +
              'text-transform:uppercase;margin-bottom:8px">รหัสเข้าถึงเอกสาร</div>' +
            '<div style="font-family:\'Courier New\',monospace;font-size:30px;font-weight:700;' +
              'letter-spacing:8px;color:#1f2733">' + escapeHtml(code) + '</div>' +
            '<div style="font-size:12px;color:#8a94a3;margin-top:8px">' +
              'กรอกรหัสนี้เมื่อเปิดเอกสารเพื่อยืนยันตัวตน</div>' +
          '</td></tr>' +
        '</table>' +
      '</td></tr>'
    : '';

  const ctaBlock = reviewUrl
    ? '<tr><td style="padding:24px 32px 8px;text-align:center">' +
        '<a href="' + reviewUrl + '" ' +
          'style="background:linear-gradient(135deg,#2f80ed,#4f46e5);color:#ffffff;' +
          'padding:14px 38px;text-decoration:none;border-radius:10px;display:inline-block;' +
          'font-size:15px;font-weight:700;box-shadow:0 6px 16px rgba(47,128,237,.35)">' +
          'เปิดเอกสาร →</a>' +
      '</td></tr>' +
      '<tr><td style="padding:4px 32px 0;text-align:center">' +
        '<span style="color:#9aa3b2;font-size:12px">หรือคัดลอกลิงก์นี้:<br>' +
        '<a href="' + reviewUrl + '" style="color:#2f80ed;word-break:break-all">' +
          reviewUrl + '</a></span>' +
      '</td></tr>'
    : '';

  return '' +
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef2f7">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background:#eef2f7;padding:32px 12px">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
        'style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;' +
        'box-shadow:0 12px 30px rgba(20,40,80,.10)">' +

        '<tr><td style="background:linear-gradient(135deg,#2f80ed,#4f46e5);' +
          'padding:30px 32px;text-align:center">' +
          '<div style="font-size:30px;line-height:1"></div>' +
          '<div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:8px">' +
            'Job Description</div>' +
          '<div style="color:#dbe6ff;font-size:13px;margin-top:2px">' +
            'รอการตรวจสอบและลงนาม</div>' +
        '</td></tr>' +

        '<tr><td style="padding:28px 32px 4px;font-family:Arial,sans-serif;' +
          'font-size:15px;color:#2b3340;line-height:1.7">' +
          '<p style="margin:0 0 10px">เรียน ผู้เกี่ยวข้อง,</p>' +
          '<p style="margin:0">มีเอกสาร <b>Job Description</b> รอการตรวจสอบ/ลงนาม' +
            (requester ? ' จากคุณ <b>' + escapeHtml(requester) + '</b>' : '') +
            ' กรุณาคลิกปุ่มด้านล่างเพื่อดำเนินการ</p>' +
        '</td></tr>' +

        codeBlock +
        ctaBlock +

        '<tr><td style="padding:26px 32px 28px">' +
          '<hr style="border:none;border-top:1px solid #eef1f6;margin:0 0 14px">' +
          '<p style="margin:0;color:#9aa3b2;font-size:12px;line-height:1.6;' +
            'font-family:Arial,sans-serif">อีเมลนี้ส่งจากระบบ JD Online โดยอัตโนมัติ ' +
            'หากคุณไม่ได้เกี่ยวข้องกับเอกสารนี้ กรุณาเพิกเฉย</p>' +
        '</td></tr>' +

      '</table>' +
    '</td></tr>' +
  '</table></body></html>';
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
