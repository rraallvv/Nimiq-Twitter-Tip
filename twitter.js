async function main() {
	var Twitter = require("twit");
	var yaml = require("js-yaml");
	var winston = require("winston");
	var fs = require("fs");
	var Keyv = require("keyv");
	var http = require("http");
	var btoa = require("btoa");
	var nodemailer = require("nodemailer");

	// load settings
	var settings = yaml.load(fs.readFileSync("./twitter.yml", "utf-8"));

	//Source: https://github.com/nimiq-network/core/blob/master/clients/nodejs/remote.js#L47
	function jsonRpcFetch(method, ...params) {
		return new Promise((resolve, fail) => {
			while (
				params.length > 0 &&
				typeof params[params.length - 1] === "undefined"
			)
				params.pop();
			const jsonrpc = JSON.stringify({
				jsonrpc: "2.0",
				id: 42,
				method: method,
				params: params
			});
			const headers = { "Content-Length": jsonrpc.length };
			headers["Authorization"] = `Basic ${btoa(
				`${process.env.NIMIQ_RPC_USER}:${process.env.NIMIQ_RPC_PASS}`
			)}`;
			const req = http.request(
				{
					hostname: settings.rpc.host,
					port: settings.rpc.port,
					method: "POST",
					headers: headers
				},
				res => {
					if (res.statusCode === 401) {
						fail(
							new Error(
								`Request Failed: Authentication Required. Status Code: ${
									res.statusCode
								}`
							)
						);
						res.resume();
						return;
					}
					if (res.statusCode !== 200) {
						fail(
							new Error(
								`Request Failed. ${
									res.statusMessage ? `${res.statusMessage} - ` : ""
								}Status Code: ${res.statusCode}`
							)
						);
						res.resume();
						return;
					}

					res.setEncoding("utf8");
					let rawData = "";
					res.on("error", fail);
					res.on("data", chunk => {
						rawData += chunk;
					});
					res.on("end", () => {
						try {
							const parse = JSON.parse(rawData);
							if (parse.error) {
								fail(parse.error.message);
							} else {
								resolve(parse.result);
							}
						} catch (e) {
							fail(e);
						}
					});
				}
			);
			req.on("error", fail);
			req.write(jsonrpc);
			req.end();
		});
	}

	function amountToString(amount) {
		if (amount % 1 != 0) return amount.toFixed(5);
		return amount.toString();
	}

	async function getAddress(user) {
		var address = await keyv.get(user);
		if (!address) {
			var result = await jsonRpcFetch("createAccount");
			address = result.address;
			await keyv.set(user, address);
		}
		return address;
	}

	async function getBalance(address, confirmations) {
		var balance = await jsonRpcFetch("getBalance", address);
		if (confirmations && confirmations !== "latest") {
			var blockNumber = await jsonRpcFetch("blockNumber");
			confirmations = blockNumber - confirmations;
			for (var i = blockNumber; i > confirmations; i--) {
				var block = await jsonRpcFetch("getBlockByNumber", i, true);
				for (var j = 0, l = block.transactions.length; j < l; j++) {
					var transaction = block.transactions[j];
					//if (transaction.fromAddress == address) {
					//	balance -= transaction.value + transaction.fee;
					//}
					if (transaction.toAddress == address) {
						balance -= transaction.value;
					}
				}
			}
		}
		return balance / settings.coin.inv_precision;
	}

	function tweetResponse(status, tweetid, completion) {
		if (!completion) {
			completion = function(error, tweet, response) {
				return;
			};
		}
		var random = Math.random()
			.toString()
			.slice(0, settings.coin.random_length + 2);
		client.post(
			"statuses/update",
			{
				status: status + " [" + settings.coin.random_prefix + random + "]",
				in_reply_to_status_id: tweetid
			},
			completion
		);
	}

	function emailNotification(message) {
		transporter.sendMail(
			{
				from: process.env.EMAIL_ADDRESS,
				to: process.env.EMAIL_NOTIFICATION_ADDRESS,
				subject: "Twitter Tip Bot",
				text: message
			},
			function(error, info) {
				if (error) {
					winston.error("Could not send email notification", error);
				}
			}
		);
	}

	var transporter = nodemailer.createTransport({
		host: "smtp.gmail.com",
		port: 465,
		secure: true,
		auth: {
			type: "OAuth2",
			user: process.env.GMAIL_ADDRESS,
			clientId: process.env.OAUTH_CLIENT_ID,
			clientSecret: process.env.OAUTH_CLIENT_SECRET,
			refreshToken: process.env.OAUTH_REFRESH_TOKEN,
			accessToken: process.env.OAUTH_ACCESS_TOKEN
		}
	});

	var keyv = new Keyv(
		`mysql://${process.env.DATABASE_USER}:${encodeURI(
			process.env.DATABASE_PASS
		)}@${process.env.DATABASE_HOST}:3306/nimiq_tip_bot`
	);
	// Handle DB connection errors
	keyv.on("error", err => console.log("Connection Error", err));

	// check if the config file exists
	if (!fs.existsSync("./twitter.yml")) {
		winston.error(
			"Configuration file doesn't exist! Please read the README.md file first."
		);
		process.exit(1);
	}

	// load winston's cli defaults
	winston.cli();

	// write logs to file
	if (settings.log.file) {
		winston.add(winston.transports.File, {
			filename: settings.log.file,
			level: settings.log.level
		});
	}

	// connect to coin daemon
	winston.info("Connecting to " + settings.coin.full_name + " RPC API...");

	try {
		var balance = await getBalance(
			"NQ50 V2LA 91XE SJTE DHT5 122G KFTV C6T6 8QAQ"
		);
		winston.info(
			"Connected to JSON RPC API. Current total balance is %d " +
				settings.coin.short_name,
			amountToString(balance)
		);
	} catch (err) {
		winston.error(
			"Could not connect to %s RPC API! ",
			settings.coin.full_name,
			err
		);
		process.exit(1);
	}

	// connect to twitter
	var client = new Twitter({
		consumer_key: process.env.TWITTER_CONSUMER_KEY,
		consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
		access_token: process.env.TWITTER_ACCESS_TOKEN,
		access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
	});

	// tipbot
	var stream = client.stream("statuses/filter", {
		track: ["@" + process.env.TWITTER_USERNAME]
	});
	stream.on("tweet", async function(tweet) {
		from = tweet.user.screen_name;
		from = from.toLowerCase();
		var message = tweet.text;

		// if message is from username ignore
		if (from == process.env.TWITTER_USERNAME.toLowerCase()) return;
		if (message.indexOf(process.env.TWITTER_USERNAME + " ") != -1) {
			var message = message.substr(
				message.indexOf(process.env.TWITTER_USERNAME + " ") +
					process.env.TWITTER_USERNAME.length +
					1
			);
		}
		if (
			message.indexOf(process.env.TWITTER_USERNAME.toLowerCase() + " ") != -1
		) {
			var message = message.substr(
				message.indexOf(process.env.TWITTER_USERNAME.toLowerCase() + " ") +
					process.env.TWITTER_USERNAME.length +
					1
			);
		}
		var match = message.match(/^(!)(\S+)/);
		if (match === null) {
			// forward to notification email
			emailNotification(tweet.user.screen_name + ":\n" + tweet.text);
			return;
		}
		var prefix = match[1];
		var command = match[2];
		tweetid = tweet.id_str;
		winston.info("New Tweet from " + from + " with TweetId: " + tweetid);

		//commands
		switch (command) {
			case "balance":
				winston.debug("Requesting balance for %s", from);
				try {
					var address = await getAddress(from);
					var balance = await getBalance(
						address,
						settings.coin.min_confirmations
					);
					var unconfirmed_balance = await getBalance(address);
					unconfirmed_balance -= balance;

					winston.info(from + "'s Balance is " + amountToString(balance));
					tweetResponse(
						"@" +
							from +
							", Your current balance is " +
							amountToString(balance) +
							" $" +
							settings.coin.short_name +
							"." +
							(unconfirmed_balance > 0
								? " ( Unconfirmed: " +
								  amountToString(unconfirmed_balance) +
								  " $" +
								  settings.coin.short_name +
								  " )"
								: ""),
						tweetid
					);
				} catch (err) {
					tweetResponse("Could not get balance for @" + from, tweetid, function(
						error,
						tweet,
						response
					) {
						winston.error("Error in !balance command", err);
						return;
					});
				}
				break;

			case "address":
				winston.debug("Requesting address for %s", from);
				try {
					var address = await getAddress(from);
					tweetResponse(
						"@" + from + ", Your deposit address is " + address,
						tweetid,
						function(error, tweet, response) {
							winston.info("Sending address to " + from);
							return;
						}
					);
				} catch (err) {
					tweetResponse(
						"@" +
							from +
							" I'm sorry, something went wrong while getting the address.",
						tweetid,
						function(error, tweet, response) {
							winston.error(
								"Something went wrong while getting " + from + "'s address.",
								err
							);
							return;
						}
					);
				}
				break;

			case "tip":
				winston.debug("Processing tip for %s", from);
				var match = message.match(/^.?tip (\S+) ([\d\.]+)/);
				if (match === null || match.length < 3) {
					tweetResponse(
						"@" +
							from +
							" Usage: <@" +
							process.env.TWITTER_USERNAME +
							" !tip [nickname] [amount]>",
						tweetid
					);
					break;
				}
				var to = match[1];
				to = to.toLowerCase().replace("@", "");
				var amount = Number(match[2]);
				winston.info(
					"from: " + from + " to: " + to + " amount: " + amountToString(amount)
				);

				// check amount being sent is valid
				if (!amount) {
					tweetResponse(
						"@" +
							from +
							", " +
							amountToString(amount) +
							" is an invalid amount",
						tweetid,
						function(error, tweet, response) {
							winston.warn(from + " tried to send an invalid amount ");
							return;
						}
					);
					break;
				}

				// check the user isn't tipping themselves.
				if (to == from) {
					tweetResponse(
						"@" + from + " I'm sorry, You can't tip yourself !",
						tweetid,
						function(error, tweet, response) {
							winston.warn(from + " tried to send to themselves.");
							return;
						}
					);
					break;
				}

				// check amount is larger than minimum tip amount
				// charge twice the miner fee and send a half with the tip for withdrawal
				if (amount < settings.coin.min_tip + 2 * settings.coin.miner_fee) {
					var short =
						settings.coin.min_tip + 2 * settings.coin.miner_fee - amount;
					tweetResponse(
						"@" +
							from +
							" I'm sorry, your tip to @" +
							to +
							" (" +
							amountToString(amount) +
							" $" +
							settings.coin.short_name +
							") is smaller that the minimum amount allowed (you are short " +
							amountToString(short) +
							" $" +
							settings.coin.short_name +
							")",
						tweetid,
						function(error, tweet, response) {
							winston.warn(from + " tried to send too small of a tip.");
							return;
						}
					);
					break;
				}

				// check balance with min. confirmations
				var fromAddress, toAddress, balance;
				try {
					fromAddress = await getAddress(from);
					balance = await getBalance(
						fromAddress,
						settings.coin.min_confirmations
					);
				} catch (err) {
					tweetResponse("Could not get balance for @" + from, tweetid, function(
						error,
						tweet,
						response
					) {
						winston.error("Error while checking balance for " + from, err);
						return;
					});
					break;
				}

				try {
					// charge twice the miner fee and send a half with the tip for withdrawal
					if (balance >= amount + 2 * settings.coin.miner_fee) {
						toAddress = await getAddress(to);
						await jsonRpcFetch("sendTransaction", {
							from: fromAddress,
							to: toAddress,
							value:
								(amount + settings.coin.miner_fee) *
								settings.coin.inv_precision, // send the withdrawal fee with the tip
							fee: settings.coin.miner_fee * settings.coin.inv_precision
						});
						tweetResponse(
							"@" +
								from +
								" tipped @" +
								to +
								" " +
								amountToString(amount) +
								" $" +
								settings.coin.short_name +
								" Tweet @" +
								process.env.TWITTER_USERNAME +
								" !help to claim your tip !",
							tweetid,
							function(error, tweet, response) {
								winston.info(
									from +
										" tipped " +
										to +
										" " +
										amountToString(amount) +
										" " +
										settings.coin.short_name
								);
								return;
							}
						);
					} else {
						var short = amount + 2 * settings.coin.miner_fee - balance;
						tweetResponse(
							"@" +
								from +
								" I'm sorry, you dont have enough funds (you are short " +
								amountToString(short) +
								" $" +
								settings.coin.short_name +
								")",
							tweetid,
							function(error, tweet, response) {
								winston.error(
									from +
										" tried to tip " +
										to +
										" " +
										amountToString(amount) +
										", but has only " +
										balance
								);
								return;
							}
						);
					}
				} catch (err) {
					tweetResponse(
						"Could not send coins from @" + from + " to @" + to,
						tweetid,
						function(error, tweet, response) {
							winston.error(
								"Error while moving coins from " + from + " to " + to,
								err
							);
							return;
						}
					);
				}
				break;

			case "withdraw":
				winston.debug("Processing withdrawal for %s", from);
				var match = message.match(
					new RegExp(`^.?withdraw (${settings.coin.address_pattern})`)
				);
				if (match === null) {
					tweetResponse(
						"@" +
							from +
							" Usage: <@" +
							process.env.TWITTER_USERNAME +
							" !withdraw [" +
							settings.coin.full_name +
							" address]>",
						tweetid
					);
					break;
				}
				var toAddress = match[1],
					fromAddress,
					balance;

				try {
					await jsonRpcFetch("getAccount", toAddress);
				} catch (err) {
					tweetResponse(
						"@" +
							from +
							" I'm sorry, " +
							toAddress +
							" is invalid or something went wrong with the address validation.",
						tweetid,
						function(error, tweet, response) {
							winston.warn("%s tried to withdraw to an invalid address", from);
							return;
						}
					);
					break;
				}

				try {
					fromAddress = await getAddress(from);
					balance = await getBalance(
						fromAddress,
						settings.coin.min_confirmations
					);
				} catch (err) {
					tweetResponse(
						"@" + from + ", I'm sorry I could not get your balance",
						tweetid
					);
					break;
				}

				if (balance < settings.coin.min_withdraw + settings.coin.miner_fee) {
					var short =
						settings.coin.min_withdraw + settings.coin.miner_fee - balance;
					tweetResponse(
						"@" +
							from +
							" I'm sorry, the minimum withdrawal amount is " +
							amountToString(settings.coin.min_withdraw) +
							" $" +
							settings.coin.short_name +
							" you are short " +
							amountToString(short) +
							" $" +
							settings.coin.short_name,
						tweetid,
						function(error, tweet, response) {
							winston.warn(
								from +
									" tried to withdraw " +
									balance +
									", but min is set to " +
									settings.coin.min_withdraw
							);
							return;
						}
					);
					break;
				}

				if (balance < settings.coin.min_withdraw + settings.coin.miner_fee) {
					var short =
						settings.coin.min_withdraw + settings.coin.miner_fee - balance;
					tweetResponse(
						"@" +
							from +
							" I'm sorry, you dont have enough funds to cover the miner fee (you are short " +
							amountToString(short) +
							" $" +
							settings.coin.short_name +
							")",
						tweetid,
						function(error, tweet, response) {
							winston.warn(
								from +
									" tried to withdraw " +
									balance +
									", but funds don't cover the miner fee " +
									settings.coin.miner_fee
							);
							return;
						}
					);
					break;
				}

				try {
					var amount = balance - settings.coin.miner_fee;
					await jsonRpcFetch("sendTransaction", {
						from: fromAddress,
						to: toAddress,
						value: amount * settings.coin.inv_precision,
						fee: settings.coin.miner_fee * settings.coin.inv_precision
					});
					tweetResponse(
						"@" +
							from +
							": " +
							amountToString(amount) +
							" $" +
							settings.coin.short_name +
							" has been withdrawn from your account to " +
							toAddress,
						tweetid,
						function(error, tweet, response) {
							winston.info(
								"Sending " +
									amountToString(amount) +
									" " +
									settings.coin.full_name +
									" to " +
									toAddress +
									" for @" +
									from
							);
							return;
						}
					);
				} catch (err) {
					tweetResponse(
						"Could not send coins from @" + from + " to " + toAddress,
						tweetid,
						function(error, tweet, response) {
							winston.error("Error in !withdraw command", err);
							return;
						}
					);
				}
				break;

			case "send":
				winston.debug("Processing transaction for %s", from);
				var match = message.match(
					new RegExp(`^.?send (${settings.coin.address_pattern}) ([\\d\\.]+)`)
				);
				if (match === null) {
					tweetResponse(
						"@" +
							from +
							" Usage: <@" +
							process.env.TWITTER_USERNAME +
							" !send [" +
							settings.coin.full_name +
							" address] [amount]>",
						tweetid
					);
					break;
				}
				var toAddress = match[1],
					amount = Number(match[2]),
					fromAddress,
					balance;

				if (!amount) {
					tweetResponse(
						"@" + from + ", " + amount + " is an invalid amount",
						tweetid
					);
					break;
				}

				try {
					await jsonRpcFetch("getAccount", toAddress);
				} catch (err) {
					tweetResponse(
						"@" +
							from +
							" I'm sorry, " +
							toAddress +
							" is invalid or something went wrong with the address validation.",
						tweetid,
						function(error, tweet, response) {
							winston.warn("%s tried to withdraw to an invalid address", from);
							return;
						}
					);
					break;
				}

				try {
					fromAddress = await getAddress(from);
					balance = await getBalance(
						fromAddress,
						settings.coin.min_confirmations
					);
				} catch (err) {
					tweetResponse(
						"@" + from + ", I'm sorry I could not get your balance",
						tweetid
					);
					break;
				}

				if (balance >= amount + settings.coin.miner_fee) {
					if (amount >= settings.coin.min_withdraw + settings.coin.miner_fee) {
						try {
							await jsonRpcFetch("sendTransaction", {
								from: fromAddress,
								to: toAddress,
								value: amount * settings.coin.inv_precision,
								fee: settings.coin.miner_fee * settings.coin.inv_precision
							});
							tweetResponse(
								"@" +
									from +
									": " +
									amountToString(amount) +
									" $" +
									settings.coin.short_name +
									" has been sent from your account to " +
									toAddress,
								tweetid,
								function(error, tweet, response) {
									winston.info(
										"Sending " +
											amountToString(amount) +
											" " +
											settings.coin.full_name +
											" to " +
											toAddress +
											" for @" +
											from
									);
									return;
								}
							);
						} catch (err) {
							tweetResponse(
								"Could not send coins from @" + from + " to " + toAddress,
								tweetid,
								function(error, tweet, response) {
									winston.error("Error in !send command", err);
									return;
								}
							);
						}
					} else {
						var short =
							settings.coin.min_withdraw + settings.coin.miner_fee - amount;
						tweetResponse(
							"@" +
								from +
								" I'm sorry, the minimum amount is " +
								amountToString(settings.coin.min_withdraw) +
								" $" +
								settings.coin.short_name +
								" you are short " +
								amountToString(short) +
								" $" +
								settings.coin.short_name,
							tweetid,
							function(error, tweet, response) {
								winston.warn(
									from +
										" tried to send " +
										balance +
										", but min is set to " +
										settings.coin.min_withdraw
								);
								return;
							}
						);
					}
				} else {
					var short = amount + settings.coin.miner_fee - balance;
					tweetResponse(
						"@" +
							from +
							" I'm sorry, you dont have enough funds (you are short " +
							amountToString(short) +
							" $" +
							settings.coin.short_name +
							")",
						tweetid,
						function(error, tweet, response) {
							winston.warn(
								from +
									" tried to send " +
									amountToString(amount) +
									" to " +
									to +
									", but has only " +
									balance
							);
							return;
						}
					);
				}
				break;

			case "help":
				tweetResponse(
					"@" +
						from +
						" Here is a list of commands: !balance !send !tip !withdraw !address",
					tweetid
				);
				break;

			default:
				// if command doesnt match return
				tweetResponse(
					"@" + from + " I'm sorry, I don't recognize that command",
					tweetid,
					function(error, tweet, response) {
						winston.info(
							"sending reply to @" + from + " from tweet id " + tweetid
						);
						return;
					}
				);
				break;
		}
	});
	stream.on("error", function(error) {
		winston.error(error);
	});
	stream.on("connect", function(request) {
		winston.info("Connecting TipBot to Twitter.....");
	});
	stream.on("connected", function(response) {
		winston.info("Connected TipBot to Twitter.");
	});
	stream.on("disconnect", function(disconnectMessage) {
		winston.error("Disconnected TipBot from Twitter.\n" + disconnectMessage);
		winston.info("Trying to reconnect.....");
	});
}

main();
