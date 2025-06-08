/*
 * Copyright (c) 2025 TAOS Data, Inc. <jhtao@taosdata.com>
 *
 * This program is free software: you can use, redistribute, and/or modify
 * it under the terms of the GNU Affero General Public License, version 3
 * or later ("AGPL"), as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

module.exports = function (RED) {
    const taos = require('@tdengine/websocket');
    taos.setLevel("debug");

    function TDengineConsumerNode(config) {
        const node = this;

        // create node
        RED.nodes.createNode(this, config);
        node.log("create node Consumer."); 

        // variant
        let connected           = false;
        let connecting          = false;
        let consumer            = null;
        let reconnectIntervalId = null;
        let needExit            = false;
        const reconnectInterval = 5000; // reconnect interval ms
        const pollTimeout       = 2000; // poll timeout ms

        // Retrieve configuration from the Node-RED editor
        const uri             = config.uri;
        const timeout         = config.timeout;
        const topic           = config.topic;
        const groupId         = config.groupId         || 'group1';
        const clientId        = config.clientId        || `node-red-client-${node.id}`;
        const autoCommit      = config.autoCommit      || true;
        
        const autoOffsetReset = config.autoOffsetReset || 'earliest';
        const autoCommitIntervalMs = config.autoCommitIntervalMs || 1000;
        
        //
        // create consumer instance
        //
        async function createConsumerInstance() {
                     
            let configMap = new Map([
                [taos.TMQConstants.WS_URL,                  uri],
                [taos.TMQConstants.CONNECT_USER,            node.credentials.user],
                [taos.TMQConstants.CONNECT_PASS,            node.credentials.password],
                [taos.TMQConstants.CONNECT_MESSAGE_TIMEOUT, timeout],
                [taos.TMQConstants.GROUP_ID,                groupId],
                [taos.TMQConstants.CLIENT_ID,               clientId],
                [taos.TMQConstants.AUTO_OFFSET_RESET,       autoOffsetReset],
                [taos.TMQConstants.ENABLE_AUTO_COMMIT,      String(autoCommit)],
                [taos.TMQConstants.AUTO_COMMIT_INTERVAL_MS, String(autoCommitIntervalMs)],
            ]);

            // atri log
            configMap.forEach((v, k) => {
                if (k != taos.TMQConstants.CONNECT_PASS) {
                    node.debug("attr " + k + ": " + v);
                }
            })

            // tmqConnect
            try {
                node.log("Connect to tmq uri: " + uri + " ...");
                consumer = await taos.tmqConnect(configMap);
                node.log("Connect to tmq server ok.");
                                
                // splite topics
                let topics = topic.split(',').map(item => item.trim());
                await consumer.subscribe(topics);
                node.log(`Subscribed topic: ${topics}`);

                // Start polling for messages
                startPolling();

                // success 
                node.log("Start polling successfully.");
                updateStatus("success");
                clearInterval(reconnectIntervalId); // Clear any existing reconnect interval                
            } catch (err) {
                node.error(`Failed to connect and subscribe: ${err.message}`, err);
                updateStatus("failed");
                scheduleReconnect();
            }
        }

        //
        // parse consumer data, return rows count
        //
        function parseConsumeData(res) {
            let num = 0;
            // loop
            for (const [topic, value] of res) {
                if (value._meta.length > 0) {
                    let meta = value._meta;
                    let data = value._data;
                    let result = [];

                    for (let i = 0; i < data.length; i++) {
                        let row = {};
                        for (let j = 0; j < meta.length; j++) {
                            let fieldName = meta[j].name;
                            let fieldType = meta[j].type;
                            let fieldValue = data[i][j];

                            // Convert BigInt to string if necessary
                            if (fieldType === 'BIGINT') {
                                fieldValue = BigInt(fieldValue);
                            }

                            // Add the field to the row object
                            row[fieldName] = fieldValue;
                        }
                        result.push(row);
                    }

                    console.log("consumer payload:", value);
                    console.log("consumer result:", result);
                    // combine msg
                    let msg = {
                        topic:     topic,
                        payload:   result,
                        database:  value.database,
                        vgroup_id: value.vgroup_id,
                        precision: value._precision 
                    };

                    // send
                    console.log("send msg:", msg);
                    node.send(msg);

                    num += result.length;
                    //node.send({ payload: JSON.parse(JSON.stringify(result, replacer)) });
                }                            
                // Send each message as a separate Node-RED message
            }

            // return
            return num;
        }

        //
        // polling
        //
        function startPolling() {
            
            const pollTimeoutId = setInterval(async () => {
                
                // check 
                if (!consumer) {
                    node.error("consumer is null, can not start polling.");
                    return ;
                }
                node.log("enter polling mode. timeout ms:" + pollTimeout);

                // while poll
                try {
                    while (1) {
                        if (needExit) {
                            node.log("close and exit poll loop.");
                            break;
                        }

                        node.debug("call poll ...");
                        const res = await consumer.poll(pollTimeout); // Poll with a short timeout
                        node.debug("poll return start parse ...");

                        // parse consumer data
                        let num = parseConsumeData(res);
                        node.debug("recv and send rows:", num);

                        // auto commit
                        if (!autoCommit) {
                            await consumer.commit();
                            node.debug("submit commit by manually.");
                        }
                        
                        // TODO need fix only poll once 
                        break;
                    }
                } catch (err) {
                    node.error(`Error during polling: ${err.message}`, err);
                    // Consider if you want to trigger a reconnect here or let the main connection handle it
                }
            }, pollTimeout);

            // on close
            node.on('close', () => {
                node.debug("on close." );
                needExit = true;
                clearInterval(pollTimeoutId);
            });
        }

        //
        // re-connect
        //
        function scheduleReconnect() {
            if (!reconnectIntervalId) {
                reconnectIntervalId = setInterval(() => {
                    node.log('Attempting to reconnect to TDengine...');
                    createConsumerInstance();
                }, reconnectInterval);
            }
        }

        //
        // update node status
        //
        function updateStatus(status) {
            if (status == "start") {
                // start
                node.connecting = true;
                node.connected  = false;
                node.emit("state", "connecting to tdengine-consumer ...");
            } else if (status == "success") {
                // success
                node.connected  = true;
                node.connecting = false;
                node.emit("state", "connected");
                node.log("Connect tdengine-consumer successfully!");
            } else if(status == "failed") {
                // failed
                node.connected  = false;
                node.connecting = false;
                node.log("Connect tdengine-consumer failed!");
                node.emit("state", "unconnected");
            } else if(status == "close") {
                // close db
                node.connected  = false;
                node.connecting = false;
                node.log("tdengine-consumer is closed!");
                node.emit("state", "closed");            
            } else {
                node.error("unexpect status:" + status);
            }
        }        

        this.on('input', async (msg, send, done) => {
            // You might want to add functionality here to dynamically
            // change subscription, commit manually, or other actions
            // based on incoming messages. For now, we'll just log it.
            node.log(`Received input message: ${JSON.stringify(msg.payload)}`);
            done(); // Indicate that the input processing is complete
        });

        // state
        node.on("state", function(info) {
            node.log("on state:" + info);
            if (info === "connecting") {
                node.status({fill: "grey", shape: "ring", text: info});
            } else if (info === "connected") {
                node.status({fill: "green", shape: "dot", text: info});
            } else {
                node.status({fill: "red", shape: "ring", text: info});
            }
        });        

        // close
        this.on('close', async (done) => {
            node.log('Closing TDengine consumer node.');
            clearInterval(reconnectIntervalId);
            if (consumer) {
                try {
                    await consumer.unsubscribe();
                    await consumer.close();
                    taos.destroy();
                    node.log('TDengine consumer closed successfully.');
                    done();
                } catch (err) {
                    node.error(`Error closing consumer: ${err.message}`, err);
                    done(err);
                }
            } else {
                taos.destroy();
                done();
            }
            updateStatus("close");
        });

        //
        // start run
        //

        // start
        updateStatus("start");

        // Initial connection attempt
        createConsumerInstance();
    }
    // register
    RED.nodes.registerType("tdengine-consumer", TDengineConsumerNode, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });   

    // Custom replacer function to handle BigInt serialization
    function replacer(key, value) {
        if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
        }
        return value;
    }
};