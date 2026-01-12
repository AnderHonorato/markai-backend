const axios = require('axios');

async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) return;

  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
  };

  try {
    await axios.post('https://exp.host/--/api/v2/push/send', message);
  } catch (error) {
    console.error("Erro ao enviar push:", error);
  }
}

module.exports = { sendPushNotification };