/**
 * MongoDB bottom data access layer.
 */
const MongoClient = require('mongodb').MongoClient;
require('dotenv').config();

const mongoConfig = {
    url: process.env.MONGODB_CONNECTION_URL,
    db: 'kusama_1kv_telegram_bot',
    telegramConfigCollection: 'telegram_config',
    validatorCollection: 'validators',
    chatCollection: 'chats',
    pendingBlockNotificationCollection: 'pending_block_notifications'
}

let mongoDBClient;
let mongoDB;

async function getMongoDB() {
    const mongo = new MongoClient(
        mongoConfig.url, 
        { useNewUrlParser: true, useUnifiedTopology: true }
    );
    mongoDBClient = await mongo.connect();
    if (!mongoDBClient) {
        throw new Error('Mongo connection error: client is null.');
    }
    const db = mongoDBClient.db(mongoConfig.db);
    if (!db) {
        throw new Error('Mongo connection error: database is null.');
    }
    return db;
}

async function connectMongoDB() {
    mongoDB = await getMongoDB();
}

async function disconnectMongoDB() {
    if (mongoDBClient) {
        await mongoDBClient.close();
    }
}

async function getValidatorCollection() {
    return await mongoDB.collection(mongoConfig.validatorCollection);
}

async function getChatCollection() {
    return await mongoDB.collection(mongoConfig.chatCollection);
}

async function getTelegramConfigCollection() {
    return await mongoDB.collection(mongoConfig.telegramConfigCollection);
}

async function getPendingBlockNotificationCollection() {
    return await mongoDB.collection(mongoConfig.pendingBlockNotificationCollection);
}

module.exports = {
    connectMongoDB: connectMongoDB,
    disconnectMongoDB: disconnectMongoDB,
    getValidatorCollection: getValidatorCollection,
    getChatCollection: getChatCollection,
    getTelegramConfigCollection: getTelegramConfigCollection,
    getPendingBlockNotificationCollection: getPendingBlockNotificationCollection
};
