const axios = require('axios');
require('dotenv').config();

class AlertsBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        this.alertsApiUrl = 'https://neptun.in.ua/api/v1/alerts';
        this.telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;
        this.previousActive = new Set();
        this.isFirstRun = true;
        this.pendingAlerts = []; // Очередь изменений
        this.lastSendTime = 0; // Время последней отправки
        this.minInterval = 3000; // Минимум 3 секунды между сообщениями
    }

    async getAlertsData() {
        try {
            const response = await axios.get(this.alertsApiUrl, {
                timeout: 15000,
                headers: { 'User-Agent': 'AlertsBot/1.0' }
            });
            return response.data;
        } catch (error) {
            console.error('❌ Помилка запиту NEPTUN:', error.message);
            return null;
        }
    }

    async sendToTelegram(text) {
        try {
            // Ждем, если прошло меньше 3 секунд с последней отправки
            const now = Date.now();
            const timeSinceLastSend = now - this.lastSendTime;
            if (timeSinceLastSend < this.minInterval) {
                await new Promise(resolve => 
                    setTimeout(resolve, this.minInterval - timeSinceLastSend)
                );
            }

            await axios.post(`${this.telegramApiUrl}/sendMessage`, {
                chat_id: this.channelId,
                text: text,
                parse_mode: 'HTML'
            });
            this.lastSendTime = Date.now();
            console.log('✅ Повідомлення відправлено в Telegram');
            return true;
