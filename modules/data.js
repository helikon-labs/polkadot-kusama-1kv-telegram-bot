/**
 * Database and Polkadot API access module..
 */
const fetch = require('node-fetch');
const logger = require('./logging');

const MongoDB = require('./mongodb');
const Polkadot = require('./polkadot');

let telegramConfig;

const w3fValidatorInfoBaseURL = 'https://kusama.w3f.community/candidate';

const ChatState = {
    IDLE: 'IDLE',
    ADD: 'ADD',
    REMOVE: 'REMOVE',
    VALIDATOR_INFO: 'VALIDATOR_INFO'
}

async function start(onNewBlock, onNewEra) {
    logger.info(`Get MongoDB connection.`);
    await MongoDB.connectMongoDB();
    logger.info(`Get Polkadot API connection.`);
    await Polkadot.connectPolkadot(onNewBlock, onNewEra);
    telegramConfig = await initTelegram();
}

async function stop() {
    logger.info(`Close MongoDB connection.`);
    await MongoDB.disconnectMongoDB();
    logger.info(`Close Polkadot connection.`);
    await Polkadot.disconnectPolkadot();
}

async function initTelegram() {
    let configCollection = await MongoDB.getTelegramConfigCollection();
    let telegramConfig = await configCollection.findOne({});
    if (!telegramConfig) {
        logger.info(`Telegram config not found in db, saving.`);
        let config = { updateOffset: 0 };
        await configCollection.insertOne(config);
        telegramConfig = await configCollection.findOne({});
    }
    return telegramConfig;
}

function getTelegramUpdateOffset() {
    return telegramConfig.updateOffset;
}

async function setTelegramUpdateOffset(updateOffset) {
    telegramConfig.updateOffset = updateOffset;
    let configCollection = await MongoDB.getTelegramConfigCollection();;
    await configCollection.updateOne(
        { },
        { $set: { updateOffset: updateOffset } }
    );
}

async function getChatById(chatId) {
    let chatCollection = await MongoDB.getChatCollection();
    return await chatCollection.findOne(
        { chatId: chatId }
    );
}

async function setChatState(chatId, state) {
    let chatCollection = await MongoDB.getChatCollection();
    await chatCollection.updateOne(
        { chatId: chatId },
        { $set: { state: state } }
    );
}

async function createChat(chatId) {
    let chatCollection = await MongoDB.getChatCollection();
    chat = {
        chatId: chatId,
        state: ChatState.IDLE
    };
    await chatCollection.insertOne(chat);
    return await getChatById(chatId);
}

async function fetchValidator(stashAddress) {
    logger.info(`Will fetch validator info for ${stashAddress}.`);
    const response = await fetch(w3fValidatorInfoBaseURL + '/' + stashAddress);
    if (response.status == 200) {
        const w3fValidator = await response.json();
        w3fValidator.isActiveInSet = await Polkadot.getIsActiveInSet(stashAddress);
        w3fValidator.commission = await Polkadot.getCommission(stashAddress);
        w3fValidator.sessionKeys = await Polkadot.getSessionKeys(stashAddress);
        return {
            validator: w3fValidator,
            status: response.status
        }
    } else {
        return { status: response.status }
    }
}

async function updateValidator(validator, updates) {
    let validatorCollection = await MongoDB.getValidatorCollection();
    updates.lastUpdated = new Date();
    return await validatorCollection.updateOne(
        { stashAddress: validator.stashAddress },
        { $set: updates }
    );
}

async function persistValidator(w3fValidator, chatId) {
    const validator = {
        name: w3fValidator.name,
        stashAddress: w3fValidator.stash,
        rank: w3fValidator.rank,
        discoveredAt: w3fValidator.discoveredAt,
        nominatedAt: w3fValidator.nominatedAt,
        onlineSince: w3fValidator.onlineSince,
        offlineSince: w3fValidator.offlineSince,
        offlineAccumulated: w3fValidator.offlineAccumulated,
        updated: w3fValidator.updated,
        version: w3fValidator.version,
        faults: w3fValidator.faults,
        invalidityReasons: w3fValidator.invalidityReasons,
        isActiveInSet: w3fValidator.isActiveInSet,
        commission: w3fValidator.commission,
        sessionKeys: w3fValidator.sessionKeys,
        chatIds: [chatId],
        lastUpdated: new Date()
    };
    const validatorCollection = await MongoDB.getValidatorCollection();
    const result = await validatorCollection.insertOne(validator);
    if (!result.result.ok || result.result.n != 1) {
        throw new Error(`Unexpected error: database insert was not successful.`);
    }
    return await validatorCollection.findOne({ stashAddress: validator.stashAddress });
}

async function removeValidator(validatorToRemove, chatId) {
    const validatorCollection = await MongoDB.getValidatorCollection();
    const chatIds = validatorToRemove.chatIds;
    const index = chatIds.indexOf(chatId);
    if (index > -1) {
        chatIds.splice(index, 1);
    }
    if (chatIds.length == 0) {
        logger.info(`Validator [${validatorToRemove.stashAddress}] has no more chats. Removing.`);
        const result = await validatorCollection.deleteOne({stashAddress: validatorToRemove.stashAddress});
        return result.result.ok && result.result.n == 1;
    } else {
        logger.info(`Validator [${validatorToRemove.stashAddress}] still has ${chatIds.length} more chats. Updating.`);
        const result = await validatorCollection.updateOne(
            { stashAddress: validatorToRemove.stashAddress },
            { $set: { chatIds: chatIds } }
        );
        return result.result.ok && result.result.n == 1;
    }
}

async function getValidatorByName(name) {
    const validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.findOne({ name: name });
}

async function getValidatorByStashAddress(stashAddress) {
    let validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.findOne({ stashAddress: stashAddress });
}

async function updateValidatorChatIds(validator, chatIds) {
    const validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.updateOne(
        { stashAddress: validator.stashAddress },
        { $set: { chatIds: chatIds } }
    );
}

async function getValidatorsForChat(chatId) {
    let validatorCollection = await MongoDB.getValidatorCollection();;
    return await validatorCollection.find({chatIds: {$elemMatch: {$eq: chatId}}}).toArray();
}

async function getAllValidators() {
    let validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.find({}).toArray();
}

module.exports = {
    ChatState: ChatState,
    start: start,
    stop: stop,
    setChatState: setChatState,
    fetchValidator: fetchValidator,
    persistValidator: persistValidator,
    removeValidator: removeValidator,
    getValidatorByName: getValidatorByName,
    getValidatorByStashAddress: getValidatorByStashAddress,
    updateValidatorChatIds: updateValidatorChatIds,
    setTelegramUpdateOffset: setTelegramUpdateOffset,
    getTelegramUpdateOffset: getTelegramUpdateOffset,
    getValidatorsForChat: getValidatorsForChat,
    getAllValidators: getAllValidators,
    updateValidator: updateValidator,
    getChatById: getChatById,
    createChat: createChat
}