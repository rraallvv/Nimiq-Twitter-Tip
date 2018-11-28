async function main() {
	var Twitter = require("twit");
	var yaml = require("js-yaml");
	var winston = require("winston");
	var fs = require("fs");
	var Keyv = require("keyv");
	var http = require("http");
	var btoa = require("btoa");
	var nodemailer = require("nodemailer");

	// load winston's cli defaults
	winston.cli();

	// check if the config file exists
	if (!fs.existsSync("./twitter.yml")) {
		winston.error(
			"Configuration file doesn't exist! Please read the README.md file first."
		);
		process.exit(1);
	}

	// load settings
	var settings = yaml.load(fs.readFileSync("./twitter.yml", "utf-8"));

	var miner_fee = settings.coin.miner_fee * settings.coin.inv_precision;
	var min_withdraw = settings.coin.min_withdraw * settings.coin.inv_precision;
	var min_tip = settings.coin.min_tip * settings.coin.inv_precision;

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
					hostname: process.env.NIMIQ_RPC_HOST,
					port: process.env.NIMIQ_RPC_PORT,
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
						const parse = JSON.parse(rawData);
						if (parse.error) {
							fail(new Error(parse.error.message));
						} else {
							resolve(parse.result);
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
		amount = amount / settings.coin.inv_precision;
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
		return balance;
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
				from: process.env.GMAIL_ADDRESS,
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

	function dumpError(err) {
		var result = "dumpError:";
		if (typeof err === "object") {
			if (err.message) {
				result += "\nMessage: " + err.message;
			}
			if (err.stack) {
				result += "\nStacktrace:";
				result += "\n====================";
				result += "\n" + err.stack;
			}
		} else if (typeof err === "string") {
			result += "\n" + err;
		} else {
			result +=
				"\nargument is neither an object nor a string (" + typeof err + ")";
		}
		return result;
	}

	try {
		const blockNumber = await jsonRpcFetch("blockNumber");
		// TODO: check if the node is fully synced
		if (!blockNumber) {
			process.exit(1);
		}
	} catch (err) {
		emailNotification(dumpError(err));
		winston.error("Couldn't get blockNumber", err);
		process.exit(1);
	}

	var keyv = new Keyv(
		`mysql://${process.env.DATABASE_USER}:${encodeURI(
			process.env.DATABASE_PASS
		)}@${process.env.DATABASE_HOST}:3306/twitter_tip_bot`
	);
	// Handle DB connection errors
	keyv.on("error", err => {
		emailNotification(dumpError(err));
		winston.error("DB connection Error", err);
	});

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
		emailNotification(dumpError(err));
		winston.error("Couldn't get wallet balance", err);
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
		// if message is from username ignore
		if (from == process.env.TWITTER_USERNAME.toLowerCase()) return;
		var fullTweet;
		if (tweet.extended_tweet && tweet.extended_tweet.full_text) {
			fullTweet = tweet.extended_tweet.full_text;
		} else {
			fullTweet = tweet.text;
		}
		var match = fullTweet.match(
			new RegExp(`@${process.env.TWITTER_USERNAME} (!.*)`, "i")
		);
		if (match === null) {
			// forward to notification email
			winston.info("Forwarded message from " + from);
			emailNotification(tweet.user.screen_name + ":\n" + fullTweet);
			return;
		}
		var message = match[1];
		match = message.match(/^!(\S+)/);
		if (match === null) {
			// forward to notification email
			winston.info("Forwarded message from " + from);
			emailNotification(tweet.user.screen_name + ":\n" + fullTweet);
			return;
		}
		var command = match[1];
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

					winston.info(
						from +
							"'s Balance is " +
							amountToString(balance) +
							(unconfirmed_balance > 0
								? " ( Unconfirmed: " +
								  amountToString(unconfirmed_balance) +
								  " )"
								: "")
					);
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", Could not get your balance.",
						tweetid,
						function(error, tweet, response) {
							winston.error("Error in !balance command", err);
							return;
						}
					);
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
					emailNotification(dumpError(err));
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
				var amount = Number(match[2]) * settings.coin.inv_precision;
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
				if (amount < min_tip) {
					tweetResponse(
						"@" +
							from +
							" I'm sorry, your tip to @" +
							to +
							" (" +
							amountToString(amount) +
							" $" +
							settings.coin.short_name +
							") is smaller that the minimum amount allowed (" +
							amountToString(min_tip) +
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", Could not get your balance.",
						tweetid,
						function(error, tweet, response) {
							winston.error("Error while checking balance for " + from, err);
							return;
						}
					);
					break;
				}

				try {
					// charge twice the miner fee and send a half with the tip for withdrawal
					if (balance >= amount + 2 * miner_fee) {
						toAddress = await getAddress(to);
						await jsonRpcFetch("sendTransaction", {
							from: fromAddress,
							to: toAddress,
							value: amount + miner_fee, // send the withdrawal fee with the tip
							fee: miner_fee
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
						var short = amount + 2 * miner_fee - balance;
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", Could not send coins to @" + to,
						tweetid,
						function(error, tweet, response) {
							winston.error(
								"Error while sending coins from " + from + " to " + to,
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
					if (!(await jsonRpcFetch("getAccount", toAddress))) {
						tweetResponse(
							"@" + from + " I'm sorry, " + toAddress + " is invalid.",
							tweetid,
							function(error, tweet, response) {
								winston.warn(
									"%s tried to withdraw to an invalid address",
									from
								);
								return;
							}
						);
						break;
					}
				} catch (err) {
					emailNotification(dumpError(err));
					tweetResponse(
						"@" +
							from +
							" I'm sorry, something went wrong with the address validation for " +
							toAddress,
						tweetid,
						function(error, tweet, response) {
							winston.warn(
								"%s tried to withdraw but something went wrong",
								from,
								err
							);
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", I'm sorry I could not get your balance",
						tweetid
					);
					break;
				}

				if (balance < min_withdraw + miner_fee) {
					var short = min_withdraw + miner_fee - balance;
					tweetResponse(
						"@" +
							from +
							" I'm sorry, the minimum withdrawal amount is " +
							amountToString(min_withdraw) +
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
									amountToString(balance) +
									", but min is set to " +
									amountToString(min_withdraw)
							);
							return;
						}
					);
					break;
				}

				if (balance < min_withdraw + miner_fee) {
					var short = min_withdraw + miner_fee - balance;
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
									amountToString(balance) +
									", but funds don't cover the miner fee " +
									amountToString(miner_fee)
							);
							return;
						}
					);
					break;
				}

				try {
					var amount = balance - miner_fee;
					await jsonRpcFetch("sendTransaction", {
						from: fromAddress,
						to: toAddress,
						value: amount,
						fee: miner_fee
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", Could not send coins to " + toAddress,
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
					amount = Number(match[2]) * settings.coin.inv_precision,
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
					if (!(await jsonRpcFetch("getAccount", toAddress))) {
						tweetResponse(
							"@" + from + " I'm sorry, " + toAddress + " is invalid.",
							tweetid,
							function(error, tweet, response) {
								winston.warn(
									"%s tried to withdraw to an invalid address",
									from
								);
								return;
							}
						);
						break;
					}
				} catch (err) {
					emailNotification(dumpError(err));
					tweetResponse(
						"@" +
							from +
							" I'm sorry, something went wrong with the address validation for " +
							toAddress,
						tweetid,
						function(error, tweet, response) {
							winston.warn(
								"%s tried to withdraw but something went wrong",
								from,
								err
							);
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
					emailNotification(dumpError(err));
					tweetResponse(
						"@" + from + ", I'm sorry I could not get your balance",
						tweetid
					);
					break;
				}

				if (balance >= amount + miner_fee) {
					if (amount >= min_withdraw + miner_fee) {
						try {
							await jsonRpcFetch("sendTransaction", {
								from: fromAddress,
								to: toAddress,
								value: amount,
								fee: miner_fee
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
							emailNotification(dumpError(err));
							tweetResponse(
								"@" + from + ", Could not send coins to " + toAddress,
								tweetid,
								function(error, tweet, response) {
									winston.error("Error in !send command", err);
									return;
								}
							);
						}
					} else {
						var short = min_withdraw + miner_fee - amount;
						tweetResponse(
							"@" +
								from +
								" I'm sorry, the minimum amount is " +
								amountToString(min_withdraw) +
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
										amountToString(balance) +
										", but min is set to " +
										amountToString(min_withdraw)
								);
								return;
							}
						);
					}
				} else {
					var short = amount + miner_fee - balance;
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
