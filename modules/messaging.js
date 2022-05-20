/**
 * Telegram messaging module.
 */
const fetch = require('node-fetch');
const dedent = require('dedent');
const moment = require('moment');
const markdownEscape = require('markdown-escape');
const fs = require('fs');
const FormData = require('form-data');
const D3Node = require('d3-node');
const d3 = require('d3');
const sharp = require('sharp');
const divide = require('divide-bigint');

const logger = require('./logging');
const config = require('./config').config;
const Data = require('./data');

const telegramBaseURL = `https://api.telegram.org/bot${config.telegramBotAuthKey}`;
const graphFontFamily = 'DejaVuSans';

function toFixedWithoutRounding (value, precision) {
    var factorError = Math.pow(10, 14);
    var factorTruncate = Math.pow(10, 14 - precision);
    var factorDecimal = Math.pow(10, precision);
    return Math.floor(
        Math.floor(value * factorError + 1) / factorTruncate
    ) / factorDecimal;
}

const formatAmount = amount => {
    const value = toFixedWithoutRounding(
        amount, 4
    ).toLocaleString(
        'en-US',
        { minimumFractionDigits: 4 }
    );
    return `${value} ${config.tokenSymbol}`
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

async function sendImage(chatId, filePath, fileName) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('reply_markup', '{ "remove_keyboard": true }');
    form.append(
        'photo',
        fs.readFileSync(filePath),
        {
            contentType: 'image/png',
            name: 'photo',
            filename: fileName,
        }
    );
    const response = await fetch(
        telegramBaseURL + '/sendPhoto',
        {
            method: 'post',
            body: form
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
            logger.info(`Image "${fileName}" sent to chat ${chatId} successfully.`);
            return responseJSON.result;
        } catch (error) {
            return null;
        }
    } else {
        logger.error(`Error while sending image "${fileName}" to chat ${chatId}.`);
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
    const message = `${markdownEscape(validator.name)} has been added to your list.` 
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

async function sendSettingsMenu(chat, messageId) {
    const keyboard = [
        [{ text: '- NOTIFICATION SETTINGS -', callback_data: 'no_op' }],
        [{ text: 'Block Authorship ->', callback_data: `{"goToSubMenu": "blockAuthorshipNotificationSettings"}` }],
        [{ text: 'Unclaimed Payouts ->', callback_data: `{"goToSubMenu": "unclaimedPayoutNotificationSettings"}` }],
        [{ text: (chat.sendNewNominationNotifications ? '🟢' : '⚪') + ' New Nominations', callback_data: '{"sendNewNominationNotifications": ' + (chat.sendNewNominationNotifications ? 'false' : 'true') + '}'}],
        [{ text: (chat.sendChillingEventNotifications ? '🟢' : '⚪') + ' Chilling Events', callback_data: '{"sendChillingEventNotifications": ' + (chat.sendChillingEventNotifications ? 'false' : 'true') + '}'}],
        [{ text: (chat.sendOfflineEventNotifications ? '🟢' : '⚪') + ' Offline Offence', callback_data: '{"sendOfflineEventNotifications": ' + (chat.sendOfflineEventNotifications ? 'false' : 'true') + '}'}],
        [{ text: '-> Close <-', callback_data: '{"closeSettings": true}'}]
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

async function sendBlockAuthorshipNotificationSettings(chat, messageId) {
    const keyboard = [
        [{ text: '- BLOCK AUTHORSHIP NOTIFICATIONS -', callback_data: 'no_op'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.OFF ? '🔴' : '⚪') + ' Off', callback_data: '{"blockNotificationPeriod": -1}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.IMMEDIATE ? '🟢' : '⚪') + ' Immediately', callback_data: '{"blockNotificationPeriod": 0}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.HOURLY ? '🟢' : '⚪️') + ' Hourly', callback_data: '{"blockNotificationPeriod": 60}'}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.HALF_ERA ? '🟢' : '⚪️') + ` End of every half era (${config.eraLengthMins / (2 * 60)} hours)`, callback_data: `{"blockNotificationPeriod": ${config.eraLengthMins / 2}}`}],
        [{ text: (chat.blockNotificationPeriod == Data.BlockNotificationPeriod.ERA_END ? '🟢' : '⚪️') + ` End of every era (${config.eraLengthMins / 60} hours)`, callback_data: `{"blockNotificationPeriod": ${config.eraLengthMins}}`}],
        [{ text: '<- Back', callback_data: '{"backToSettingsMenu": true}'}]
    ]
    const replyMarkup = {
        inline_keyboard: keyboard
    };
    return await updateMessage(chat.chatId, messageId, 'Please configure below.', replyMarkup);
}

