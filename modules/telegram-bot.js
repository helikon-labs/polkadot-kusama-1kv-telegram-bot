/**
 * Main bot module.
 */
const fetch = require('node-fetch');
const moment = require('moment');
const cron = require('node-cron');

const Polkadot = require('./polkadot');
const MongoDB = require('./mongodb');
const Data = require('./data');
const Messaging = require('./messaging');
const logger = require('./logging');
require('dotenv').config();

const telegramBaseURL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_AUTH_KEY}`;
const maxValidatorsPerChat = 20;

async function fetchAndPersistValidatorInfo(stashAddress, chatId) {
    try {
        const validatorFetchResult = await Data.fetchValidator(stashAddress);
        if (validatorFetchResult.status == 200) {
            const validator = await Data.persistValidator(validatorFetchResult.validator, chatId);
            await Data.setChatState(chatId, Data.ChatState.IDLE);
            await Messaging.sendValidatorInfo(chatId, validator);
            await Messaging.sendValidatorAdded(chatId, validator);
        } else if (validatorFetchResult.status == 204 || validatorFetchResult.status == 404) {
            Messaging.sendValidatorNotFound(chatId, stashAddress);
        }
    } catch (error) {
        logger.error(`❗️ Unexpected error while  fetching 1KV validator: ${error}`);
        Messaging.sendUnexpectedError(chatId);
        Data.setChatState(chatId, Data.ChatState.IDLE);
    }
}

async function sendValidatorList(chatId, message, targetChatState) {
    const validators = await Data.getValidatorsForChat(chatId);
    if (validators.length < 1) {
        Messaging.sendNoValidators(chatId);
    } else if (validators.length == 1) {
        Messaging.sendValidatorInfo(chatId, validators[0]);
        Data.setChatState(chatId, Data.ChatState.IDLE);
    } else {
        Messaging.sendValidatorSelection(validators, chatId, message);
        Data.setChatState(chatId, targetChatState);
    }
}

async function processTelegramUpdate(update) {
    logger.info(`Processing Telegram update id ${update.update_id}.`);
    let text = update.message.text;
    if (!text || text.trim().length == 0) {
        // err
        logger.error(`Message text is null or empty.`);
        return;
    }
    text = text.trim();
    let chatCollection = await MongoDB.getChatCollection();
    const chatId = update.message.chat.id;
    var chat = await chatCollection.findOne({ chatId: chatId });
    if (text == '/start' || text == '/help') {
        logger.info(`${text} received.`);
        if (!chat) {
            logger.info(`Chat does not exist, create it.`);
            // persist chat
            chat = {
                chatId: chatId,
                state: Data.ChatState.IDLE
            };
            await chatCollection.insertOne(chat);
        } else {
            Data.setChatState(chatId, Data.ChatState.IDLE);
        }
        Messaging.sendHelp(chatId);
        return;
    } else if (text == '/add') {
        logger.info(`/add received.`);
        const validators = await Data.getValidatorsForChat(chatId);
        if (validators.length >= maxValidatorsPerChat) {
            await Messaging.sendChatHasMaxValidators(chatId, maxValidatorsPerChat);
            Data.setChatState(chatId, Data.ChatState.IDLE);
        } else {
            await Messaging.sendAddValidator(chatId);
            Data.setChatState(chatId, Data.ChatState.ADD);
        }
    } else if (text == '/remove') {
        logger.info(`/remove received.`);
        await sendValidatorList(
            chatId,
            'Sure, please select the validator to be removed.',
            Data.ChatState.REMOVE
        );
    } else if (text == '/validatorinfo') {
        logger.info(`/validatorinfo received.`);
        await sendValidatorList(
            chatId,
            'Ok, please select the validator from below.',
            Data.ChatState.VALIDATOR_INFO
        );
    } else {
        logger.info(`Received message [${text}] on state [${chat.state}].`);
        switch (chat.state) {
            case Data.ChatState.IDLE:
                await Messaging.sendUnrecognizedCommand(chatId);
                break;
            case Data.ChatState.ADD:
                processAddRequest(text, chatId);
                break;
            case Data.ChatState.REMOVE:
                const validatorToRemove = await Data.getValidatorByName(text);
                if (!validatorToRemove) {
                    await Messaging.sendValidatorNotFoundByName(chatId, text);
                } else {
                    const success = await Data.removeValidator(validatorToRemove, chatId);
                    if (success) {
                        await Messaging.sendValidatorRemoved(chatId, text);
                    } else {
                        await Messaging.sendUnexpectedError(chatId);
                    }
                }
                Data.setChatState(chatId, Data.ChatState.IDLE);
                break;
            case Data.ChatState.VALIDATOR_INFO:
                const infoValidator = await Data.getValidatorByName(text);
                if (!infoValidator) {
                    await Messaging.sendValidatorNotFoundByName(chatId, text);
                } else {
                    await Messaging.sendValidatorInfo(chatId, infoValidator);
                }
                Data.setChatState(chatId, Data.ChatState.IDLE);
                break;
            default:
                // should never reach here
                logger.error(`Error. Unrecognized chat state: ${chat.state}`);
                break;
        }
    }
}

async function processAddRequest(stashAddress, chatId) {
    if (!Polkadot.isValidAddress(stashAddress)) {
        Messaging.sendInvalidStashAddress(chatId);
        return;
    }
    const validator = await Data.getValidatorByStashAddress(stashAddress);
    if (validator && validator.chatIds && validator.chatIds.includes(chatId)) {
        Messaging.sendValidatorAlreadyAdded(validator, chatId);
    } else {
        // get number of validators assigned to the chat
        if (validator) {
            if (validator.chatIds && !validator.chatIds.includes(chatId)) {
                validator.chatIds.push(chatId);
            } else {
                validator.chatIds = [chatId];
            }
            // update validator
            await Data.updateValidatorChatIds(validator, validator.chatIds);
            await Data.setChatState(chatId, Data.ChatState.IDLE);
            await Messaging.sendValidatorInfo(chatId, validator);
            await Messaging.sendValidatorAdded(chatId, validator);
        } else {
            // send processing message
            await Messaging.sendValidatorFetchInProgress(chatId);
            // fetch validator info
            await fetchAndPersistValidatorInfo(stashAddress, chatId);
        }
    }
}

async function getTelegramUpdates() {
    let updateOffset = Data.getTelegramUpdateOffset();
    logger.info(`Get Telegram updates with offset ${updateOffset}.`);
    let response;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        response = await fetch(
            telegramBaseURL + '/getUpdates?offset=' + updateOffset,
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);
    } catch (error) {
        logger.error(`Telegram update fetch request timed out. Retry.`);
        getTelegramUpdates();
        return;
    }
    if (response.status >= 200 || response.status < 300) {
        let responseJSON = await response.json();
        if (responseJSON.ok) {
            let updates = responseJSON.result;
            logger.info(`Received ${updates.length} Telegram updates.`);
            if (updates.length > 0) {
                for (let i = 0; i < updates.length; i++) {
                    processTelegramUpdate(updates[i]);
                    updateOffset = Math.max(
                        updates[i].update_id,
                        updateOffset
                    );
                }
                await Data.setTelegramUpdateOffset(updateOffset + 1);
            }
        }
        getTelegramUpdates();
    } else if (response.status == 502) { // connection timeout
        logger.error(`Telegram error [502]. Reconnect.`);
        getTelegramUpdates();
    } else {
        logger.error(`Telegram error [${response.status}]: ${response.statusText}`);
        logger.error('Reconnect in one second.');
        await new Promise(resolve => setTimeout(resolve, 1000));
        getTelegramUpdates();
    }
}

async function updateValidator(validator) {
    logger.info(`Update ${validator.name}.`);
    try {
        const validatorFetchResult = await Data.fetchValidator(validator.stashAddress);
        if (validatorFetchResult.status != 200) {
            logger.error(`❗️ Cannot fetch validator data from W3F. Status: ${validatorFetchResult.status}`);
            return;
        }
        logger.info(`Fetched ${validator.name}.`);
        const w3fValidator = validatorFetchResult.validator;
        const updates = {};
        let updateCount = 0;
        let message = validator.name;
        // check name
        if (validator.name != w3fValidator.name) {
            updates.name = w3fValidator.name;
            message += '\n🏷 has a new name ' + updates.name;
            updateCount++;
        }
        // compare rank
        if (validator.rank < w3fValidator.rank) {
            updates.rank = w3fValidator.rank;
            message += '\n📈 rank has increased from ' + validator.rank + ' to ' + w3fValidator.rank;
            updateCount++;
        } else if (validator.rank > w3fValidator.rank) {
            updates.rank = w3fValidator.rank;
            message += '\n📉 rank has decreased from ' + validator.rank + ' to ' + w3fValidator.rank;
            updateCount++;
        }
        // compare 1KV validity
        if (validator.invalidityReasons && validator.invalidityReasons.length > 0 
            && (!w3fValidator.invalidityReasons || w3fValidator.invalidityReasons.trim().length == 0)) {
            updates.invalidityReasons = w3fValidator.invalidityReasons;
            message += '\n' + '✅ is now a valid 1KV validator';
            updateCount++;
        } else if ((!validator.invalidityReasons || validator.invalidityReasons.trim().length == 0)
            && w3fValidator.invalidityReasons && w3fValidator.invalidityReasons.length > 0 ) {
            updates.invalidityReasons = w3fValidator.invalidityReasons;
            message += '\n' + '❌ has become an invalid 1KV validator: ' + w3fValidator.invalidityReasons;
            updateCount++;
        }
        // compare online/offline
        if (validator.onlineSince != 0 && w3fValidator.onlineSince == 0) {
            updates.onlineSince = w3fValidator.onlineSince;
            updates.offlineSince = w3fValidator.offlineSince;
            updates.offlineAccumulated = w3fValidator.offlineAccumulated;
            message += '\n🔴 went offline on ' + moment.utc(new Date(w3fValidator.offlineSince)).format('MMMM Do YYYY, HH:mm:ss');
            updateCount++;

        } else if (validator.onlineSince == 0 && w3fValidator.onlineSince != 0) {
            updates.onlineSince = w3fValidator.onlineSince;
            updates.offlineSince = w3fValidator.offlineSince;
            updates.offlineAccumulated = w3fValidator.offlineAccumulated;
            message += '\n🟢 came back online on ' + moment.utc(new Date(w3fValidator.onlineSince)).format('MMMM Do YYYY, HH:mm:ss');
            updateCount++;
        }
        // compare is active in set
        if (validator.isActiveInSet != w3fValidator.isActiveInSet) {
            updates.isActiveInSet = w3fValidator.isActiveInSet;
            if (w3fValidator.isActiveInSet) {
                message += '\n' + '🚀 is now *in* the active validator set';
            } else {
                message += '\n' + '⏸ is *not* anymore in the active validator set';
            }
            updateCount++;
        }
        // compare session keys
        if (validator.sessionKeys != w3fValidator.sessionKeys) {
            updates.sessionKeys = w3fValidator.sessionKeys;
            message += '\n' + '🔑 has new session keys: `' + w3fValidator.sessionKeys.slice(0, 12) + '..' + w3fValidator.sessionKeys.slice(-12) + '`';
            updateCount++;
        }
        // compare nominated
        if (validator.nominatedAt != w3fValidator.nominatedAt) {
            updates.nominatedAt = w3fValidator.nominatedAt;
            if (!w3fValidator.nominatedAt || w3fValidator.nominatedAt == 0) {
                message += '\n' + '👎 is not nominated anymore';
            } else {
                const nominatedAt = moment.utc(new Date(validator.nominatedAt)).format('MMMM Do YYYY, HH:mm:ss');
                message += '\n' + '🤘 got nominated on ' + nominatedAt + ' UTC';
            }
            updateCount++;
        }
        // compare updated
        if (validator.updated != w3fValidator.updated) {
            updates.updated = w3fValidator.updated;
            if (w3fValidator.updated) {
                message += '\n' + '🆙 is now up-to-date with version `' + validator.version + '`';
            } else {
                message += '\n' + '❗ got out of date with version `' + validator.version + '`.';
            }
            updateCount++;
        }
        if (updateCount > 0) {
            logger.info(`Updating [${validator.stashAddress}] with ${updateCount} properties.`);
            // persist changes
            const result = await Data.updateValidator(validator, updates);
            if (result.result.ok && result.result.n == 1) {
                logger.info(`${validator.name} database update successful. Send message(s).`);
                for (let chatId of validator.chatIds) {
                    await Messaging.sendMessage(chatId, message);
                }
            } else {
                logger.error(`${validator.name} database update has failed.`);
            }
        } else {
            await Data.updateValidator(validator, updates);
            logger.info(`${validator.name} is up to date.`);
        }
    } catch (error) {
        logger.error(`❗️ Unexpected error while updating 1KV validator: ${error}`);
    }
}

async function updateValidators() {
    logger.info(`🔄  Update 1KV validators.`);
    const validators = await Data.getAllValidators();
    for(let validator of validators) {
        updateValidator(validator);
    }
}

function start1KVUpdateJob() {
    cron.schedule('*/10 * * * *', () => {
        updateValidators();
    });
}

async function onNewBlock(blockHeader) {
    logger.info(`⛓  New block #${blockHeader.number} authored by ${blockHeader.author}`);
    if (!blockHeader.author) {
        return;
    }
    const validator = await Data.getValidatorByStashAddress(blockHeader.author.toString());
    if (validator) {
        Messaging.sendBlockAuthored(validator, blockHeader.number);
    }
}

async function onEraChange(currentEra) {
    logger.info(`New era ${currentEra}.`);
    // get all validators
    const validators = await Data.getAllValidators();
    for(let validator of validators) {
        const payoutClaimed = await Polkadot.payoutClaimedForAddressForEra(
            validator.stashAddress,
            currentEra - 1
        );
        if (!payoutClaimed) {
            await Messaging.sendClaimPaymentWarning(validator, currentEra - 1);
        }
    }
}

const start = async () => {
    logger.info(`Kusama 1KV Telegram bot has started.`);
    await Data.start(
        onNewBlock,
        onEraChange
    );
    logger.info(`Start receiving Telegram updates.`);
    getTelegramUpdates();
    start1KVUpdateJob();
}

const stop = async () => {
    await Data.stop();
    logger.info(`Connections closed. Exit.`);
    process.exit(); // Exit with default success-code '0'.
};

module.exports = {
    start: start,
    stop: stop
};