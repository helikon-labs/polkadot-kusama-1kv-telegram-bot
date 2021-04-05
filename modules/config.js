require('dotenv').config();
const args = require('yargs').argv;

const logger = require('./logging');

const kusamaEraLengthMins = 360;
const polkadotEraLengthMins = 1440;

const config = {
    version: '1.2.1',
    tokenTicker: null,
    mongoDBConnectionURL: process.env.MONGODB_CONNECTION_URL,
    dbName: process.env.DB_NAME,
    telegramBotAuthKey: process.env.TELEGRAM_BOT_AUTH_KEY,
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    // these fields get populated by the runtime config below
    networkName: '',
    network1KVInfoURL: '',
    rpcURL: '',
    w3fBaseURL: '',
    eraLengthMins: 0,
    approximateBlockTimeSecs: 6
};

const configure = () => {
    if (!args.network) {
        logger.error(`Please provide the network argument (e.g. --network=kusama).`);
        return false;
    } else if (args.network.toLowerCase() == 'polkadot') { // assume Polkadot when no args
        logger.info('Configuring for Polkadot.');
        config.networkName = 'Polkadot';
        config.network1KVInfoURL = 'https://polkadot.network/supporting-decentralization-join-the-polkadot-thousand-validators-programme/';
        config.rpcURL = process.env.POLKADOT_RPC_URL;
        config.w3fBaseURL = process.env.POLKADOT_W3F_BASE_URL;
        config.eraLengthMins = polkadotEraLengthMins;
        config.tokenTicker = 'DOT';
    } else if (args.network.toLowerCase() == 'kusama') {
        logger.info('Configuring for Kusama.');
        config.networkName = 'Kusama';
        config.network1KVInfoURL = 'https://polkadot.network/join-kusamas-thousand-validators-programme';
        config.rpcURL = process.env.KUSAMA_RPC_URL;
        config.w3fBaseURL = process.env.KUSAMA_W3F_BASE_URL;
        config.eraLengthMins = kusamaEraLengthMins;
        config.tokenTicker = 'KSM';
    } else {
        logger.error(`Unknown network ${args.network}. Exiting.`);
        return false;
    }
    return true;
}

module.exports = {
    configure: configure,
    config: config
}