const axios = require('axios');
require('dotenv').config();

class AlertsBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        this.alertsApiUrl = 'https://alerts.in.ua/api/states';
        this.telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;
        this.previousStates = new Map();
    }

    async getAlertsData() {
        try {
            console.log('📡 Проверяю alerts.in.ua...');
            const response = await axios.get(this.alertsApiUrl);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения данных:', error.message);
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
            console.log('✅ Сообщение отправлено в Telegram');
        } catch (error) {
            console.error('❌ Ошибка отправки в Telegram:', error.response?.data || error.message);
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
        
        if (!data || !data.states) {
            console.log('⚠️ Не удалось получить данные');
            return;
        }

        for (const region of data.states) {
            const regionId = region.id;
            const regionName = region.name;
            const isAlertActive = region.alert;
            const previousState = this.previousStates.get(regionId);
            
            if (previousState !== isAlertActive) {
                const message = this.createMessage(regionName, isAlertActive);
                await this.sendToTelegram(message);
                this.previousStates.set(regionId, isAlertActive);
                console.log(`📍 ${regionName}: ${isAlertActive ? '🚨 ТРИВОГА' : '✅ ВІДБІЙ'}`);
            }
        }
    }

    start() {
        console.log('🚀 Запуск бота оповещений...\n');
        console.log(`📢 Канал: ${this.channelId}`);
        console.log(`⏱️ Проверка каждые 30 секунд\n`);

        this.checkAlerts();

        setInterval(() => {
            this.checkAlerts();
        }, 30000);
    }
}

const bot = new AlertsBot();
bot.start();
