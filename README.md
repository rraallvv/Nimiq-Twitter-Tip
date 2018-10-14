Twitter-Tip is an open-source node.js Twitter bot for tipping with altcoins.

# Instalation
To install Twitter-Tip simply clone this repo and install dependencies:
```bash
git clone https://github.com/rraallvv/Twitter-Tip
cd Twitter-Tip
npm install
```
After installation proceed to the configuration file `twitter.yml`.

## log
Logging settings.
* **file** - file to log to. Set to `false` to disable logging to file.
* **level** - debug level.

## rpc
JSON RPC API connection info.
* **host** - Daemon hostname(127.0.0.1 if hosted on the same machine)
* **port** - Daemon RPC port (by default 9341 for Crown)

## coin
Basic coin settings.
* **min_withdraw** - minimum amount of coins to withdraw
* **min_confirmations** - minimum amount of confirmations needed to tip/withdraw coins
* **min_tip** - minimum amount of coins to tip
* **short_name** - short coin's name (eg. `CRW`)
* **full_name** - full coin's name (eg. `Crown`)
* **miner_fee** - fee charged on transactions to cover up the miner fee.
* **address_pattern** - the regex patter to look for the address when parsing the tweet
* **random_prefix** - prefix to add to random stamp (for adding some randomnes to the tweet) 
* **random_length** - number of decimals of the random number in the stamp

Add the following enviromentariables with their appropriate values to `~/.bashrc` and run `source ~/.bashrc`:

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
# Database
export DATABASE_HOST=localhost
export DATABASE_USER=<database user>
export DATABASE_PASS=<database password>
```

# How does it work?
Every Twitter username has it's own account in associate to an address. When a tip is sent or withdrawn, the bot checks if the user is has an adddress or creates one if there isn't one already created. Then it moves the amount of coins from one account to another, or to some address specified for withdrawing.

# How to run it?
Before running the bot, you have to be running your coin daemon with JSON-RPC API enabled. To enable, add this to your coin daemon configuration file (eg. `~/nimiq-core/settings.conf`):

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
To start the rpc server using the configuration file run `clients/nodejs/index.js --config=settings.conf`

To run the tip bot run `node twitter` or `npm start`.

## Commands

Instructions are executed by messaging the bot on Twitter with one of the following command preceded by an excamation mark.

| **Command** | **Arguments**     | **Description**
|-------------|-------------------|--------------------------------------------------------------------
| `address`   |                      | displays address where you can send your funds to the tip bot
| `balance`   |                      | displays your current wallet balance
| `help`      |                      | displays configured help message (by default similiar to this one)
| `send`      | `<address> <amount>` | sends the specified amount of coins to the specified address
| `tip`       | `<nickname> <amount>`    | sends the specified amount of coins to the specified nickname
| `withdraw`  | `<address>`          | withdraws your whole wallet balance to specified address

## Examples

**@NimiqB** !balance

**@NimiqB** !tip **@someuser** 5

**@NimiqB** !send NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F 5

**@NimiqB** !withdraw

## You have already sent this Tweet

If Twitter shows the message **"You have already sent this Tweet"** simply add some random caracters at the end. In the examples below the caracters **"fwrh34iuhf"** after the required parameters are simply ignored. 

**@NimiqB** !balance fwrh34iuhf

**@NimiqB** !tip **@someuser** 5 fwrh34iuhf

**@NimiqB** !send NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F 5 fwrh34iuhf

**@NimiqB** !withdraw fwrh34iuhf

## ~~Beer~~ Coffee Fund 😄

If you like the Twitter bot please donate some NIM 
```
NQ40 7G2N J5FN 51MV 95DG FCQ9 ET11 DVMV QR1F
```