/**
 * Main bot module.
 */
const fetch = require('node-fetch');
const moment = require('moment');
const cron = require('node-cron');
const markdownEscape = require('markdown-escape');

const Polkadot = require('./polkadot');
const Data = require('./data');
const Messaging = require('./messaging');
const logger = require('./logging');
const config = require('./config').config;

const telegramBaseURL = `https://api.telegram.org/bot${config.telegramBotAuthKey}`;
const maxValidatorsPerChat = 20;

let isFetchingRewards = false;

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
        logger.error(`❗️ Unexpected error while fetching 1KV validator: ${error}`);
        Messaging.sendUnexpectedError(chatId);
        Data.setChatState(chatId, Data.ChatState.IDLE);
    }
}

async function sendValidatorList(chatId, validators, message, targetChatState) {
    Messaging.sendValidatorSelection(validators, chatId, message);
    Data.setChatState(chatId, targetChatState);
}

async function processCallbackQuery(query) {
    logger.info('Will process callback query.');
    const queryId = query.id;
    if (!query.message) {
        logger.error('Callback query has empty message. Ignore.');
        Messaging.answerCallbackQuery(queryId, 'Invalid query.');
        return;
    }
    if (!query.message.chat) {
        logger.error('Callback query has empty chat. Ignore.');
        Messaging.answerCallbackQuery(queryId, 'Invalid query.');
        return;
    }
    if (!query.data)  {
        logger.error('Callback query has empty data. Ignore.');
        Messaging.answerCallbackQuery(queryId, 'Invalid query.');
        return;
    }
    let data;
    try{
        data = JSON.parse(query.data);
    } catch (error) {
        logger.info('Callback query has non-JSON data - probably a button. Ignore.');
        Messaging.answerCallbackQuery(queryId);
        return;
    }
    const chatId = query.message.chat.id;
    const chat = await Data.getChatById(chatId);
    if (query.message.message_id != chat.lastSettingsMessageId) {
        logger.info('Callback query not coming from the last settings message. Ignore.');
        Messaging.answerCallbackQuery(queryId, 'Invalid query.');
        return;
    } else {
        logger.info('Callback query coming from the last settings message.');
    }
    if (data.closeSettings) {
        Messaging.answerCallbackQuery(queryId);
        if (chat.lastSettingsMessageId) {
            await Messaging.deleteMessage(chat.chatId, chat.lastSettingsCommandMessageId);
            await Messaging.deleteMessage(chat.chatId, chat.lastSettingsMessageId);
        }
        return;
    }
    // back to settings menu
    if (data.backToSettingsMenu) {
        Messaging.answerCallbackQuery(queryId);
        Messaging.sendSettingsMenu(chat, chat.lastSettingsMessageId);
        return;
    }
    // block authorship notification settings sub-menu
    if (data.goToSubMenu == 'blockAuthorshipNotificationSettings') {
        Messaging.answerCallbackQuery(queryId);
        Messaging.sendBlockAuthorshipNotificationSettings(chat, chat.lastSettingsMessageId);
        return;
    }
    // unclaimed payout notification settings sub-menu
    if (data.goToSubMenu == 'unclaimedPayoutNotificationSettings') {
        Messaging.answerCallbackQuery(queryId);
        Messaging.sendUnclaimedPayoutNotificationSettings(chat, chat.lastSettingsMessageId);
        return;
    }
    if (typeof data.sendNewNominationNotifications !== 'undefined') {
        const successful = await Data.setChatSendNewNominationNotifications(
            chatId,
            data.sendNewNominationNotifications
        );
        // respond
        if (successful) {
            chat.sendNewNominationNotifications = data.sendNewNominationNotifications;
            Messaging.answerCallbackQuery(queryId);
            // update settings message
            await Messaging.sendSettingsMenu(chat, chat.lastSettingsMessageId);
        } else {
            Messaging.answerCallbackQuery(queryId, 'Error while updating settings:/');
        }
        return;
    }
    if (typeof data.sendChillingEventNotifications !== 'undefined') {
        const successful = await Data.setChatSendChillingEventNotifications(
            chatId,
            data.sendChillingEventNotifications
        );
        // respond
        if (successful) {
            chat.sendChillingEventNotifications = data.sendChillingEventNotifications;
            Messaging.answerCallbackQuery(queryId);
            // update settings message
            await Messaging.sendSettingsMenu(chat, chat.lastSettingsMessageId);
        } else {
            Messaging.answerCallbackQuery(queryId, 'Error while updating settings:/');
        }
        return;
    }
    if (typeof data.sendOfflineEventNotifications !== 'undefined') {
        const successful = await Data.setChatSendOfflineEventNotifications(
            chatId,
            data.sendOfflineEventNotifications
        );
        // respond
        if (successful) {
            chat.sendOfflineEventNotifications = data.sendOfflineEventNotifications;
            Messaging.answerCallbackQuery(queryId);
            // update settings message
            await Messaging.sendSettingsMenu(chat, chat.lastSettingsMessageId);
        } else {
            Messaging.answerCallbackQuery(queryId, 'Error while updating settings:/');
        }
        return;
    }

    // block authorship notification settings
    const blockNotificationPeriod = data.blockNotificationPeriod;
    if (typeof blockNotificationPeriod !== 'undefined') {
        if (blockNotificationPeriod == Data.BlockNotificationPeriod.OFF
            || blockNotificationPeriod == Data.BlockNotificationPeriod.IMMEDIATE
            || blockNotificationPeriod == Data.BlockNotificationPeriod.HOURLY
            || blockNotificationPeriod == Data.BlockNotificationPeriod.HALF_ERA
            || blockNotificationPeriod == Data.BlockNotificationPeriod.ERA_END) {
            // set chat's block notification period
            const successful = await Data.setChatBlockNotificationPeriod(chatId, blockNotificationPeriod);
            // respond
            if (successful) {
                chat.blockNotificationPeriod = blockNotificationPeriod;
                Messaging.answerCallbackQuery(queryId);
                // update settings message
                await Messaging.sendBlockAuthorshipNotificationSettings(chat, chat.lastSettingsMessageId);
                // send pending notifications
                if (blockNotificationPeriod == Data.BlockNotificationPeriod.IMMEDIATE) {
                    sendPendingNotificationsForChat(chatId);
                } else if (blockNotificationPeriod == Data.BlockNotificationPeriod.OFF) {
                    logger.info(`Block notifications turned off for chat ${chatId}.`);
                    Data.deletePendingBlockNotificationsForChat(chatId);
                }
            } else {
                Messaging.answerCallbackQuery(queryId, 'Error while updating settings:/');
            }
        } else {
            logger.info(`Invalid block notification period ${blockNotificationPeriod}. Ignore.`);
            Messaging.answerCallbackQuery(queryId, 'Invalid data.');
        }
        return;
    }
    const unclaimedPayoutNotificationPeriod = data.unclaimedPayoutNotificationPeriod;
    if (typeof unclaimedPayoutNotificationPeriod !== 'undefined') {
        if (unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.OFF
            || unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.EVERY_ERA
            || unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.TWO_ERAS
            || unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.FOUR_ERAS) {
                // set chat's block notification period
            const successful = await Data.setChatUnclaimedPayoutNotificationPeriod(
                chatId, 
                unclaimedPayoutNotificationPeriod
            );
            // respond
            if (successful) {
                chat.unclaimedPayoutNotificationPeriod = unclaimedPayoutNotificationPeriod;
                Messaging.answerCallbackQuery(queryId);
                // update settings message
                await Messaging.sendUnclaimedPayoutNotificationSettings(chat, chat.lastSettingsMessageId);
            } else {
                Messaging.answerCallbackQuery(queryId, 'Error while updating settings:/');
            }
        } else {
            logger.info(`Invalid unclaimed payout notification period ${unclaimedPayoutNotificationPeriod}. Ignore.`);
            Messaging.answerCallbackQuery(queryId, 'Invalid data.');
        }
    }
}

