/**
 * Telegram messaging module.
 */
const fetch = require('node-fetch');
const dedent = require('dedent');
const moment = require('moment');
const logger = require('./logging');
const markdownEscape = require('markdown-escape');
require('dotenv').config();

const telegramBaseURL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_AUTH_KEY}`;

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
        logger.info(`Message "${message}" sent to chat ${chatId} successfully.`);
    } else {
        logger.error(`Error while sending message "${message}" sent to chat ${chatId}.`);
    }
}

async function sendValidatorNotFound(chatId, stashAddress) {
    const message = dedent('⚠️ Validator with stash address `' + stashAddress 
                    + '` was not found in the Kusama Thousand Validators Programme.'
                    + ' Please enter a different stash address.');
    await sendMessage(chatId, message);
}

async function sendValidatorAdded(chatId, validator) {
    const message = `${validator.name} has been added to your list.` 
                + ` You will receive updates regarding the status of your validator and its activity`
                + ` on the Kusama blockchain. You may use the /remove command to remove this validator`
                + ` or any other from your list and stop receiving notifications.`
                + ` You may also add more validators with the /add command.`;
    await sendMessage(chatId, message);
}

async function sendUnexpectedError(chatId) {
    const message = `I encountered an unexpected error while processing your request. Please try again later.`;
    await sendMessage(chatId, message);
}

async function sendValidatorInfo(chatId, validator) {

    // name
    let validatorInfo = markdownEscape(validator.name);
    
    // stash
    validatorInfo += `\n📍 Address ${validator.stashAddress.slice(0, 16)}..${validator.stashAddress.slice(-16)}`;

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
        const sessionKeys = validator.sessionKeys.slice(0, 12) + '..' + validator.sessionKeys.slice(-12);
        validatorInfo += `\n🔑 Session keys: ${sessionKeys}`;
        // return 
    }
    // commission
    if (validator.commission) {
        validatorInfo += `\n💵 Commission rate is ${validator.commission}`;
    }
    // nominated
    if (validator.nominatedAt && validator.nominatedAt > 0) {
        const nominatedAt = moment.utc(new Date(validator.nominatedAt)).format('MMMM Do YYYY, HH:mm:ss');
        validatorInfo += `\n🤘 Nominated on ${nominatedAt} UTC`;
    } else {
        validatorInfo += `\n👎 Is not currently nominated`;
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

async function sendBlockAuthored(validator, blockNumber) {
    const message = `${validator.name} has just authored block ${blockNumber} 🎉.`
        + `\nYou can view the block details [here](https://polkascan.io/kusama/block/${blockNumber}).`;
    for (let chatId of validator.chatIds) {
        await sendMessage(chatId, message);
    }
}

async function sendInvalidStashAddress(chatId) {
    const message = `Sorry, that doesn't look like a valid Kusama address. Please try again.`;
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
    const message = `Let's add your validator. Please enter your stash address (e.g. \`F9VqNhAYxAnSh7cUpdVpFp5eKNHGL44AiBdH3FKbbjHFYCd\`).`;
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

async function sendHelp(chatId) {
    const message = dedent(
        `Here's a list of commands to help you receive notifications about your validator node in the [Kusama Thousand Validators Programme](https://polkadot.network/join-kusamas-thousand-validators-programme/).
        
        /add - add a new validator
        /remove - remove an existing validator
        /validatorinfo - get information about one of the added validators
        /help - display this message`
    );
    await sendMessage(chatId, message);
}

async function sendClaimPaymentWarning(validator, era) {
    const message = `💰 *${validator.name}* has unclaimed rewards for era ${era}. Please [claim your payouts](https://polkadot.js.org/apps/#/staking/payout) as soon as possible.`
    for (let chatId of validator.chatIds) {
        await sendMessage(chatId, message);
    }
}

async function sendChatHasMaxValidators(chatId, maxValidatorsPerChat) {
    const message = `You cannot have more than ${maxValidatorsPerChat} validators per chat.`;
    await sendMessage(chatId, message);
}

module.exports = {
    sendMessage: sendMessage,
    sendValidatorNotFound: sendValidatorNotFound,
    sendValidatorAdded: sendValidatorAdded,
    sendUnexpectedError: sendUnexpectedError,
    sendValidatorInfo: sendValidatorInfo,
    sendValidatorNotFoundByName: sendValidatorNotFoundByName,
    sendValidatorRemoved: sendValidatorRemoved,
    sendUnrecognizedCommand: sendUnrecognizedCommand,
    sendBlockAuthored: sendBlockAuthored,
    sendInvalidStashAddress: sendInvalidStashAddress,
    sendValidatorAlreadyAdded: sendValidatorAlreadyAdded,
    sendValidatorFetchInProgress: sendValidatorFetchInProgress,
    sendNoValidators: sendNoValidators,
    sendAddValidator: sendAddValidator,
    sendValidatorSelection: sendValidatorSelection,
    sendHelp: sendHelp,
    sendClaimPaymentWarning: sendClaimPaymentWarning,
    sendChatHasMaxValidators: sendChatHasMaxValidators
};