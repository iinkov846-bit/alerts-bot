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
        this.lastSendTime = 0;
        this.minInterval = 3500;
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
        } catch (error) {
            console.error('❌ Помилка Telegram:', error.response?.data || error.message);
            return false;
        }
    }
    
    createGroupedMessage(alerts) {
        const time = new Date().toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            hour: '2-digit',
            minute: '2-digit'
        });

        const newAlerts = alerts.filter(a => a.isActive);
        const cancelledAlerts = alerts.filter(a => !a.isActive);

        let message = `📊 <b>ЗМІНИ ПОВІТРЯНИХ ТРИВОГ</b>\n⏰ ${time}\n\n`;

        if (newAlerts.length > 0) {
            message += `🚨 <b>ТРИВОГА ОГОЛОШЕНА:</b>\n`;
            newAlerts.forEach(alert => {
                message += `• ${alert.locationName}\n`;
            });
            message += `\n`;
        }

        if (cancelledAlerts.length > 0) {
            message += `✅ <b>ВІДБІЙ ТРИВОГИ:</b>\n`;
            cancelledAlerts.forEach(alert => {
                message += `• ${alert.locationName}\n`;
            });
        }

        return message;
    }

    async checkAlerts() {
        const data = await this.getAlertsData();
        if (!data) return;

        const currentActive = new Set();
        const changes = [];

        if (data.oblasts && Array.isArray(data.oblasts)) {
            for (const item of data.oblasts) {
                currentActive.add(item.name);
            }
        }

        if (data.raions && Array.isArray(data.raions)) {
            for (const item of data.raions) {
                currentActive.add(item.name);
            }
        }

        if (this.isFirstRun) {
            this.previousActive = currentActive;
            this.isFirstRun = false;
            console.log('✅ Базовий стан завантажено. Очікування змін...');
            return;
        }

        for (const location of currentActive) {
            if (!this.previousActive.has(location)) {
                changes.push({ locationName: location, isActive: true });
            }
        }

        for (const location of this.previousActive) {
            if (!currentActive.has(location)) {
                changes.push({ locationName: location, isActive: false });
            }
        }

        if (changes.length > 0) {
            const message = this.createGroupedMessage(changes);
            await this.sendToTelegram(message);
            console.log(`📝 Відправлено ${changes.length} змін`);
        }

        this.previousActive = currentActive;
    }

    start() {
        console.log('🚀 Запуск бота...');
        
        this.sendToTelegram("✅ <b>БОТ ЗАПУЩЕНО!</b>\nРадар тривог активний. Очікую змін...");

        console.log(`📢 Канал: ${this.channelId}`);
        console.log(`⏱️ Перевірка кожні 30 секунд\n`);

        this.checkAlerts();

        setInterval(() => {
            this.checkAlerts();
        }, 30000);
    }
}

const bot = new AlertsBot();
bot.start();
