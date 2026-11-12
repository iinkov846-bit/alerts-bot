const axios = require('axios');
require('dotenv').config();

class AlertsBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        // НОВЫЙ API — без ключа, работает сразу
        this.alertsApiUrl = 'https://ubilling.net.ua/aerialalerts/';
        this.telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;
        this.previousStates = new Map();
    }

    async getAlertsData() {
        try {
            console.log('📡 Проверяю тривоги...');
            const response = await axios.get(this.alertsApiUrl, {
                timeout: 15000,
                headers: { 'User-Agent': 'AlertsBot/1.0' }
            });
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
            return null;
        }
    }

    async sendToTelegram(text) {
        try {
            await axios.post(`${this.telegramApiUrl}/sendMessage`, {
                chat_id: this.channelId,
                text: text,
                parse_mode: 'HTML'
            });
            console.log('✅ Відправлено в Telegram');
        } catch (error) {
            console.error('❌ Telegram error:', error.response?.data || error.message);
        }
    }

    createMessage(regionName, isAlertActive) {
        const time = new Date().toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        if (isAlertActive) {
            return `🚨 <b>ПОВІТРЯНА ТРИВОГА</b> 🚨\n\n` +
                   `📍 <b>${regionName}</b>\n` +
                   `⏰ ${time}`;
        } else {
            return `✅ <b>ВІДБІЙ ТРИВОГИ</b> ✅\n\n` +
                   `📍 <b>${regionName}</b>\n` +
                   `⏰ ${time}`;
        }
    }

    async checkAlerts() {
        const data = await this.getAlertsData();

        // ubilling возвращает объект states, где ключ — название области
        if (!data || !data.states) {
            console.log('⚠️ Нет данных');
            return;
        }

        // Проходим по всем областям
        for (const [regionName, state] of Object.entries(data.states)) {
            const isAlertActive = !!state.alertnow;
            const previousState = this.previousStates.get(regionName);

            // Если состояние изменилось (и это НЕ первый запуск)
            if (previousState !== undefined && previousState !== isAlertActive) {
                const message = this.createMessage(regionName, isAlertActive);
                await this.sendToTelegram(message);
                console.log(`📍 ${regionName}: ${isAlertActive ? '🚨 ТРИВОГА' : '✅ ВІДБІЙ'}`);
            }

            // Сохраняем текущее состояние
            this.previousStates.set(regionName, isAlertActive);
        }
    }

    start() {
        console.log('🚀 Запуск бота оповещень...');
        console.log(`📢 Канал: ${this.channelId}`);
        console.log(`⏱️ Перевірка кожні 30 секунд\n`);

        // Первая проверка — только для инициализации (не шлёт в Telegram)
        this.checkAlerts().then(() => {
            console.log('✅ Базове стан завантажено\n');
        });

        // Далее — каждые 30 секунд
        setInterval(() => {
            this.checkAlerts();
        }, 30000);
    }
}

const bot = new AlertsBot();
bot.start();
