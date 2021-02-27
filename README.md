<p align="center"><img width="65" src="https://raw.githubusercontent.com/kukabi/kusama-1kv-telegram-bot/main/readme_files/kusama_canary_white_over_pink.png"></p>

## Kusama Thousand Validators Programme (1KV) Telegram Bot

[![Chat on Telegram](https://img.shields.io/badge/Chat%20on-Telegram-brightgreen.svg)](https://t.me/kusama_1kv_bot) 

A telegram bot for the validators enrolled in the [Kusama Thousand Validators Programme](https://polkadot.network/join-kusamas-thousand-validators-programme/). You may find bot available for chat at [https://t.me/kusama_1kv_bot](https://t.me/kusama_1kv_bot), or search with the username `kusama_1kv_bot` or display name `Kusama 1KV Bot`.

One may add multiple validators to the chat and the bot will notify the user when any of the validators:

- 🔴 goes offline or 🟢 comes back online
- 📈 gains or 📉 loses rank
- 🚀 enters or ⏸ leaves the active validator set
- 🤘 gets nominated or 👎 loses nominations
- 🔑 updates session keys 
- ⛓ produces a block
- 💰 has unclaimed rewards at the end of an era
- ❗ becomes out of date or gets 🆙 to date
- ✅ is valid for 1KV or ❌ becomes invalid
- and more...

#### To run the bot yourself:

- first go through the [Telegram Bot API documentation](https://core.telegram.org/bots/api) and get your bot registered
- get a local or remote MongoDB instance running
- rename `.env.sample` to `.env`, and change the variables in it according to your environment
- `npm install`
- and `node app.js`

#### Available bot commands:

- `/help` to display all commands
- `/add` to start the process of adding a validator to the chat
- `/remove` to start the process of removing a validator from the chat
- `/validatorinfo` to get details of any of the added validators

Don't forget to turn on push notifications for Telegram to receive alerts about your validator.

🎉 Happy validating, and you're much welcome to tip my stash `GC8fuEZG4E5epGf5KGXtcDfvrc6HXE7GJ5YnbiqSpqdQYLg` if you feel like it:)