async function processTelegramUpdate(update) {
    if (update.callback_query) {
        const chatId = update.callback_query.message.chat.id;
        if (chatId) {
            // send deprecation warning
            await Messaging.sendDeprecationWarning(chatId);
        }
        return;
    }
    if (!update.message) { // TODO this is a temporary fix - check why the crash is happening
        return;
    }
    const chatId = update.message.chat.id;
    let chat = await Data.getChatById(chatId);
    if (!chat) {
        logger.info(`Chat does not exist, create it.`);
        chat = await Data.createChat(chatId);
    }
    logger.info(`Processing Telegram update id ${update.update_id}.`);
    if (chat.isMigrated) {
        Messaging.sendAlreadyMigrated(chatId);
        return;
    }
    // send deprecation warning
    await Messaging.sendDeprecationWarning(chatId);
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
        let messageComponents = [];
        // check name
        if (validator.name != w3fValidator.name) {
            updates.name = w3fValidator.name;
            messageComponents.push('\n🏷 has a new name ' + markdownEscape(updates.name));
        }
        // compare controller
        if (!validator.controllerAddress) {
            updates.controllerAddress = w3fValidator.controllerAddress;
        } else if (validator.controllerAddress != w3fValidator.controllerAddress) {
            updates.controllerAddress = w3fValidator.controllerAddress;
            messageComponents.push('\n⚓️ has a new controller [' + w3fValidator.controllerAddress.slice(0, 6) + '..' + w3fValidator.controllerAddress.slice(-6) + `](https://${config.networkName.toLowerCase()}.subscan.io/account/${w3fValidator.controllerAddress})`);
        }
        // compare rank
        if (validator.rank < w3fValidator.rank) {
            updates.rank = w3fValidator.rank;
            messageComponents.push('\n📈 rank has increased from ' + validator.rank + ' to ' + w3fValidator.rank);
            await Data.saveRankChange(validator.stashAddress, w3fValidator.rank);
        } else if (validator.rank > w3fValidator.rank) {
            updates.rank = w3fValidator.rank;
            messageComponents.push('\n📉 rank has decreased from ' + validator.rank + ' to ' + w3fValidator.rank);
            Data.saveRankChange(validator.stashAddress, w3fValidator.rank);
        }
        // save rank if no record exists
        const rankHistoryCount = await Data.getRankHistoryCount(validator.stashAddress);
        if (rankHistoryCount == 0) {
            await Data.saveRankChange(validator.stashAddress, w3fValidator.rank);
        }
        // compare 1KV validity
        if (!validator.isValid && w3fValidator.isValid) {
            updates.isValid = w3fValidator.isValid;
            updates.validityItems = w3fValidator.validityItems;
            updates.invalidityReasons = w3fValidator.invalidityReasons;
            messageComponents.push('\n' + '✅ is now a valid 1KV validator');
        } else if (validator.isValid && !w3fValidator.isValid) {
            // send pending messages
            for (let chatId of validator.chatIds) {
                sendPendingNotificationsForChat(chatId);
            }
            updates.isValid = w3fValidator.isValid;
            updates.validityItems = w3fValidator.validityItems;
            updates.invalidityReasons = w3fValidator.invalidityReasons;
            messageComponents.push('\n' + '❌ has become an invalid 1KV validator:');
            for (let validityItem of w3fValidator.validityItems) {
                if (!validityItem.valid) {
                    messageComponents.push(`\n- ${markdownEscape(validityItem.details)}`);
                }
            }
        } else if (validator.invalidityReasons != w3fValidator.invalidityReasons) {
            updates.invalidityReasons = w3fValidator.invalidityReasons;
        }
        // check validity items
        if (!validator.hasOwnProperty('validityItems')) {
            updates.validityItems = w3fValidator.validityItems;
        }
        // compare online/offline
        if (validator.offlineSince == 0 && w3fValidator.offlineSince > 0) {
            // send pending messages
            for (let chatId of validator.chatIds) {
                sendPendingNotificationsForChat(chatId);
            }
            updates.onlineSince = w3fValidator.onlineSince;
            updates.offlineSince = w3fValidator.offlineSince;
            updates.offlineAccumulated = w3fValidator.offlineAccumulated;
            messageComponents.push('\n🔴 went offline on ' + moment.utc(new Date(w3fValidator.offlineSince)).format('MMMM Do YYYY, HH:mm:ss'));

        } else if (validator.offlineSince > 0 && w3fValidator.offlineSince == 0) {
            updates.onlineSince = w3fValidator.onlineSince;
            updates.offlineSince = w3fValidator.offlineSince;
            updates.offlineAccumulated = w3fValidator.offlineAccumulated;
            messageComponents.push('\n🟢 came back online on ' + moment.utc(new Date(w3fValidator.onlineSince)).format('MMMM Do YYYY, HH:mm:ss'));
        }
        // compare is active in set
        if (validator.isActiveInSet != w3fValidator.isActiveInSet) {
            updates.isActiveInSet = w3fValidator.isActiveInSet;
            if (w3fValidator.isActiveInSet) {
                const totalActiveStakeAmount = 
                    (await Data.getActiveStakeInfoForCurrentEra(validator.stashAddress)).totalStake;
                messageComponents.push('\n' + '🚀 is now an active validator');
                messageComponents.push('\n' + `Total active stake *${Messaging.formatAmount(totalActiveStakeAmount)}*`);
                // fetch active stake
            } else {
                // send pending messages
                for (let chatId of validator.chatIds) {
                    sendPendingNotificationsForChat(chatId);
                }
                messageComponents.push('\n' + '⏸ is not anymore an active validator');
            }
        }
        // compare commission
        if (validator.commission != w3fValidator.commission) {
            updates.commission = w3fValidator.commission;
            messageComponents.push(`\n💵 new commission rate is ${w3fValidator.commission}`);
        }
        // compare session keys
        if (validator.sessionKeys != w3fValidator.sessionKeys) {
            updates.sessionKeys = w3fValidator.sessionKeys;
            messageComponents.push('\n' + '🔑 has new session keys: `' + w3fValidator.sessionKeys.slice(0, 8) + '..' + w3fValidator.sessionKeys.slice(-8) + '`');
        }
        // compare location
        if (validator.location != w3fValidator.location) {
            updates.location = w3fValidator.location;
            messageComponents.push(`\n🌏 is now located in ${w3fValidator.location}`);
        }
        // update version
        if (validator.version != w3fValidator.version) {
            updates.version = w3fValidator.version;
            // messageComponents.push(`\n🧬 is now running version ${markdownEscape(w3fValidator.version)}`);
        }
        // process updates
        let updateCount = Object.keys(updates).length;
        if (updateCount > 0) {
            logger.info(`Updating [${validator.stashAddress}] with ${updateCount} properties.`);
            // persist changes
            const result = await Data.updateValidator(validator, updates);
            if (result.result.ok && result.result.n == 1) {
                logger.info(`${validator.name} database update successful.`);
                if (messageComponents.length > 0) {
                    logger.info(`Send update message for [${validator.stashAddress}].`);
                    let message = markdownEscape(validator.name) + messageComponents.join("");
                    for (let chatId of validator.chatIds) {
                        await Messaging.sendMessage(chatId, message);
                    }
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
    for (let validator of validators) {
        await updateValidator(validator);
    }
}

function start1KVUpdateJob() {
    cron.schedule(`*/${config.oneKVUpdatePeriodMins} * * * *`, () => {
        updateValidators();
    });
}

function startPendingNotificationSender() {
    cron.schedule('0 * * * *', () => {
        sendPendingNotifications(Data.BlockNotificationPeriod.HOURLY);
    });
    const halfEraHours = config.eraLengthMins / (2 * 60);
    cron.schedule(`0 */${halfEraHours} * * *`, () => {
        sendPendingNotifications(Data.BlockNotificationPeriod.HALF_ERA);
    });
}

async function sendPendingNotifications(notificationPeriod) {
    const notifications = await Data.getPendingBlockNotifications(notificationPeriod);
    for (let notification of notifications) {
        let validator = await Data.getValidatorByStashAddress(notification.stashAddress);
        if (validator) {
            const response = await Messaging.sendBlocksAuthored(
                notification.chatId,
                validator,
                notification.blockNumbers
            );
            if (response != null) {
                Data.deletePendingBlockNotification(notification);
            }
        }
    }
}

async function sendPendingNotificationsForChat(chatId) {
    const notifications = await Data.getPendingBlockNotificationsForChat(chatId);
    for (let notification of notifications) {
        let validator = await Data.getValidatorByStashAddress(notification.stashAddress);
        if (validator) {
            const response = await Messaging.sendBlocksAuthored(
                notification.chatId,
                validator,
                notification.blockNumbers
            );
            if (response != null) {
                Data.deletePendingBlockNotification(notification);
            }
        }
    }
}

async function processRewardsUpToBlock(blockNumber) {
    if (isFetchingRewards) { return; }
    isFetchingRewards = true;
    const startBlockNumber = (await Data.getLastFetchedRewardBlock()) + 1;
    for (let i = startBlockNumber; i <= blockNumber; i++) {
        try {
            const rewards = await Polkadot.getRewardsInBlock(i);
            await Data.saveRewards(rewards);
            await Data.setLastFetchedRewardBlock(i);
            logger.info(`Did fetch and save ${rewards.length} rewards in block #${i}`);
        } catch (error) {
            logger.error(`Error while fetching rewards in block #${i}: ${error}`);
            break;
        }
    }
    isFetchingRewards = false;
}

async function onFinalizedBlock(blockNumber, blockHash, blockAuthor) {
    logger.info(`⛓  Finalized block #${blockNumber} authored by ${blockAuthor}`);
    checkBlockForAuthorship(blockNumber, blockAuthor);
    checkBlockForNominations(blockNumber);
    checkBlockForChillingEvents(blockNumber);
    checkBlockForOfflineEvents(blockNumber);
    if (blockNumber % 100 == 0) { // ~ every 10 minutes
        processRewardsUpToBlock(blockNumber - 25);
    }
}

async function checkBlockForAuthorship(blockNumber, blockAuthor) {
    const validator = await Data.getValidatorByStashAddress(blockAuthor);
    if (validator) {
        await processNewBlockByValidator(blockNumber, validator)
    }
}

async function processNewBlockByValidator(blockNumber, validator) {
    for (let chatId of validator.chatIds) {
        let chat = await Data.getChatById(chatId);
        if (chat) {
            let notificationPeriod = chat.blockNotificationPeriod;
            if (notificationPeriod == Data.BlockNotificationPeriod.IMMEDIATE) {
                logger.info(`Chat [${chat.chatId}] block notification period is immediate. Send notification for ${validator.name}.`);
                await Messaging.sendBlocksAuthored(chat.chatId, validator, [blockNumber]);
            } else if (notificationPeriod != Data.BlockNotificationPeriod.OFF) {
                logger.info(`Chat [${chat.chatId}] block notification period is ${notificationPeriod} mins. Save notification.`);
                await Data.savePendingBlockNotification(
                    chat,
                    validator,
                    blockNumber
                );
            }
        }
    }
}

async function checkBlockForNominations(blockNumber) {
    const nominations = await Polkadot.getNominationsInBlock(blockNumber);
    for (let nomination of nominations) {
        for (let validatorAddress of nomination.validatorAddresses) {
            const validator = await Data.getValidatorByStashAddress(validatorAddress);
            if (validator) {
                await processNewNominationForValidator(nomination, validator)
            }
        }
    }
}

async function processNewNominationForValidator(nomination, validator) {
    logger.info(`New nomination for ${validator.name}.`);
    for (let chatId of validator.chatIds) {
        let chat = await Data.getChatById(chatId);
        if (chat && chat.sendNewNominationNotifications) {
            await Messaging.sendNewNomination(chat.chatId, validator, nomination);
        }
    }
}

async function checkBlockForChillingEvents(blockNumber) {
    const chillings = await Polkadot.getChillingsInBlock(blockNumber);
    for (let chilling of chillings) {
        const validator = await Data.getValidatorByControllerAddress(chilling.controllerAddress);
        if (validator) {
            await processNewChillingForValidator(chilling, validator)
        }
    }
}

async function processNewChillingForValidator(chilling, validator) {
    logger.info(`New chilling for ${validator.name}.`);
    for (let chatId of validator.chatIds) {
        let chat = await Data.getChatById(chatId);
        if (chat && chat.sendChillingEventNotifications) {
            await Messaging.sendChilling(chat.chatId, validator, chilling);
        }
    }
}

async function checkBlockForOfflineEvents(blockNumber) {
    const offlineEvent = await Polkadot.getOfflineEventInBlock(blockNumber);
    if (!offlineEvent) {
        return;
    }
    for (let validatorAddress of offlineEvent.validatorAddresses) {
        const validator = await Data.getValidatorByStashAddress(validatorAddress);
        if (validator) {
            await processNewOfflineEventForValidator(offlineEvent, validator)
        }
    }
}

async function processNewOfflineEventForValidator(offlineEvent, validator) {
    logger.info(`New offline event for ${validator.name}.`);
    for (let chatId of validator.chatIds) {
        let chat = await Data.getChatById(chatId);
        if (chat && chat.sendOfflineEventNotifications) {
            await Messaging.sendOfflineEvent(chat.chatId, validator, offlineEvent);
        }
    }
}

async function checkUnclaimedEraPayouts(currentEra) {
    const fourDaysMins = 4 * 24 * 60;
    const unclaimedPayoutsEraDepth = fourDaysMins / config.eraLengthMins;
    const beginEra = currentEra - unclaimedPayoutsEraDepth;
    const validators = await Data.getAllValidators();
    for (let validator of validators) {
        const chatIds = [];
        for (let chatId of validator.chatIds) {
            const chat = await Data.getChatById(chatId);
            if (chat) {
                const period = chat.unclaimedPayoutNotificationPeriod;
                if ((period != Data.UnclaimedPayoutNotificationPeriod.OFF) 
                        && (currentEra % period == 0)) {
                    chatIds.push(chatId);
                }
            }
        }
        if (chatIds.length == 0) {
            continue;
        }

        let unclaimedEras = [];
        for (let era = beginEra; era < currentEra; era++) {
            let payoutClaimed = await Polkadot.payoutClaimedForAddressForEra(
                validator.stashAddress,
                era
            );
            if (!payoutClaimed) {
                unclaimedEras.push(era);
            }    
        }
        if (unclaimedEras.length > 0) {
            await Messaging.sendUnclaimedPayoutWarning(
                validator, 
                chatIds, 
                unclaimedEras
            );
        }
    }
}

async function onEraChange(currentEra) {
    logger.info(`New era ${currentEra}.`);
    // send all pending block notifications
    await sendPendingNotifications();
    // delay the unclaimed payout check for a session length plus half hour
    const unclaimedPayoutCheckDelayMs = (config.sessionLengthMins + 30) * 60 * 1000;
    setTimeout(() => {
        checkUnclaimedEraPayouts(currentEra);
    }, unclaimedPayoutCheckDelayMs);
}

const start = async () => {
    logger.info(`1KV Telegram bot has started.`);
    await Data.start(
        onFinalizedBlock,
        onEraChange
    );
    const allValidators = await Data.getAllValidators();
    for (let validator of allValidators) {
        await Data.updateValidatorChatIds(validator, validator.chatIds);
    }
    // check chat versions and send release notes if necessary
    const allChats = await Data.getAllChats();
    for (let chat of allChats) {
        if (!chat.version || chat.version != config.version) {
            if (!chat.isMigrated && config.sendReleaseNotes) {
                await Messaging.sendReleaseNotes(chat.chatId);
            }
            await Data.setChatVersion(chat.chatId, config.version);
        }
    }

    logger.info(`Start receiving Telegram updates.`);
    getTelegramUpdates();
    /**
     * DEPRECATED
     */
    // start1KVUpdateJob();
    // startPendingNotificationSender();
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