async function sendUnclaimedPayoutNotificationSettings(chat, messageId) {
    const keyboard = [
        [{ text: '- UNCLAIMED PAYOUT NOTIFICATIONS -', callback_data: 'no_op'}],
        [{ text: (chat.unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.OFF ? '🔴' : '⚪') + ' Off', callback_data: '{"unclaimedPayoutNotificationPeriod": -1}'}],
        [{ text: (chat.unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.EVERY_ERA ? '🟢' : '⚪') + ' Every era', callback_data: '{"unclaimedPayoutNotificationPeriod": 1}'}],
        [{ text: (chat.unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.TWO_ERAS ? '🟢' : '⚪️') + ' Every 2 eras', callback_data: '{"unclaimedPayoutNotificationPeriod": 2}'}],
        [{ text: (chat.unclaimedPayoutNotificationPeriod == Data.UnclaimedPayoutNotificationPeriod.FOUR_ERAS ? '🟢' : '⚪️') + ` Every 4 eras`, callback_data: '{"unclaimedPayoutNotificationPeriod": 4}' }],
        [{ text: '<- Back', callback_data: '{"backToSettingsMenu": true}'}]
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
    if (validator.isValid) {
        validatorInfo += `\n✅ Is valid 1KV validator`;
    } else {
        validatorInfo += `\n❌ Is not valid for 1KV:`;
        for (let validityItem of validator.validityItems) {
            if (!validityItem.valid) {
                validatorInfo += `\n- ${validityItem.details}`
            }
        }
    }
    // online / offline
    if (validator.offlineSince == 0) {
        if (validator.onlineSince) {
            const onlineSince = moment.utc(new Date(validator.onlineSince)).format('MMMM Do YYYY, HH:mm:ss');
            validatorInfo += `\n🟢 Online since ${onlineSince} UTC`;
        } else {
            validatorInfo += `\n🟢 Online`;
        }
    } else if (validator.offlineSince > 0) {
        const offlineSince = moment.utc(new Date(validator.offlineSince)).format('MMMM Do YYYY, HH:mm:ss');
        validatorInfo += `\n🔴 Offline since ${offlineSince} UTC`;
    }
    // active set
    if (validator.isActiveInSet) {
        validatorInfo += `\n🚀 Is an active validator`;
    } else {
        validatorInfo += `\n⏸ Is not an active validator`;
    }
    // controller
    if (validator.controllerAddress) {
        validatorInfo += `\n⚓️ Controller: [${validator.controllerAddress.slice(0, 6)}..${validator.controllerAddress.slice(-6)}](https://${config.networkName.toLowerCase()}.subscan.io/account/${validator.controllerAddress})`
    }
    // session keys
    if (validator.sessionKeys) {
        const sessionKeys = validator.sessionKeys.slice(0, 8) + '..' + validator.sessionKeys.slice(-8);
        validatorInfo += `\n🔑 Session keys: ${sessionKeys}`;
    }
    // commission
    if (validator.commission) {
        validatorInfo += `\n💵 ${markdownEscape(validator.commission)} commission`;
    }
    // location
    if (validator.location) {
        validatorInfo += `\n🌏 Location: ${markdownEscape(validator.location)}`;
    }
    // version
    if (validator.version) {
        validatorInfo += `\n🧬 Is running version ${markdownEscape(validator.version)}`;
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
        message = `${markdownEscape(validator.name)} has authored block ` 
            + `[${blockNumbers[0]}](https://${config.networkName.toLowerCase()}.subscan.io/block/${blockNumbers[0]}).`;
    } else if (blockNumbers.length < 11) {
        message = `${markdownEscape(validator.name)} has authored blocks `
            + blockNumbers.map(blockNumber => `[${blockNumber}](https://${config.networkName.toLowerCase()}.subscan.io/block/${blockNumber})`).join(', ')
            + '.';
    } else {
        message = `${markdownEscape(validator.name)} has authored ${blockNumbers.length} blocks.`;
    }
    return await sendMessage(chatId, message);
}

async function sendNewNomination(chatId, validator, nomination) {
    let message = dedent(
        `⭐️ ${markdownEscape(validator.name)} received a nomination!
        *Nominator:* [${nomination.nominator.slice(0, 6) + '..' + nomination.nominator.slice(-6)}](https://${config.networkName.toLowerCase()}.subscan.io/account/${nomination.nominator})
        *Stake:* ${formatAmount(nomination.activeStake)}
        *Nominee Count:* ${nomination.validatorAddresses.length}
        *Extrinsic:* [link](https://${config.networkName.toLowerCase()}.subscan.io/extrinsic/${nomination.blockNumber}-${nomination.extrinsicIndex})
        `
    );
    await sendMessage(chatId, message);
}

async function sendChilling(chatId, validator, chilling) {
    let message = dedent(
        `🥶 ${markdownEscape(validator.name)} got chilled!
        Controller [${chilling.controllerAddress.slice(0, 4)}..${chilling.controllerAddress.slice(-4)}](https://${config.networkName.toLowerCase()}.subscan.io/account/${chilling.controllerAddress}) declared no desire to validate.
        Effects will be felt at the beginning of the next era.
        *Extrinsic:* [link](https://${config.networkName.toLowerCase()}.subscan.io/extrinsic/${chilling.blockNumber}-${chilling.extrinsicIndex})
        `
    );
    await sendMessage(chatId, message);
}

async function sendOfflineEvent(chatId, validator, offlineEvent) {
    let message = dedent(
        `🆘 ${markdownEscape(validator.name)} was found to be offline at the end of the session!
        *Event:* [link](https://${config.networkName.toLowerCase()}.subscan.io/event/${offlineEvent.blockNumber}-${offlineEvent.eventIndex})
        `
    );
    await sendMessage(chatId, message);
}

async function sendInvalidStashAddress(chatId) {
    const message = `Sorry, that doesn't look like a valid ${config.networkName} address. Please try again.`;
    await sendMessage(chatId, message);
}

async function sendValidatorAlreadyAdded(validator, chatId) {
    const message = `${markdownEscape(validator.name)} is already added.`;
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

async function sendAddressSelectionForRewards(validators, chatId) {
    let replyMarkup = null;
    let message = 'Please enter an address to view the rewards report for:'
    if (validators.length > 0) {
        message = 'Please select a validator stash address from below, or enter *any validator or nominator address* to view the rewards report:'
        const buttons = validators.map(validator => [{text: validator.name}]);
        replyMarkup = {
            keyboard: buttons,
            resize_keyboard: true,
            one_time_keyboard: true
        };
    }
    await sendMessage(chatId, message, replyMarkup);
}

async function sendAbout(chatId) {
    const message = 
`*v${config.version}*

*Developer:* Kutsal Kaan Bilgin | Helikon Labs
*Mail:* kutsal@helikon.tech
*Repo:* [https://github.com/helikon-labs/polkadot-kusama-1kv-telegram-bot](github.com/helikon-labs/polkadot-kusama-1kv-telegram-bot)
*Matrix:* \`@helikon:matrix.org\`

*KSM Validator:* \`GC8fuEZG4E5epGf5KGXtcDfvrc6HXE7GJ5YnbiqSpqdQYLg\`
*DOT Validator:* \`123kFHVth2udmM79sn3RPQ81HukrQWCxA1vmTWkGHSvkR4k1\`

Feel free to tip or nominate our stash/validator:)
Please submit issues to the [GitHub repo](github.com/helikon-labs/polkadot-kusama-1kv-telegram-bot) for any bugs or ideas.
Happy validating 🎉
`;
    await sendMessage(chatId, message);
}

async function sendHelp(chatId) {
    const message = dedent(
        `Here's a list of commands to help you receive notifications about your validator node in the [${config.networkName} Thousand Validators Programme](${config.network1KVInfoURL}).

        /migrate - migrate your validators to the SubVT Bot
        /add - add a new validator
        /remove - remove an existing validator
        /validatorinfo - get information about one of the added validators
        /rewards - view the monthly rewards chart for a validator or any other address
        /stakinginfo - view self, active and inactive stake amounts
        /settings - configure the bot
        /about - version and developer info
        /help - display this message`
    );
    await sendMessage(chatId, message);
}

async function sendUnclaimedPayoutWarning(validator, chatIds, eras) {
    const erasString = eras.join(', ');
    const message = `💰 *${markdownEscape(validator.name)}* has unclaimed rewards for ${eras.length > 1 ? 'eras' : 'era'} ${erasString}. Please [claim your payouts](https://polkadot.js.org/apps/#/staking/payout) as soon as possible.`
    for (let chatId of chatIds) {
        await sendMessage(chatId, message);
    }
}

async function sendChatHasMaxValidators(chatId, maxValidatorsPerChat) {
    const message = `You cannot have more than ${maxValidatorsPerChat} validators per chat.`;
    await sendMessage(chatId, message);
}

async function sendLoadingStakingInfo(chatId) {
    const message = 'Loading staking info, it may take a while.';
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

async function sendMigrationFixedNotice(chatId) {
    let targetChat;
    if (config.networkName == 'Kusama') {
        targetChat = markdownEscape('@subvt_kusama_bot');
    } else {
        targetChat = markdownEscape('@subvt_polkadot_bot');
    }
    const message = `✅ A fix has been submitted for the /migrate command. Please retry to /migrate your validators. If you still encounter an error please use the /add command on ${targetChat} to add your validators.`;
    await sendMessage(chatId, message);
}

async function sendReleaseNotes(chatId) {
    let targetChat;
    if (config.networkName == 'Kusama') {
        targetChat = markdownEscape('@subvt_kusama_bot');
    } else {
        targetChat = markdownEscape('@subvt_polkadot_bot');
    }
    const releaseNotes =
`📣 ATTENTION 📣

${config.networkName} 1KV Bot is being deprecated in favour of the SubVT ${config.networkName} Bot, a super-powered upgrade of this bot rewritten in Rust that supports all ${config.networkName} validators (1KV or not), an effort [supported](https://github.com/w3f/Grants-Program/blob/master/applications/subvt-telegram-bot.md) by the Web3 Foundation Grants Program.

➡️ Please use the /migrate command and follow the instructions to export your validators to the SubVT ${config.networkName} Bot (${targetChat}) and continue there.

With the new bot you'll have access to all the features of this bot and many more such as:

- Democracy notifications (referendum started, cancelled, voted, etc.).
- List your NFTs and visit their URLs.
- View open referenda and your validators' votes.
- View network status.
- More on-chain notifications.
- Payouts report.
- View nomination summary and nomination details.
- View a summary of all your validators.
- Fine-grained configuration of all notifications.

This bot is going to be deprecated and become non-functional next Tuesday, the 24th of May at 14:30 UTC.

➡️ You can begin your transition now with the /migrate command if you haven't already.

Happy validating! 🎉`;
    await sendMessage(chatId, releaseNotes);
}

async function sendAlreadyMigrated(chatId, targetChat) {
    const message = `Chat has been migrated to ${targetChat}, you may safely delete this chat and continue there.`;
    await sendMessage(chatId, message);
}

async function sendMigrationCode(chatId, targetChat, migrationCode) {
    let message = 
`Your chat is now ready to be migrated to ${targetChat}.
Your migration code is \`${migrationCode}\`.

Please follow the steps below to export your validators:
1. Start a chat with ${targetChat}.
2. Run the command \`/migrate\` on that chat.
3. Enter your migration code \`${migrationCode}\`.`;
    await sendMessage(chatId, message);
}

async function sendNothingToMigrate(chatId, targetChat) {
    let message = `You haven't added any validators yet. You can start a fresh chat with ${targetChat}.`;
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

async function sendRewardsReport(chatId, targetStashAddress, rewards) {
    if (rewards.length == 0) {
        await sendMessage(chatId, 'No rewards found so far for the given validator/address.');
        return;
    }
    var total = BigInt('0');
    for (let reward of rewards) {
        total += BigInt(reward.amount);
    }
    // process data - group rewards by month of year
    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const monthlyRewards = {};
    let max = 0;
    for (let reward of rewards) {
        let date = new Date(reward.timestamp);
        let key = months[date.getMonth()] + ' ' + date.getFullYear().toString().substr(2);
        if (!monthlyRewards[key]) {
            monthlyRewards[key] = Number(0);
        }
        monthlyRewards[key] += divide(BigInt(reward.amount), BigInt(Math.pow(10, config.tokenDecimals)));
        if (monthlyRewards[key] > max) { max = monthlyRewards[key]; }
    }
    // prepare d3
    const options = {
        d3Module: d3,
        selector: '#chart',
        container: '<div id="container"><div id="chart"></div></div>'
    };
    const d3n = new D3Node(options);
    const margin = {
        top: 10, right: 10, bottom: 40, left: 0 
    };
    const svgWidth = 1200;
    const svgHeight = 600;
    const width = 1200 - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;
    const svg = d3n.createSVG(svgWidth, svgHeight);

    // setup x-axis
    const xScale = d3.scaleBand().range([0, width - 70]).padding(0.1);
    xScale.domain(Object.keys(monthlyRewards));
    // setup y-axis
    const yScale = d3.scaleLinear().range([height, 20]);
    yScale.domain([0, max * 1.2]);
    // set background
    svg.append('rect')
        .attr('width', '100%')
        .attr('height', '100%')
        .style('fill', 'white');
    // add title
    svg.append('text')
        .attr('x', 442)
        .attr('y', 40)
        .attr('font-family', graphFontFamily)
        .attr('font-size', '17px')
        .text('Monthly Staking Rewards for ' + targetStashAddress.slice(0, 4) + '..' + targetStashAddress.slice(-4));

    svg.append("rect")
        .attr('x', 940)
        .attr('y', 15)
        .attr('width', 220)
        .attr('height', 40)
        .style('fill', '#00000000')
        .style('stroke', '#BBBBBB');
    svg.append('text')
        .attr('x', 950)
        .attr('y', 40)
        .attr('font-family', graphFontFamily)
        .attr('font-size', '17px')
        .text('Total: ' + 
            formatAmount(
                divide(
                    total, 
                    BigInt(Math.pow(10, config.tokenDecimals))
                )
            )
        );
            
    // append a group element to which the bars and axes will be added to.
    svg.append('g').attr('transform', `translate(${ 100 }, ${ 100 })`);
    // appending x-axis
    svg.append('g')
        .attr('transform', `translate(50, ${ height })`)
        .call(
            d3.axisBottom(xScale)//.tickFormat('ABC')
        )
        .selectAll('text')
        .attr('transform', 'rotate(-65)')
        .style('text-anchor', 'end')
        .attr('dx', '-.8em')
        .attr('dy', '-.0em')
        .attr('font-family', graphFontFamily)
        .attr('font-size', '10px');
    // append y-axis
    svg.append('g')
        .attr('transform', 'translate(50, 0)')
        .call(
            d3.axisLeft(yScale).tickFormat((d) => { return d.toFixed(2); })
            .ticks(10)
        )
        .attr('font-family', graphFontFamily)
        .attr('font-size', '10px')
        .append('text')
        .attr('y', 20)
        .attr('x', 90)
        .attr('fill', 'black')
        .attr('font-family', graphFontFamily)
        .attr('font-size', '12px')
        .text(`Reward (${config.tokenSymbol})`);
    // append the bars
    svg.selectAll('.bar')
        .data(Object.keys(monthlyRewards))
        .enter().append('rect')
        .attr('transform', 'translate(50, 0)')
        .attr('class', 'bar')
        .attr('x', (key) => { return xScale(key); })
        .attr('y', (key) => { return yScale(monthlyRewards[key]); })
        .attr('width', xScale.bandwidth())
        .attr('height', (key) => { return height - yScale(monthlyRewards[key]); })
        .style('fill', '#0f7e9b');
    
    svg.selectAll('text.bar')
        .data(Object.keys(monthlyRewards))
        .enter().append('text')
        .attr('class', 'bar')
        .text(
            function(key) {
                const text = formatAmount(monthlyRewards[key]).replace(
                    ` ${config.tokenSymbol}`,
                    ''
                );
                if (Object.keys(monthlyRewards).length < 23) {
                    return text;
                } else {
                    return text.substr(0, text.length - 2);
                }
            }
        )
        .attr('font-family', graphFontFamily)
        .attr('font-size', '13px')
        .attr('x', function(key) { return xScale(key) + xScale.bandwidth() / 2 + 47; })
        .attr('y', function(key) { return yScale(monthlyRewards[key]) - 8; })
        .attr('text-anchor', 'middle')
    // create SVG
    const timestamp = new Date().getTime();
    const svgFileName = targetStashAddress + '_' + timestamp + '.svg';
    const pngFileName = targetStashAddress + '_' + timestamp + '.png';
    const svgFilePath = config.tempFileDir + '/' + svgFileName;
    const pngFilePath = config.tempFileDir + '/' + pngFileName;
    fs.writeFileSync(
        svgFilePath,
        d3n.svgString()
    );
    // convert SVG to PNG
    sharp(svgFilePath)
        .png()
        .toFile(pngFilePath)
        .then(async (info) => {
            logger.info('SVG to PNG conversion completed', info);
            // delete SVG
            fs.unlinkSync(svgFilePath);
            // send image
            await sendImage(chatId, pngFilePath, pngFileName);
            // delete PNG
            fs.unlinkSync(pngFilePath);
        })
        .catch((err) => {
            logger.error(err);
        });
}

module.exports = {
    formatAmount: formatAmount,
    sendMessage: sendMessage,
    sendImage: sendImage,
    sendTypingAction: sendTypingAction,
    sendValidatorNotFound: sendValidatorNotFound,
    sendValidatorAdded: sendValidatorAdded,
    sendUnexpectedError: sendUnexpectedError,
    sendValidatorInfo: sendValidatorInfo,
    sendValidatorNotFoundByName: sendValidatorNotFoundByName,
    sendValidatorRemoved: sendValidatorRemoved,
    sendUnrecognizedCommand: sendUnrecognizedCommand,
    sendBlocksAuthored: sendBlocksAuthored,
    sendNewNomination: sendNewNomination,
    sendChilling: sendChilling,
    sendOfflineEvent: sendOfflineEvent,
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
    sendSettingsMenu: sendSettingsMenu,
    sendBlockAuthorshipNotificationSettings: sendBlockAuthorshipNotificationSettings,
    sendUnclaimedPayoutNotificationSettings: sendUnclaimedPayoutNotificationSettings,
    sendLoadingStakingInfo: sendLoadingStakingInfo,
    sendStakingInfo: sendStakingInfo,
    sendReleaseNotes: sendReleaseNotes,
    answerCallbackQuery: answerCallbackQuery,
    deleteMessage: deleteMessage,
    sendAddressSelectionForRewards: sendAddressSelectionForRewards,
    sendRewardsReport: sendRewardsReport,
    sendAlreadyMigrated: sendAlreadyMigrated,
    sendMigrationCode: sendMigrationCode,
    sendNothingToMigrate: sendNothingToMigrate,
    sendMigrationFixedNotice: sendMigrationFixedNotice
};