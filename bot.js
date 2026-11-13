const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ALERTS_URL = 'https://neptun.in.ua/api/v1/alerts';
const THREATS_URL = 'https://neptun.in.ua/api/v1/threats';

const CHECK_INTERVAL = 30000;        // проверка каждые 30 сек
const MIN_SEND_INTERVAL = 3500;      // пауза между отправками
const MASS_ATTACK_THRESHOLD = 10;    // порог массовой атаки
const MSG_TTL = 60 * 60 * 1000;      // время жизни сообщения: 1 час
const QUEUE_FILE = '/data/msg-queue.json';

let lastSendTime = 0;
let isFirstRun = true;
let massAttackActive = false;

let knownAlerts = new Set();
let knownThreats = new Set();
let sentMessages = []; // { id: message_id, at: timestamp }

const HEADERS = { 'User-Agent': 'NEBO-MONITOR/2.1' };

const TYPE_META = {
    mig31k:    { emoji: '🛩', name: 'МіГ-31К — носій «Кинджалу»' },
    ballistic: { emoji: '🚀', name: 'Балістична ракета' },
    missile:   { emoji: '🚀', name: 'Крилата ракета' },
    kab:       { emoji: '💣', name: 'Керована авіабомба (КАБ)' },
    uav:       { emoji: '🛩', name: 'БПЛА (Шахед / дрон)' },
    recon:     { emoji: '🔍', name: 'Розвідувальний дрон' },
    unknown:   { emoji: '❓', name: 'Невідома загроза' }
};

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function degToCompass(deg) {
    if (deg === null || deg === undefined) return null;
    const dirs = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
}

// ---------- ОЧЕРЕДЬ СООБЩЕНИЙ (для автоочистки) ----------

function loadQueue() {
    try {
        if (fs.existsSync(QUEUE_FILE)) {
            sentMessages = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
            console.log('📦 Черга завантажена:', sentMessages.length);
        }
    } catch (e) {
        console.log('Queue load fail:', e.message);
    }
}

function saveQueue() {
    try {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(sentMessages));
    } catch (e) {
        // Нет Volume — работаем в памяти
    }
}

// Удаление сообщений старше 1 часа
async function cleanOldMessages() {
    const now = Date.now();
    const old = sentMessages.filter(m => now - m.at >= MSG_TTL);
    if (old.length === 0) return;

    sentMessages = sentMessages.filter(m => now - m.at < MSG_TTL);
    saveQueue();

    console.log('🧹 Видаляю повідомлень:', old.length);
    for (const m of old) {
        try {
            await axios.post('https://api.telegram.org/bot' + BOT_TOKEN + '/deleteMessage', {
                chat_id: CHANNEL_ID,
                message_id: m.id
            }, { timeout: 10000 });
        } catch (e) {
            // Сообщение уже удалено или недоступно — не критично
        }
    }
}

// ---------- ОТПРАВКА ----------

async function sendToTelegram(text) {
    const now = Date.now();
    const wait = lastSendTime + MIN_SEND_INTERVAL - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    try {
        const res = await axios.post('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
            chat_id: CHANNEL_ID,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }, { timeout: 10000 });

        lastSendTime = Date.now();

        // Запоминаем message_id для автоочистки
        const mid = res.data && res.data.result && res.data.result.message_id;
        if (mid) {
            sentMessages.push({ id: mid, at: Date.now() });
            saveQueue();
        }
        console.log('✅ Sent #' + mid);
    } catch (e) {
        console.error('❌ TG:', e.response ? JSON.stringify(e.response.data) : e.message);
    }
}

// ---------- УГРОЗЫ ----------

function threatMessage(t) {
    const meta = TYPE_META[t.type] || TYPE_META.unknown;

    if (t.type === 'mig31k') {
        return '🚨 <b>ЗЛІТ МІГ-31К — НОСІЙ «КИНДЖАЛУ»</b>\n' +
               '⏱ Час до можливого удару: 15-20 хв\n' +
               '🚨 <b>ТЕРМІНОВО В УКРИТТЯ!</b>';
    }

    let loc = t.locality || t.district || t.region || 'Україна';
    let msg = meta.emoji + ' <b>' + esc(meta.name) + '</b>\n📍 ' + esc(loc);
    if (t.region && t.locality && t.region !== t.locality) {
        msg += ', ' + esc(t.region);
    }
    if (t.advisory === true) {
        msg = '👀 <b>Спостереження</b> (не сигнал ховатися)\n' + msg;
    }
    if (!t.areaOnly && t.heading !== null && t.heading !== undefined) {
        msg += '\n🧭 Курс: ' + degToCompass(t.heading) + ' (' + t.heading + '°)';
    }
    if (t.velocity && t.velocity.speedKmh) {
        msg += '\n⚡ Швидкість: ' + t.velocity.speedKmh + ' км/год';
    }
    if (t.count && t.count > 1) {
        msg += '\n🔢 Кількість: ' + t.count;
    }
    if (t.explanationShort) {
        msg += '\n💬 ' + esc(t.explanationShort);
    }
    return msg;
}

