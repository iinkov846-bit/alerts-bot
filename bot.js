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
            await axios.post(`${this.telegramApiUrl}/sendMessage`, {
                chat_id: this.channelId,
                text: text,
                parse_mode: 'HTML'
            });
            console.log('✅ Повідомлення відправлено в Telegram');
            return true;
        } catch (error) {
            console.error('❌ Помилка Telegram:', error.response?.data || error.message);
            return false;
        }
    }

    createMessage(locationName, isAlertActive) {
        const time = new Date().toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            hour: '2-digit',
            minute: '2-digit'
        });

        if (isAlertActive) {
            return `🚨 <b>ПОВІТРЯНА ТРИВОГА</b> 🚨\n\n📍 <b>${locationName}</b>\n⏰ ${time}`;
        } else {
            return `✅ <b>ВІДБІЙ ТРИВОГИ</b> ✅\n\n📍 <b>${locationName}</b>\n⏰ ${time}`;
        }
    }

    async checkAlerts() {
        const data = await this.getAlertsData();
        if (!data) return;

        const currentActive = new Set();

        if (data.oblasts && Array.isArray(data.oblasts)) {
            for (const item of data.oblasts) {
                currentActive.add(item.name);
                if (!this.previousActive.has(item.name)) {
                    await this.sendToTelegram(this.createMessage(item.name, true));
                }
            }
        }

        if (data.raions && Array.isArray(data.raions)) {
            for (const item of data.raions) {
                currentActive.add(item.name);
                if (!this.previousActive.has(item.name)) {
                    await this.sendToTelegram(this.createMessage(item.name, true));
                }
            }
        }

        if (!this.isFirstRun) {
            for (const prevLocation of this.previousActive) {
                if (!currentActive.has(prevLocation)) {
                    await this.sendToTelegram(this.createMessage(prevLocation, false));
                }
            }
        }

        this.previousActive = currentActive;
        this.isFirstRun = false;
    }

    start() {
        console.log('🚀 Запуск бота...');
        
        // ОТПРАВЛЯЕМ ТЕСТОВОЕ СООБЩЕНИЕ ПРЯМО СЕЙЧАС
        this.sendToTelegram("✅ <b>БОТ УСПЕШНО ЗАПУЩЕН!</b>\nЕсли ты видишь это сообщение — подключение к каналу работает корректно. Ожидаю изменений в тривогах...");

        console.log(`📢 Канал: ${this.channelId}`);
        console.log(`⏱️ Перевірка кожні 30 секунд`);

        this.checkAlerts().then(() => {
            console.log('✅ Базовий стан завантажено.\n');
        });

        setInterval(() => {
            this.checkAlerts();
        }, 30000);
    }
}

const bot = new AlertsBot();
bot.start();
