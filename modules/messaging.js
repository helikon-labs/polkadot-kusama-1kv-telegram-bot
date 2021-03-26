/**
 * Telegram messaging module.
 */
const fetch = require('node-fetch');
const dedent = require('dedent');
const moment = require('moment');
const markdownEscape = require('markdown-escape');

const logger = require('./logging');
const config = require('./config').config;
const Data = require('./data');

const telegramBaseURL = `https://api.telegram.org/bot${config.telegramBotAuthKey}`;

const releaseNotes =
`- Turn off block notifications in /settings.
- Block notifications will be sent/scheduled only when the blocks get finalized.
- New /stakinginfo command to view the self, active and inactive stake amounts for a validator.
- New /about command gives version and developer info.
- Checks unclaimed payouts four days back.
- Unclaimed payouts check is delayed for an hour after an era change to avoid latency differences with Polkadot JS and to take automatic payout scripts into account.
- Active stake amount is now included in the notification for when a validator gets in the active validator set.`;

const formatAmount = amount => {
    return `${amount.toFixed(4)} ${config.tokenTicker}`
}

async function updateMessage(chatId, messageId, message, replyMarkup) {
    let body = {
        chat_id: chatId,
        message_id: messageId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    } else {
        body.reply_markup = { remove_keyboard: true }
    }
    const response = await fetch(
        telegramBaseURL + '/editMessageText',
        {
            method: 'post',
            body:    JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    const successful = response.status % 200 < 100;
    if (successful) {
        logger.info(`Message ${messageId} updated in chat ${chatId} successfully.`);
        try {
            return (await response.json()).result;
        } catch (error) {
            return null
        }
    } else {
        logger.error(`Error while updating message ${messageId} in chat ${chatId}.`);
        return null;
    }
}

async function sendMessage(chatId, message, replyMarkup) {
    let body = {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    } else {
        body.reply_markup = { remove_keyboard: true }
    }
    const response = await fetch(
        telegramBaseURL + '/sendMessage',
        {
            method: 'post',
            body:    JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    const successful = response.status % 200 < 100;
    if (successful) {
        try {
            const responseJSON = await response.json();
            if (!responseJSON.ok && responseJSON.error_code == 403) {
                logger.info(`Bot blocked by user. Delete chat ${chatId}.`);
                await Data.deleteChat(chatId);
                return;
            }
            logger.info(`Message "${message}" sent to chat ${chatId} successfully.`);
            return responseJSON.result;
        } catch (error) {
            return null;
        }
    } else {
        logger.error(`Error while sending message "${message}" to chat ${chatId}.`);
        return null;
    }
}

async function sendTypingAction(chatId) {
    let body = {
        chat_id: chatId,
        action: 'typing'
    };
    const response = await fetch(
        telegramBaseURL + '/sendChatAction',
        {
            method: 'post',
            body:    JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    const successful = response.status % 200 < 100;
    if (successful) {
        logger.info(`Typing action sent to chat ${chatId} successfully.`);
        return true;
    } else {
        logger.error(`Error while sending typing action to chat ${chatId}.`);
        return false;
    }
}

async function answerCallbackQuery(callbackQueryId, message) {
    let body = {
        callback_query_id: callbackQueryId
    };
    if (message) {
        body.text = message;
    }
    const response = await fetch(
        telegramBaseURL + '/answerCallbackQuery',
        {
            method: 'post',
            body:    JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    const successful = response.status % 200 < 100;
    if (successful) {
        logger.info(`Callback query ${callbackQueryId} answered.`);
    } else {
        logger.error(`Error while answering callback query ${callbackQueryId}.`);
    }
    return successful;
}

async function sendValidatorNotFound(chatId, stashAddress) {
    const message = dedent('⚠️ Validator with stash address `' + stashAddress 
                    + `\` was not found in the ${config.networkName} Thousand Validators Programme.`
                    + ' Please enter a different stash address.');
    await sendMessage(chatId, message);
}

async function sendValidatorAdded(chatId, validator) {
    const message = `${validator.name} has been added to your list.` 
                + ` You will receive updates regarding the status of your validator and its activity`
                + ` on the ${config.networkName} blockchain. I will send you block authorship notifications at the end of every hour,`
                + ` you can change this period with the /settings command. Please use the /remove command to remove this validator`
                + ` or any other in your list and stop receiving notifications.`
                + ` You can also add more validators with the /add command.`;
    await sendMessage(chatId, message);
}

async function sendUnexpectedError(chatId) {
    const message = `I encountered an unexpected error while processing your request. Please try again later.`;
    await sendMessage(chatId, message);
}

async function sendSettings(chat, messageId) {
    const keyboard = [
        [{ text: '🧱 Block Authorship Notifications 🧱'.toUpperCase(), callback_data: 'no_op'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.OFF ? '🟢' : '⚪') + ' Off', callback_data: '{"blockNotificationPeriod": -1}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.IMMEDIATE ? '🟢' : '⚪') + ' Immediately', callback_data: '{"blockNotificationPeriod": 0}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.HOURLY ? '🟢' : '⚪️') + ' Hourly', callback_data: '{"blockNotificationPeriod": 60}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.HALF_ERA ? '🟢' : '⚪️') + ` End of every half era (${config.eraLengthMins / (2 * 60)} hours)`, callback_data: `{"blockNotificationPeriod": ${config.eraLengthMins / 2}}`}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.ERA_END ? '🟢' : '⚪️') + ` End of every era (${config.eraLengthMins / 60} hours)`, callback_data: `{"blockNotificationPeriod": ${config.eraLengthMins}}`}]
    ]
    const replyMarkup = {
        inline_keyboard: keyboard
    };
    if (messageId) {
        return await updateMessage(chat.chatId, messageId, 'Please configure below.', replyMarkup);
    } else {
        return await sendMessage(chat.chatId, 'Please configure below.', replyMarkup);
    }
}

async function sendValidatorInfo(chatId, validator) {
    // name
    let validatorInfo = markdownEscape(validator.name);
    
    // stash
    validatorInfo += `\n📍 Address ${validator.stashAddress.slice(0, 8)}..${validator.stashAddress.slice(-8)}`;

    // rank
    validatorInfo += `\n📊 Has rank ${validator.rank}`;
    // 1KV validity
    if (!validator.invalidityReasons || validator.invalidityReasons.trim().length == 0) {
        validatorInfo += `\n✅ Is valid 1KV validator`;
    } else {
        validatorInfo += `\n❌ Is not valid for 1KV: ${validator.invalidityReasons}`;
    }
    
    // online / offline
    if (validator.onlineSince > 0) {
        const onlineSince = moment.utc(new Date(validator.onlineSince)).format('MMMM Do YYYY, HH:mm:ss');
        validatorInfo += `\n🟢 Online since ${onlineSince} UTC`;
    } else if (validator.offlineSince > 0) {
        const offlineSince = moment.utc(new Date(validator.offlineSince)).format('MMMM Do YYYY, HH:mm:ss');
        validatorInfo += `\n🔴 Offline since ${offlineSince} UTC`;
    }
    // active set
    if (validator.isActiveInSet) {
        validatorInfo += `\n🚀 Is currently *in* the active validator set`;
    } else {
        validatorInfo += `\n⏸ Is *not* currently in the active validator set`;
    }
    // session keys
    if (validator.sessionKeys) {
        const sessionKeys = validator.sessionKeys.slice(0, 8) + '..' + validator.sessionKeys.slice(-8);
        validatorInfo += `\n🔑 Session keys: ${sessionKeys}`;
        // return 
    }
    // commission
    if (validator.commission) {
        validatorInfo += `\n💵 Commission rate is ${validator.commission}`;
    }
    
    // version
    if (validator.updated) {
        validatorInfo += `\n🆙 Up to date with version \`${validator.version}\``;
    } else {
        validatorInfo += `\n❗ Out of date with version \`${validator.version}\``;
    }
    // first discovered
    const firstDiscovered = moment.utc(new Date(validator.discoveredAt)).format('MMMM Do YYYY, HH:mm:ss');
    validatorInfo += `\n📡 First discovered on ${firstDiscovered} UTC`;
    // last updated
    const lastUpdated = moment.utc(new Date(validator.lastUpdated)).format('MMMM Do YYYY, HH:mm:ss');
    validatorInfo += `\n\n_Last updated ${lastUpdated} UTC_`;

    await sendMessage(chatId, validatorInfo);
    return validator;
}

async function sendValidatorNotFoundByName(chatId, name) {
    const message = markdownEscape(name) + ' was not found.';
    await sendMessage(chatId, message);
}

async function sendValidatorRemoved(chatId, validatorName) {
    const message = markdownEscape(validatorName) + ' has been removed.';
    await sendMessage(chatId, message);
}

async function sendUnrecognizedCommand(chatId) {
    const message = `Sorry, I don't understand that command. Please try again, or use the command /help for a list of available commands.`;
    await sendMessage(chatId, message);
}

async function sendBlocksAuthored(chatId, validator, blockNumbers) {
    let message;
    if (blockNumbers == 0) { 
        return; 
    } else if (blockNumbers.length == 1) {
        message = `${validator.name} has authored block ` 
            + `[${blockNumbers[0]}](https://${config.networkName.toLowerCase()}.subscan.io/block/${blockNumbers[0]}).`;
    } else if (blockNumbers.length < 11) {
        message = `${validator.name} has authored blocks `
            + blockNumbers.map(blockNumber => `[${blockNumber}](https://${config.networkName.toLowerCase()}.subscan.io/block/${blockNumber})`).join(', ')
            + '.';
    } else {
        message = `${validator.name} has authored ${blockNumbers.length} blocks.`;
    }
    return await sendMessage(chatId, message);
}

async function sendInvalidStashAddress(chatId) {
    const message = `Sorry, that doesn't look like a valid ${config.networkName} address. Please try again.`;
    await sendMessage(chatId, message);
}

async function sendValidatorAlreadyAdded(validator, chatId) {
    const message = `${validator.name} is already added.`;
    await sendMessage(chatId, message);
}

async function sendValidatorFetchInProgress(chatId) {
    const message = `⏳ Fetching validator node data...`;
    await sendMessage(chatId, message);
}

async function sendNoValidators(chatId) {
    const message = `You haven't yet added a validator. Please use the /add command to add your validator(s).`;
    await sendMessage(chatId, message);
}

async function sendAddValidator(chatId) {
    let exampleAddress = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';
    if (config.networkName == 'Kusama') {
        exampleAddress = 'F9VqNhAYxAnSh7cUpdVpFp5eKNHGL44AiBdH3FKbbjHFYCd';
    }
    const message = `Let's add your validator. Please enter your stash address (e.g. \`${exampleAddress}\`).`;
    await sendMessage(chatId, message);
}

async function sendValidatorSelection(validators, chatId, message) {
    const buttons = validators.map(validator => [{text: validator.name}]);
    const replyMarkup = {
        keyboard: buttons,
        resize_keyboard: true,
        one_time_keyboard: true
    };
    await sendMessage(chatId, message, replyMarkup);
}

async function sendAbout(chatId) {
    const message = 
`*v${config.version}*

*Developer:* Kutsal Kaan Bilgin
*Mail:* kutsal@helikon.tech
*Repo:* [https://github.com/kukabi/polkadot-kusama-1kv-telegram-bot](github.com/kukabi/polkadot-kusama-1kv-telegram-bot)
*Matrix:* \`kukabi@helikon:matrix.org\`

*Validator & Stash Address:* \`GC8fuEZG4E5epGf5KGXtcDfvrc6HXE7GJ5YnbiqSpqdQYLg\`
*1KV Validator Name:* ⛰  Helikon Labs 001  ⛰

Feel free to tip or nominate my stash/validator:)
Please submit issues to the [GitHub repo](github.com/kukabi/polkadot-kusama-1kv-telegram-bot) for any bugs or ideas.
Happy validating 🎉
`;
    await sendMessage(chatId, message);
}

async function sendHelp(chatId) {
    const message = dedent(
        `Here's a list of commands to help you receive notifications about your validator node in the [${config.networkName} Thousand Validators Programme](${config.network1KVInfoURL}).
        
        /add - add a new validator
        /remove - remove an existing validator
        /validatorinfo - get information about one of the added validators
        /stakinginfo - view self, active and inactive stake amounts
        /settings - configure the bot (only block authorship notification frequency for the moment)
        /about - version and developer info
        /help - display this message`
    );
    await sendMessage(chatId, message);
}

async function sendUnclaimedPayoutWarning(validator, eras) {
    const erasString = eras.join(', ');
    const message = `💰 *${validator.name}* has unclaimed rewards for ${eras.length > 1 ? 'eras' : 'era'} ${erasString}. Please [claim your payouts](https://polkadot.js.org/apps/#/staking/payout) as soon as possible.`
    for (let chatId of validator.chatIds) {
        await sendMessage(chatId, message);
    }
}

async function sendChatHasMaxValidators(chatId, maxValidatorsPerChat) {
    const message = `You cannot have more than ${maxValidatorsPerChat} validators per chat.`;
    await sendMessage(chatId, message);
}

async function sendLoadingStakingInfo(chatId) {
    const message = 'Loading staking info, please wait.';
    await sendMessage(chatId, message);
}

async function sendStakingInfo(chatId, stakingInfo) {
    
    const message = dedent(
        `*Self Stake:* ${formatAmount(stakingInfo.selfStake)}
        *Total Active:* ${formatAmount(stakingInfo.active.totalStake)} from ${stakingInfo.active.stakes.length} nominator(s) and self stake
        *Total Inactive:* ${formatAmount(stakingInfo.inactive.totalBonded)} from ${stakingInfo.inactive.nominations.length} nominator(s)`
    );
    await sendMessage(chatId, message);
}

async function sendReleaseNotes(chatId) {
    const message = `📣 Bot upgraded to *v${config.version}*\n\n` + releaseNotes;
    await sendMessage(chatId, message);
}

async function deleteMessage(chatId, messageId) {
    let body = {
        chat_id: chatId,
        message_id: messageId
    };
    const response = await fetch(
        telegramBaseURL + '/deleteMessage',
        {
            method: 'post',
            body:    JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        }
    );
    const successful = response.status % 200 < 100;
    if (successful) {
        logger.info(`Message ${messageId} deleted.`);
    } else {
        logger.error(`Error while deleting message ${messageId}.`);
    }
    return successful;
}

module.exports = {
    formatAmount: formatAmount,
    sendMessage: sendMessage,
    sendTypingAction: sendTypingAction,
    sendValidatorNotFound: sendValidatorNotFound,
    sendValidatorAdded: sendValidatorAdded,
    sendUnexpectedError: sendUnexpectedError,
    sendValidatorInfo: sendValidatorInfo,
    sendValidatorNotFoundByName: sendValidatorNotFoundByName,
    sendValidatorRemoved: sendValidatorRemoved,
    sendUnrecognizedCommand: sendUnrecognizedCommand,
    sendBlocksAuthored: sendBlocksAuthored,
    sendInvalidStashAddress: sendInvalidStashAddress,
    sendValidatorAlreadyAdded: sendValidatorAlreadyAdded,
    sendValidatorFetchInProgress: sendValidatorFetchInProgress,
    sendNoValidators: sendNoValidators,
    sendAddValidator: sendAddValidator,
    sendValidatorSelection: sendValidatorSelection,
    sendAbout: sendAbout,
    sendHelp: sendHelp,
    sendUnclaimedPayoutWarning: sendUnclaimedPayoutWarning,
    sendChatHasMaxValidators: sendChatHasMaxValidators,
    sendSettings: sendSettings,
    sendLoadingStakingInfo: sendLoadingStakingInfo,
    sendStakingInfo: sendStakingInfo,
    sendReleaseNotes: sendReleaseNotes,
    answerCallbackQuery: answerCallbackQuery,
    deleteMessage: deleteMessage
};