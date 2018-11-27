Nimiq-Twitter-Tip is an open-source node.js Twitter bot for tipping with altcoins. It's integrated with the Nimiq blockchain but it can be easily modified for other altcoins. 

# Installation
To install Nimiq-Twitter-Tip simply clone this repo and install the dependencies:
```
$ git clone https://github.com/rraallvv/Nimiq-Twitter-Tip
$ cd Nimiq-Twitter-Tip
$ npm install
```

# Configuration file
After installation proceed to the configuration file `twitter.yml`.

## log
Logging settings.
* **file** - File to log to. Set to `false` to disable logging to file.
* **level** - Debug level. Alowed values are `'error'`, `'warn'`, `'info'`, `'verbose'`, `'debug'`, and `'silly'`. Default value is `'info'`.

## rpc
JSON RPC API connection info.
* **host** - Daemon hostname (`localhost` if hosted on the same machine)
* **port** - Daemon RPC port (by default `8648` for Nimiq)

## coin
Basic coin settings.
* **min_withdraw** - Minimum amount of coins to withdraw
* **min_confirmations** - Minimum amount of confirmations for the current balance needed to tip/withdraw coins
* **min_tip** - Minimum amount of coins to tip
* **short_name** - Short name for the coin (e.g. `NIM`)
* **full_name** - Full name for the coin (e.g. `Nimiq`)
* **inv_precision** - Inverse of the smalest amount (e.g. 1/0.00001 or 1e5 for Nimiq)
* **miner_fee** - Fee charged on transactions to cover up the miner fees.
* **address_pattern** - The regex pattern to match in tweet when searching for the address to send/withdraw
* **random_prefix** - Prefix added to the random stamp (used to fool twitter into thinking each tweet is different) 
* **random_length** - Number of decimals of the random number in the random stamp

# Environment variables
The following environment variables are needed for Nimiq-Twitter-Tip to work. In Linux those are added to `~/.bashrc`.
```
# Twitter app
export TWITTER_USERNAME=NimiqB
export TWITTER_CONSUMER_KEY=<twitter app comsumer key>
export TWITTER_CONSUMER_SECRET=<twitter app consumer secret>
export TWITTER_ACCESS_TOKEN=<twitter app access token>
export TWITTER_ACCESS_TOKEN_SECRET=<twitter app access token>
# Nimiq jsonrpc client
export NIMIQ_RPC_USER=<nimiq jsonrpc user>
export NIMIQ_RPC_PASS=<nimiq jsonrpc password>
export NIMIQ_RPC_HOST=<server address>
export NIMIQ_RPC_PORT=<server port>
# Database
export DATABASE_HOST=<server address>
export DATABASE_USER=<database user>
export DATABASE_PASS=<database password>
# Email notifications
export GMAIL_ADDRESS=<sender email>
export OAUTH_CLIENT_ID=<gmail API client id>
export OAUTH_CLIENT_SECRET=<gmail API secret id>
export OAUTH_REFRESH_TOKEN=<gmail API refresh token>
export OAUTH_ACCESS_TOKEN=<gmail API access token>
export EMAIL_NOTIFICATION_ADDRESS=<recipient email>
```

# How does it work?
Nimiq-Twitter-Tip creates a Nimiq address for every Twitter user. Then it moves the amount of coins from one account to the other, or to some external address for withdrawals.

# How to run it?
Before running the bot, you have to be running a node in the Nimiq blockchain with JSON-RPC API enabled. JSON-RPC can be enabled using this configuration file with the node (e.g. `~/nimiq-core/settings.conf`):
```
{
  protocol: "dumb",
  type: "light",
  rpcServer: {
    enabled: "yes",
    port: 8648,
    username: "<rpc user>",
    password: "<rpc password>"
  }
}
```
To start the rpc server using this configuration file run `node clients/nodejs/index.js --config=settings.conf` from the directory where you have the Nimiq core (e.g. `~/nimiq-core/`)

To run Nimiq-Twitter-Tip execute the command `node twitter` or `npm start` in the directory where you cloned this repository.

## Commands

Instructions are executed by messaging the bot on Twitter with one of the following commands preceded by an exclamation mark.

| **Command** | **Arguments**     | **Description**
|-------------|-------------------|--------------------------------------------------------------------
| `address`   |                      | Displays address where you can send your funds to the tip bot.
| `balance`   |                      | Displays your current wallet balance.
| `help`      |                      | Displays a help message with the list of available commands.
| `send`      | `<address> <amount>` | Sends the specified amount of coins to the specified address.
| `tip`       | `<nickname> <amount>`    | Sends the specified amount of coins to the specified nickname.
| `withdraw`  | `<address>`          | Withdraws your entire balance to the specified address.

## Examples

**@NimiqB** !balance

**@NimiqB** !tip **@someuser** 5

**@NimiqB** !send NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F 5

**@NimiqB** !withdraw NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F

## "You have already sent this Tweet"

If Twitter shows the message **"You have already sent this Tweet"** simply add some random caracters at the end of the tweet like in the examples below. In the examples the caracters **"fwrh34iuhf"** put after the required parameters are simply ignored by the bot.

**@NimiqB** !balance fwrh34iuhf

**@NimiqB** !tip **@someuser** 5 fwrh34iuhf

**@NimiqB** !send NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F 5 fwrh34iuhf

**@NimiqB** !withdraw NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F fwrh34iuhf

## Important

For the tweets to appear in the receiving user's notifications tab they have to disabled the option **Quality filter** located in **Settings and Privacy > Notifications > Advanced**.

## ~~Beer~~ Coffee Fund 😄

If you like the Twitter bot please donate some NIM 
```
NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F
```