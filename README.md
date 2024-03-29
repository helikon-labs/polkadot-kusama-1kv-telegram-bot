<p align="center"><img width="65" 
src="https://raw.githubusercontent.com/helikon-labs/polkadot-kusama-1kv-telegram-bot/deprecated/readme_files/polkadot_white_over_pink_deprecated.png">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<img 
width="65" 
src="https://raw.githubusercontent.com/helikon-labs/polkadot-kusama-1kv-telegram-bot/deprecated/readme_files/kusama_canary_white_over_pink_deprecated.png"></p>

## Polkadot & Kusama Thousand Validators Programme (1KV) Telegram Bot

[![Chat on Telegram](https://img.shields.io/badge/Chat%20on-Telegram-brightgreen.svg)](https://t.me/kusama_1kv_bot) 

---

### ⚠️ Deprecation Notice

This bot is deprecated in favor of the [SubVT Telegram Bot](https://github.com/helikon-labs/subvt-backend/tree/development/subvt-telegram-bot), a migration effort proudly supported by the [Web3 Foundation Grants Program](https://github.com/w3f/Grants-Program/blob/master/applications/subvt-telegram-bot.md), initially proposed in the [issue #9](https://github.com/helikon-labs/polkadot-kusama-1kv-telegram-bot/issues/9) on this repository.

You can find the SubVT Polkadot Bot available for chat [here](https://t.me/subvt_polkadot_bot), and the Kusama bot [here](https://t.me/subvt_kusama_bot). If you'd like to transfer your validators from the 1KV Bot to the SubVT Bot, just run the `/migrate` command on the 1KV Bot and follow the instructions.

---

### 📣 W3F Grant Program Notice

This bot will soon be migrated to use the [SubVT](https://github.com/helikon-labs/subvt) (Substrate Validator Toolkit) backend, become [SubVT (Substrate Validator Toolkit) Telegram Bot](https://github.com/w3f/Grants-Program/blob/master/applications/subvt-telegram-bot.md) and support all validators of Polkadot and Kusama. The migration effort is proudly supported by the [Web3 Foundation Grants Program](https://web3.foundation/grants/). You may find more about SubVT on the initial Kusama Treasury spending [proposal](https://kusama.polkassembly.io/post/683) along with the milestones 1-3 [progress](https://kusama.polkassembly.io/post/683#06d9efa6-d070-4c78-b59f-5ea958e93ce0), also please take a look at the SubVT top-level [repository](https://github.com/helikon-labs/subvt) for more documentation.

---

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

- First go through the [Telegram Bot API documentation](https://core.telegram.org/bots/api) and get your bot registered.
- Get a local or remote MongoDB instance running.
- Rename `.env.sample` to `.env` in the root direcotry, and change the variables according to your environment.
- Rename `assets/fonts/fonts.conf.sample` to `assets/fonts/fonts.conf`, and change the variables according to your environment.
- `npm install`
- `node app.js --network=polkadot` for the Polkadot 1KV, or `node app.js --network=kusama` for the Kusama 1KV.
- Start a chat with the bot, and `/add` a validator to the chat.
- Open the Mongo CLI, select the database and create a text index on the `name` field of the `validators` collection using the Mongo CLI. Example below assumes your database name is configured to be `kusama_1kv_bot` in the `.env` file in your root directory:

  First select the database:

  ```
  use kusama_1kv_bot
  ```
  
  Then create the index:
  
  ```
  db.validators.createIndex( { name: "text" } )
  ```

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
