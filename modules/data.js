/**
 * Database and Polkadot API access module..
 */
const fetch = require('node-fetch');
const logger = require('./logging');
const config = require('./config').config;

const MongoDB = require('./mongodb');
const Polkadot = require('./polkadot');

let telegramConfig;

const ChatState = {
    IDLE: 'IDLE',
    ADD: 'ADD',
    REMOVE: 'REMOVE',
    VALIDATOR_INFO: 'VALIDATOR_INFO',
    STAKING_INFO_LOADING: 'STAKING_INFO_LOADING',
    STAKING_INFO_SELECT_VALIDATOR: 'STAKING_INFO_SELECT_VALIDATOR'
};

const BlockNotificationPeriod = { // in minutes
    OFF: -1,
    IMMEDIATE: 0,
    HOURLY: 60,
    HALF_ERA: config.eraLengthMins / 2,
    ERA_END: config.eraLengthMins
};

async function start(onFinalizedBlock, onNewEra) {
    logger.info(`Get MongoDB connection.`);
    await MongoDB.connectMongoDB();
    await migrate(config.version);
    logger.info(`Get ${config.networkName} RPC connection.`);
    await Polkadot.connectPolkadot(onFinalizedBlock, onNewEra);
    telegramConfig = await initTelegram();
}

async function stop() {
    logger.info(`Close MongoDB connection.`);
    await MongoDB.disconnectMongoDB();
    logger.info(`Close ${config.networkName} RPC connection.`);
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

async function migrate(version) {
    if (version == '1.2.1') {
        logger.info('No migration for version 1.2.1.')
    }
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

async function getAllChats() {
    let chatCollection = await MongoDB.getChatCollection();
    return await chatCollection.find({}).toArray();
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

async function setChatVersion(chatId, version) {
    let chatCollection = await MongoDB.getChatCollection();
    await chatCollection.updateOne(
        { chatId: chatId },
        { $set: { version: version } }
    );
}

async function createChat(chatId) {
    let chatCollection = await MongoDB.getChatCollection();
    const chat = {
        chatId: chatId,
        state: ChatState.IDLE,
        blockNotificationPeriod: BlockNotificationPeriod.HOURLY,
        version: config.version
    };
    await chatCollection.insertOne(chat);
    return await getChatById(chatId);
}

async function deleteChat(chatId) {
    let chatCollection = await MongoDB.getChatCollection();
    const result = await chatCollection.deleteOne({chatId: chatId});
    return result.result.ok && result.result.n == 1;
}

async function fetchValidator(stashAddress) {
    logger.info(`Will fetch validator info for ${stashAddress}.`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(
        config.w3fBaseURL + '/candidate/' + stashAddress,
        { signal: controller.signal }
    );
    clearTimeout(timeoutId);
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
        kusamaStashAddress: w3fValidator.kusamaStash,
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
    let validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.find({chatIds: {$elemMatch: {$eq: chatId}}}).toArray();
}

async function getAllValidators() {
    let validatorCollection = await MongoDB.getValidatorCollection();
    return await validatorCollection.find({}).toArray();
}

async function savePendingBlockNotification(chat, validator, blockNumber) {
    const notificationCollection = await MongoDB.getPendingBlockNotificationCollection();
    const notification = await notificationCollection.findOne(
        {
            chatId: chat.chatId,
            stashAddress: validator.stashAddress
        }
    );
    var result;
    if (notification) {
        const blockNumbers = notification.blockNumbers;
        if (!blockNumbers.includes(blockNumber)) {
            blockNumbers.push(blockNumber);
        }
        result = await notificationCollection.updateOne(
            { chatId: notification.chatId, stashAddress: notification.stashAddress },
            { $set: { blockNumbers: blockNumbers } }
        );
    } else {
        result = await notificationCollection.insertOne(
            {
                chatId: chat.chatId,
                stashAddress: validator.stashAddress,
                blockNumbers: [blockNumber]
            }
        );   
    }
    return result.result.ok && result.result.n == 1;
}

async function getPendingBlockNotifications(notificationPeriod) {
    let notificationCollection = await MongoDB.getPendingBlockNotificationCollection();
    if (notificationPeriod) {
        const chatCollection = await MongoDB.getChatCollection();
        const chats = await chatCollection.find({blockNotificationPeriod: notificationPeriod}).toArray();
        const notifications = [];
        for (let chat of chats) {
            let chatNotifications = await notificationCollection.find({chatId: chat.chatId}).toArray();
            for (let chatNotification of chatNotifications) {
                notifications.push(chatNotification);
            }
        }
        return notifications;
    } else {
        return notificationCollection.find().toArray();
    }
}

async function getPendingBlockNotificationsForChat(chatId) {
    const notificationCollection = await MongoDB.getPendingBlockNotificationCollection();
    return await notificationCollection.find({chatId: chatId}).toArray();
}

async function deletePendingBlockNotificationsForChat(chatId) {
    const notificationCollection = await MongoDB.getPendingBlockNotificationCollection();
    const result = await notificationCollection.deleteMany({chatId: chatId});
    return result.result.ok;
}

async function deletePendingBlockNotification(notification) {
    let notificationCollection = await MongoDB.getPendingBlockNotificationCollection();
    const result = await notificationCollection.deleteOne(
        {
            chatId: notification.chatId,
            stashAddress: notification.stashAddress
        }
    );
    return result.result.ok && result.result.n == 1;
}

async function setChatLastSettingsCommandMessageId(chatId, messageId) {
    let chatCollection = await MongoDB.getChatCollection();
    const result = await chatCollection.updateOne(
        { chatId: chatId },
        { $set: { lastSettingsCommandMessageId: messageId } }
    );
    return result.result.ok && result.result.n == 1;
}

async function setChatLastSettingsMessageId(chatId, messageId) {
    let chatCollection = await MongoDB.getChatCollection();
    const result = await chatCollection.updateOne(
        { chatId: chatId },
        { $set: { lastSettingsMessageId: messageId } }
    );
    return result.result.ok && result.result.n == 1;
}

async function setChatBlockNotificationPeriod(chatId, blockNotificationPeriod) {
    let chatCollection = await MongoDB.getChatCollection();
    const result = await chatCollection.updateOne(
        { chatId: chatId },
        { $set: { blockNotificationPeriod: blockNotificationPeriod } }
    );
    return result.result.ok && result.result.n == 1;
}

async function getActiveStakeInfoForCurrentEra(address) {
    const currentEra = parseInt(await Polkadot.getCurrentEra());
    return await Polkadot.getActiveStakesForEra(address, currentEra);
}

async function getStakingInfo(address) {
    const currentEra = parseInt(await Polkadot.getCurrentEra());
    const selfStake = await Polkadot.getSelfStake(address);
    const activeStakes = await Polkadot.getActiveStakesForEra(address, currentEra);
    const inactiveNominations = await Polkadot.getInactiveNominations(address, activeStakes.stakes);
    return {
        selfStake: selfStake,
        active: activeStakes,
        inactive: inactiveNominations
    };
}

async function saveRankChange(stashAddress, rank) {
    let rankHistoryCollection = await MongoDB.getRankHistoryCollection();
    const rankChange = {
        stashAddress: stashAddress,
        rank: rank,
        date: new Date()
    };
    const result = await rankHistoryCollection.insertOne(rankChange);
    return result.result.ok && result.result.n == 1;
}

async function getRankHistoryCount(stashAddress) {
    let rankHistoryCollection = await MongoDB.getRankHistoryCollection();
    return await rankHistoryCollection.countDocuments({ stashAddress: stashAddress });
}

module.exports = {
    ChatState: ChatState,
    BlockNotificationPeriod: BlockNotificationPeriod,
    start: start,
    stop: stop,
    setChatState: setChatState,
    setChatVersion: setChatVersion,
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
    getAllChats: getAllChats,
    getChatById: getChatById,
    createChat: createChat,
    deleteChat: deleteChat,
    savePendingBlockNotification: savePendingBlockNotification,
    getPendingBlockNotifications: getPendingBlockNotifications,
    getPendingBlockNotificationsForChat: getPendingBlockNotificationsForChat,
    deletePendingBlockNotificationsForChat: deletePendingBlockNotificationsForChat,
    deletePendingBlockNotification: deletePendingBlockNotification,
    setChatLastSettingsCommandMessageId: setChatLastSettingsCommandMessageId,
    setChatLastSettingsMessageId: setChatLastSettingsMessageId,
    setChatBlockNotificationPeriod: setChatBlockNotificationPeriod,
    getStakingInfo: getStakingInfo,
    getActiveStakeInfoForCurrentEra: getActiveStakeInfoForCurrentEra,
    saveRankChange: saveRankChange,
    getRankHistoryCount: getRankHistoryCount
};