/**
 * Polkadot RPC access module.
 * Adopted mostly from the Kusama 1KV leaderboard site.
 */
const{ ApiPromise, WsProvider } = require('@polkadot/api');
const { decodeAddress, encodeAddress } = require('@polkadot/keyring');
const { hexToU8a, isHex } = require('@polkadot/util');
const cron = require('node-cron');
require('dotenv').config({path:'../.env'});
const logger = require('./logging');

let api;
let lastEra = 0;
let onEraChange;

const isValidAddress = (address) => {
    try {
        encodeAddress(
            isHex(address)
                ? hexToU8a(address)
                : decodeAddress(address)
        );
        return true;
    } catch (error) {
        return false;
    }
};

async function getCurrentEra() {
    return await api.query.staking.currentEra();
}

async function payoutClaimedForAddressForEra(stashAddress, era) {
    const controllerAddress = await api.query.staking.bonded(stashAddress);
    const controllerLedger = await api.query.staking.ledger(controllerAddress.toString());
    const claimedEras = controllerLedger.toHuman().claimedRewards.map(
        x => parseInt(x.replace(',', ''))
    );
    if (claimedEras.includes(era)) {
        logger.info(`Payout for validator stash ${stashAddress} for era ${era} has already been issued.`);
        return true;
    }

    const exposureForEra = await api.query.staking.erasStakers(era, stashAddress);
    if (exposureForEra.total == 0) {
        logger.info(`Stash ${stashAddress} was not in the active validator set for era ${era}, no payout can be made.`);
        return true;
    }
    return false;
}

async function getIsActiveInSet(address) {
    const validators = await api.query.session.validators();
    return validators.includes(address);
}

async function getCommission(address) {
    return (await api.query.staking.validators(address)).toHuman().commission;
}

async function getSessionKeys(address) {
    const sessionKeys =  await api.query.session.nextKeys(address);
    const sessionKeyHex = await sessionKeys.toHex();
    return sessionKeyHex;
}

async function checkEraChange() {
    const currentEra = await getCurrentEra();
    if (currentEra > lastEra) {
        if (onEraChange) {
            onEraChange(currentEra);
        }
        lastEra = currentEra;
    }
}

async function connectPolkadot(onNewBlock, onNewEra) {
    const wsProvider = new WsProvider(process.env.POLKADOT_RPC_URL);
    api = new ApiPromise({ provider: wsProvider });
    await api.isReady;
    await api.derive.chain.subscribeNewHeads(onNewBlock);
    onEraChange = onNewEra;
    await checkEraChange();
    cron.schedule('*/20 * * * *', () => {
        checkEraChange();
    });
}

const disconnectPolkadot = async () => {
    if (api) {
        logger.info('Close Polkadot API connection.');
        await api.disconnect();
    }
};

module.exports = {
    isValidAddress: isValidAddress,
    connectPolkadot: connectPolkadot,
    disconnectPolkadot: disconnectPolkadot,
    getIsActiveInSet: getIsActiveInSet,
    getCommission: getCommission,
    getSessionKeys: getSessionKeys,
    getCurrentEra: getCurrentEra,
    payoutClaimedForAddressForEra: payoutClaimedForAddressForEra
}