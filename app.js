const TelegramBot = require('./modules/telegram-bot');

const cleanup = async (_) => {
    TelegramBot.stop()
}
// SIGINT is sent for example when you Ctrl+C a running process from the command line.
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// start the bot
TelegramBot.start();