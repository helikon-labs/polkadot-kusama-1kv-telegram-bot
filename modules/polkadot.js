/**
 * Polkadot/Kusama RPC access module.
 * Adopted mostly from the Kusama 1KV leaderboard site.
 */
const{ ApiPromise, WsProvider } = require('@polkadot/api');
const { decodeAddress, encodeAddress } = require('@polkadot/keyring');
const { hexToU8a, isHex } = require('@polkadot/util');
const cron = require('node-cron');
const divide = require('divide-bigint');

const logger = require('./logging');
const config = require('./config').config;

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
        if (config.networkName == 'Polkadot') {
            if (address.charAt(0) != '1') {
                return false;
            }
        } else if (config.networkName == 'Kusama') {
            if ('ABCDEFGHJKLMNPQRSTUVWXYZ'.indexOf(address.charAt(0)) < 0) {
                return false;
            }
        }
        return true;
    } catch (error) {
        return false;
    }
};

async function getCurrentEra() {
    return await api.query.staking.currentEra();
}

async function getControllerAddress(stashAddress) {
    return (await api.query.staking.bonded(stashAddress)).toString();
}

async function payoutClaimedForAddressForEra(stashAddress, era) {
    const controllerAddress = await getControllerAddress(stashAddress);
    const controllerLedger = await api.query.staking.ledger(controllerAddress);
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

async function getSelfStake(address) {
    const controller = await getControllerAddress(address);
    const ledger = (await api.query.staking.ledger(controller)).toJSON();
    const selfStake = divide(
        BigInt((ledger ? ledger.active : 0)),
        BigInt(Math.pow(10, config.tokenDecimals))
    );
    return selfStake;
}

async function getActiveStakesForEra(address, era) {
    const eraStakers = await api.query.staking.erasStakers(era, address);
    const stakes = await Promise.all(
        eraStakers.others.toJSON().map(
            async(stake) => {
                return {
                    address: stake.who.toString(),
                    amount: divide(
                        BigInt(stake.value),
                        BigInt(Math.pow(10, config.tokenDecimals))
                    )
                }
            }
        )
    );
    return {
        totalStake: divide(
            BigInt(eraStakers.total),
            BigInt(Math.pow(10, config.tokenDecimals))
        ),
        stakes: stakes
    };
}

async function getInactiveNominations(address, activeNominators) {
    const nominators = await api.query.staking.nominators.entries();
    const allNominations = await Promise.all(nominators.filter(([_, value]) => {
        return value.toHuman().targets.includes(address);
    }).map(async([key, _]) => {
        const address = key.toHuman()[0];
        const controller = await api.query.staking.bonded(address);
        const bonded = (await api.query.staking.ledger(controller.toString())).toJSON().active;
        return {
            address: address,
            bonded: divide(
                BigInt(bonded),
                BigInt(Math.pow(10, config.tokenDecimals))
            )
        }
    }));

    const inactiveNominations = allNominations.filter((nominator) => {
        let active = false;
        activeNominators.forEach((other)=> {
            if (other.address === nominator.address){
                active = true;
            }
        });
        return !active;
    });
    let totalBonded = 0;
    inactiveNominations.forEach((nominator) => {
        totalBonded += nominator.bonded;
    });
    return {
        totalBonded: totalBonded,
        nominations: inactiveNominations
    };
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

async function getRewardsInBlock(blockNumber) {
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const allRecords = await api.query.system.events.at(blockHash);
    const timestamp = await api.query.timestamp.now.at(blockHash);
    const rewards = [];
    for (let i = 0; i < allRecords.length; i++) {
        const { event } = allRecords[i];
        if (event.section.toLowerCase() == 'staking'
                && event.method.toLowerCase() == 'reward') {
            const reward = {
                blockNumber: blockNumber,
                timestamp: parseInt(timestamp.toString()),
                targetStashAddress: event.data[0].toString(),
                amount: event.data[1].toString()
            };
            rewards.push(reward);
        }
    }
    return rewards;
}

async function getNominationsInBlock(blockNumber) {
    logger.info(`Get nominations block ${blockNumber}.`);
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const block = await api.rpc.chain.getBlock(blockHash);
    const allEvents = await api.query.system.events.at(blockHash);
    const nominations = [];
    for (let index = 0; index < block.block.extrinsics.length; index++) {
        let extrinsic = block.block.extrinsics[index];
        if (!extrinsic.toHuman().isSigned) {
            continue;
        }
        let method = extrinsic.toHuman().method;
        if (method.section == 'staking' && method.method == 'nominate') {
            let nominees = extrinsic.toHuman().method.args;
            let nominator = extrinsic.toHuman().signer.Id;
            const nominatorLedger = await api.query.staking.ledger(nominator);
            const activeStake = nominatorLedger.toJSON().active;
            const validatorAddresses = [];
            for (let nominee of nominees[0]) {
                validatorAddresses.push(nominee.Id);
            }
            let filteredEvents =
                allEvents
                    // filter the specific events based on the phase and then the
                    // index of our extrinsic in the block
                    .filter(({ phase }) =>
                        phase.isApplyExtrinsic &&
                        phase.asApplyExtrinsic.eq(index)
                    );
            for (let event of filteredEvents) {
                if (api.events.system.ExtrinsicSuccess.is(event.event)) {
                    nominations.push(
                        {
                            nominator: nominator,
                            activeStake: divide(
                                BigInt(activeStake),
                                BigInt(Math.pow(10, config.tokenDecimals))
                            ),
                            validatorAddresses: validatorAddresses,
                            blockNumber: blockNumber,
                            extrinsicIndex: index
                        }
                    );
                    break;
                }
            }
        }
    }
    return nominations;
}

async function getChillingsInBlock(blockNumber) {
    logger.info(`Get chillings block ${blockNumber}.`);
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const block = await api.rpc.chain.getBlock(blockHash);
    const allEvents = await api.query.system.events.at(blockHash);
    const chillings = [];
    for (let index = 0; index < block.block.extrinsics.length; index++) {
        let extrinsic = block.block.extrinsics[index];
        if (!extrinsic.toHuman().isSigned) {
            continue;
        }
        let method = extrinsic.toHuman().method;
        if (method.section == 'staking' && method.method == 'chill') {
            let controllerAddress = extrinsic.toHuman().signer.Id;
            let filteredEvents =
                allEvents
                    // filter the specific events based on the phase and then the
                    // index of our extrinsic in the block
                    .filter(({ phase }) =>
                        phase.isApplyExtrinsic &&
                        phase.asApplyExtrinsic.eq(index)
                    ); 
            for (let event of filteredEvents) {
                if (api.events.system.ExtrinsicSuccess.is(event.event)) {
                    chillings.push(
                        {
                            controllerAddress: controllerAddress,
                            blockNumber: blockNumber,
                            extrinsicIndex: index
                        }
                    );
                    break;
                }
            }
        }
    }
    return chillings;
}

async function getOfflineEventInBlock(blockNumber) {
    logger.info(`Get offline events in block ${blockNumber}.`);
    const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
    const allEvents = await api.query.system.events.at(blockHash);
    const validatorAddresses = [];
    for (let i = 0; i < allEvents.length; i++) {
        const { event } = allEvents[i];
        if (event.section.toLowerCase() == "imonline"
            && event.method.toLowerCase() == "someoffline") {
            for (let validatorData of event.toJSON().data[0]) {
                validatorAddresses.push(validatorData[0]);
            }
            return {
                validatorAddresses: validatorAddresses,
                blockNumber: blockNumber,
                eventIndex: i
            };
        }
    }
    return null;
}

async function checkEraChange() {
    const currentEra = await getCurrentEra();
    if (currentEra > lastEra) {
        if (lastEra != 0 && onEraChange) {
            onEraChange(currentEra);
        }
        lastEra = currentEra;
    }
}

async function connectPolkadot(onFinalizedBlock, onNewEra) {
    const wsProvider = new WsProvider(config.rpcURL);
    api = new ApiPromise({ provider: wsProvider });
    await api.isReady;

    const systemProperties = (await api.rpc.system.properties()).toHuman();
    config.tokenSymbol = systemProperties.tokenSymbol[0];
    config.tokenDecimals = parseInt(systemProperties.tokenDecimals[0]);

    await api.rpc.chain.subscribeFinalizedHeads(async function(blockHeader) {
        const blockNumber = parseInt(blockHeader.number);
        const blockHash = await api.rpc.chain.getBlockHash(blockNumber);
        const header = await api.derive.chain.getHeader(blockHash);
        if (header.author) {
            onFinalizedBlock(
                blockNumber, 
                blockHash, 
                header.author.toString()
            );
        }
    });
    onEraChange = onNewEra;
    await checkEraChange();
    cron.schedule('10,30,50 * * * *', () => {
        checkEraChange();
    });
}

const disconnectPolkadot = async () => {
    if (api) {
        logger.info(`Close ${config.networkName} API connection.`);
        await api.disconnect();
    }
};

module.exports = {
    isValidAddress: isValidAddress,
    connectPolkadot: connectPolkadot,
    disconnectPolkadot: disconnectPolkadot,
    getControllerAddress: getControllerAddress,
    getIsActiveInSet: getIsActiveInSet,
    getCommission: getCommission,
    getSessionKeys: getSessionKeys,
    getCurrentEra: getCurrentEra,
    payoutClaimedForAddressForEra: payoutClaimedForAddressForEra,
    getSelfStake: getSelfStake,
    getActiveStakesForEra: getActiveStakesForEra,
    getInactiveNominations: getInactiveNominations,
    getRewardsInBlock: getRewardsInBlock,
    getNominationsInBlock: getNominationsInBlock,
    getChillingsInBlock: getChillingsInBlock,
    getOfflineEventInBlock: getOfflineEventInBlock
}