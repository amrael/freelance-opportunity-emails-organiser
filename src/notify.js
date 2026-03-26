// Telegram notification — reads bot token from OpenClaw config
const fs = require('fs');
const path = require('path');

const OPENCLAW_CONFIG = path.join(process.env.HOME, '.openclaw', 'openclaw.json');

function getTelegramConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    const botToken = config.channels?.telegram?.botToken;
    // User's Telegram ID from allowFrom
    const chatId = config.channels?.telegram?.allowFrom?.[0];
    return { botToken, chatId };
  } catch {
    return { botToken: null, chatId: null };
  }
}

async function notifyTelegram(message) {
  const { botToken, chatId } = getTelegramConfig();
  if (!botToken || !chatId) {
    console.log('Telegram notification skipped (no config)');
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error(`Telegram notification failed: ${err}`);
    }
  } catch (err) {
    console.error(`Telegram notification error: ${err.message}`);
  }
}

module.exports = { notifyTelegram };
