<p align="center"><img width="65" src="https://raw.githubusercontent.com/helikon-labs/kusama-1kv-telegram-bot/main/readme_files/polkadot_white_over_pink.png">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<img width="65" src="https://raw.githubusercontent.com/helikon-labs/kusama-1kv-telegram-bot/main/readme_files/kusama_canary_white_over_pink.png"></p>

## Polkadot & Kusama Thousand Validators Programme (1KV) Telegram Bot

[![Chat on Telegram](https://img.shields.io/badge/Chat%20on-Telegram-brightgreen.svg)](https://t.me/kusama_1kv_bot) 

A telegram bot for the validators enrolled in the [Polkadot](https://polkadot.network/supporting-decentralization-join-the-polkadot-thousand-validators-programme/) and [Kusama Thousand Validators Programme](https://polkadot.network/join-kusamas-thousand-validators-programme/). You may find Polkadot bot available for chat at [https://t.me/polkadot_1kv_bot](https://t.me/polkadot_1kv_bot), and the Kusama bot at [https://t.me/kusama_1kv_bot](https://t.me/kusama_1kv_bot).

This bot helps the node operators enrolled in the Kusama and Polkadot 1KV Programme to get information and notifications about their validators. Operators can view validator information and staking rewards reports, and receive notifications when the validator:

- 🔴 goes offline or 🟢 comes back online
- ⭐️ receives a new nomination
- 🥶 submits a chill extrinsic
- 🆘 commits an offline offence
- 📈 gains or 📉 loses rank
- 🚀 enters or ⏸ leaves the active validator set
- 🔑 updates session keys 
- ⛓ produces a block
- 💰 has unclaimed rewards for the past era or in the last 4 days
- ❗ becomes out of date or gets 🆙 to date
- ✅ is valid for 1KV or ❌ becomes invalid
- and more...

#### To run the bot yourself:

- first go through the [Telegram Bot API documentation](https://core.telegram.org/bots/api) and get your bot registered
- get a local or remote MongoDB instance running
- rename `.env.sample` to `.env`, and change the variables according to your environment
- rename `assets/fonts/fonts.conf.sample` to `assets/fonts/fonts.conf`, and change the variables according to your environment
- `npm install`
- and `node app.js --network=polkadot` for the Polkadot 1KV, or `node app.js --network=kusama` for the Kusama 1KV.

#### Available bot commands:

- `/about` display version and developer info
- `/help` display all commands
- `/add` start the process of adding a validator to the chat
- `/remove` start the process of removing a validator from the chat
- `/validatorinfo` (or `/vi`) view the details of any of the added validators
- `/rewards` view the monthly rewards chart for a validator or any other address
- `/stakinginfo` display self, active and inactive stake amounts for a validator
- `/settings` configure the bot

Don't forget to turn on push notifications for Telegram to receive alerts about your validator.

🎉 Happy validating, and you're much welcome to nominate our validators:

- Kusama `GC8fuEZG4E5epGf5KGXtcDfvrc6HXE7GJ5YnbiqSpqdQYLg`
- Polkadot `123kFHVth2udmM79sn3RPQ81HukrQWCxA1vmTWkGHSvkR4k1`