const axios = require('axios');
require('dotenv').config();

class AlertsBot {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        // НОВЫЙ API: NEPTUN (официальные тривоги, без ключа)
        this.alertsApiUrl = 'https://neptun.in.ua/api/v1/alerts';
        this.telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;
        
        // Храним названия регионов, где СЕЙЧАС активна тривога
        this.previousActive = new Set();
        this.isFirstRun = true;
    }

    async getAlertsData() {
        try {
            console.log('📡 Запит до NEPTUN API...');
            const response = await axios.get(this.alertsApiUrl, {
                timeout: 15000,
                headers: { 'User-Agent': 'AlertsBot/1.0' }
            });
            return response.data;
        } catch (error) {
            console.error('❌ Помилка запиту:', error.message);
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
        } catch (error) {
            console.error('❌ Помилка Telegram:', error.response?.data || error.message);
        }
    }

    createMessage(locationName, isAlertActive) {
        const time = new Date().toLocaleString('uk-UA', {
            timeZone: 'Europe/Kiev',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        if (isAlertActive) {
            return `🚨 <b>ПОВІТРЯНА ТРИВОГА</b> 🚨\n\n` +
                   `📍 <b>${locationName}</b>\n` +
                   `⏰ ${time}`;
        } else {
            return `✅ <b>ВІДБІЙ ТРИВОГИ</b> ✅\n\n` +
                   `📍 <b>${locationName}</b>\n` +
                   `⏰ ${time}`;
        }
    }

    async checkAlerts() {
        const data = await this.getAlertsData();
        if (!data) return;

        const currentActive = new Set();

        // 1. Обробляємо області
        if (data.oblasts && Array.isArray(data.oblasts)) {
            for (const item of data.oblasts) {
                const locationName = item.name; // наприклад, "Одеська область"
                currentActive.add(locationName);
                
                // Якщо тривоги не було, а тепер є
                if (!this.previousActive.has(locationName)) {
                    await this.sendToTelegram(this.createMessage(locationName, true));
                    console.log(`🚨 Тривога: ${locationName}`);
                }
            }
        }

        // 2. Обробляємо райони
        if (data.raions && Array.isArray(data.raions)) {
            for (const item of data.raions) {
                const locationName = item.name; // наприклад, "Одеський район"
                currentActive.add(locationName);
                
                if (!this.previousActive.has(locationName)) {
                    await this.sendToTelegram(this.createMessage(locationName, true));
                    console.log(`🚨 Тривога: ${locationName}`);
                }
            }
        }

        // 3. Перевіряємо на ВІДБІЙ (ті, що були раніше, але зникли зі списку)
        if (!this.isFirstRun) {
            for (const prevLocation of this.previousActive) {
                if (!currentActive.has(prevLocation)) {
                    await this.sendToTelegram(this.createMessage(prevLocation, false));
                    console.log(`✅ Відбій: ${prevLocation}`);
                }
            }
        }

        // 4. Оновлюємо стан
        this.previousActive = currentActive;
        this.isFirstRun = false;
    }

    start() {
        console.log('🚀 Запуск бота оповещень (NEPTUN API)...');
        console.log(`📢 Канал: ${this.channelId}`);
        console.log(`⏱️ Перевірка кожні 30 секунд\n`);

        // Перша перевірка для ініціалізації стану (не шле повідомлення про відбій)
        this.checkAlerts().then(() => {
            console.log('✅ Базовий стан завантажено. Очікування змін...\n');
        });

        // Подальші перевірки
        setInterval(() => {
            this.checkAlerts();
        }, 30000); // 30 секунд (NEPTUN рекомендує не частіше 5 сек, 30 - ідеально)
    }
}

const bot = new AlertsBot();
bot.start();