async function handleThreats(threats) {
    const active = threats.filter(t => !t.status || t.status === 'active');
    const combat = active.filter(t => t.advisory !== true);

    if (!massAttackActive && combat.length >= MASS_ATTACK_THRESHOLD) {
        massAttackActive = true;
        if (!isFirstRun) {
            await sendToTelegram(
                '🔴🔴 <b>МАСОВАНА АТАКА</b> 🔴🔴\n' +
                '☠️ У повітрі загроз: ' + combat.length + '\n' +
                '🚨 <b>НЕ ІГНОРУЙТЕ СИРЕНИ! БУДЬТЕ В УКРИТТЯХ!</b>'
            );
        }
    } else if (massAttackActive && combat.length < MASS_ATTACK_THRESHOLD) {
        massAttackActive = false;
        if (!isFirstRun) {
            await sendToTelegram('🟠 Інтенсивність атаки знизилась. Загроз у повітрі: ' + combat.length + '. Залишайтесь обережними.');
        }
    }

    const newThreats = active.filter(t => !knownThreats.has(t.id));

    if (isFirstRun) {
        knownThreats = new Set(active.map(t => t.id));
        return;
    }

    knownThreats = new Set(active.map(t => t.id));

    for (const t of newThreats) {
        if (t.type === 'mig31k') {
            await sendToTelegram(threatMessage(t));
        }
    }

    const others = newThreats.filter(t => t.type !== 'mig31k');
    if (others.length > 0) {
        let text = '🛰 <b>НОВІ ЗАГРОЗИ У ПОВІТРІ (' + others.length + '):</b>\n\n';
        text += others.map(threatMessage).join('\n\n――――――――――\n\n');
        if (text.length > 4000) text = text.substring(0, 4000) + '\n…';
        await sendToTelegram(text);
    }
}

// ---------- ТРИВОГИ ----------

async function handleAlerts(data) {
    const current = new Set();
    if (data.oblasts) data.oblasts.forEach(o => current.add(o.name));
    if (data.raions) data.raions.forEach(r => current.add(r.name));

    if (isFirstRun) {
        knownAlerts = current;
        return;
    }

    const started = [];
    const ended = [];
    current.forEach(n => { if (!knownAlerts.has(n)) started.push(n); });
    knownAlerts.forEach(n => { if (!current.has(n)) ended.push(n); });

    if (started.length > 0 || ended.length > 0) {
        let text = '📊 <b>ЗМІНИ ПОВІТРЯНИХ ТРИВОГ</b>\n\n';
        if (started.length > 0) {
            text += '🚨 <b>ТРИВОГА:</b>\n' + started.map(n => '• ' + esc(n)).join('\n') + '\n';
        }
        if (ended.length > 0) {
            text += '✅ <b>ВІДБІЙ:</b>\n' + ended.map(n => '• ' + esc(n)).join('\n');
        }
        await sendToTelegram(text);
    }

    knownAlerts = current;
}

// ---------- ГЛАВНЫЙ ЦИКЛ ----------

async function check() {
    try {
        const tRes = await axios.get(THREATS_URL, { headers: HEADERS, timeout: 15000 });
        await handleThreats((tRes.data && tRes.data.threats) || []);
    } catch (e) {
        console.error('❌ threats fail:', e.message);
    }

    try {
        const aRes = await axios.get(ALERTS_URL, { headers: HEADERS, timeout: 15000 });
        await handleAlerts(aRes.data || {});
    } catch (e) {
        console.error('❌ alerts fail:', e.message);
    }

    if (isFirstRun) {
        isFirstRun = false;
        console.log('✅ Базовий стан завантажено. Моніторинг активний.');
    }
}

console.log('🛰 НЕБО.МОНІТОР v2.1 (з автоочищенням) запущено');
console.log('📢 Канал:', CHANNEL_ID ? 'OK' : 'MISSING');
console.log('🔑 Токен:', BOT_TOKEN ? 'OK' : 'MISSING');

loadQueue();
cleanOldMessages(); // сразу дочистить старое после рестарта
check();

setInterval(check, CHECK_INTERVAL);
setInterval(cleanOldMessages, 60000); // проверка очереди каждую минуту
