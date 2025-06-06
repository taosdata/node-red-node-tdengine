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

    function TDengineConsumerNode(config) {
        const node = this;

        // create node
        RED.nodes.createNode(this, config);
        node.log("create node Consumer.");        

        let consumer = null;
        let reconnectIntervalId = null;
        const reconnectInterval = 5000; // Attempt reconnect every 5 seconds

        // Retrieve configuration from the Node-RED editor
        const uri             = config.uri;
        const topic           = config.topic;
        const groupId         = config.groupId         || 'group1';
        const clientId        = config.clientId        || `node-red-client-${node.id}`;
        const autoCommit      = config.autoCommit      || true;
        const pollingInterval = config.pollingInterval || 2000; // Default polling interval
        const autoOffsetReset = config.autoOffsetReset || 'earliest';
        const autoCommitIntervalMs = config.autoCommitIntervalMs || 1000;

        
        // create consumer instance
        async function createConsumerInstance() {
            let configMap = new Map([
                [taos.TMQConstants.GROUP_ID,                groupId],
                [taos.TMQConstants.CLIENT_ID,               clientId],
                [taos.TMQConstants.AUTO_OFFSET_RESET,       autoOffsetReset],
                [taos.TMQConstants.WS_URL,                  uri],
                [taos.TMQConstants.ENABLE_AUTO_COMMIT,      String(autoCommit)],
                [taos.TMQConstants.AUTO_COMMIT_INTERVAL_MS, String(autoCommitIntervalMs)],
            ]);

            // tmqConnect
            try {
                consumer = await taos.tmqConnect(configMap);
                node.log(`Connected to TDengine TMQ: ${uri}, Group ID: ${groupId}, Client ID: ${clientId}`);
                
                // splite topics
                let topics = topic.split(',').map(item => item.trim());
                await consumer.subscribe(topics);
                node.log(`Subscribed to topic: ${topics}`);

                // Start polling for messages
                startPolling();
                clearInterval(reconnectIntervalId); // Clear any existing reconnect interval
            } catch (err) {
                node.error(`Failed to connect or subscribe: ${err.message}`, err);
                scheduleReconnect();
            }
        }

        // polling
        function startPolling() {
            const pollIntervalId = setInterval(async () => {
                if (consumer) {
                    try {
                        const res = await consumer.poll(pollingInterval); // Poll with a short timeout
                        for (const [topic, value] of res) {
                            // console.log(`data: ${JSON.stringify(value, replacer)}`);
                            if (value._meta.length > 0) {
                                // console.log(`Received data, value: ${JSON.stringify(value, replacer)}`);
                                // the value._meta is an array of objects containing the field names and types
                                // the value._data is an array of arrays containing the actual data
                                // Please combine the two to create a more readable output

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
                                let msg = {topic: topic, payload: result};
                                console.log("send msg:", msg);
                                node.send(msg);
                                //node.send({ payload: JSON.parse(JSON.stringify(result, replacer)) });
                            }                            
                            // Send each message as a separate Node-RED message
                        }

                        // auto commit
                        if (!autoCommit) {
                            await consumer.commit();
                            node.debug("submit commit by manually.");
                        }
                    } catch (err) {
                        node.error(`Error during polling: ${err.message}`, err);
                        // Consider if you want to trigger a reconnect here or let the main connection handle it
                    }
                } else {
                    node.error("consumer is null, can not start polling.");
                }
            }, pollingInterval); // Adjust poll interval as needed

            node.on('close', () => {
                clearInterval(pollIntervalId);
            });
        }

        function scheduleReconnect() {
            if (!reconnectIntervalId) {
                reconnectIntervalId = setInterval(() => {
                    node.log('Attempting to reconnect to TDengine...');
                    createConsumerInstance();
                }, reconnectInterval);
            }
        }

        this.on('input', async (msg, send, done) => {
            // You might want to add functionality here to dynamically
            // change subscription, commit manually, or other actions
            // based on incoming messages. For now, we'll just log it.
            node.log(`Received input message: ${JSON.stringify(msg.payload)}`);
            done(); // Indicate that the input processing is complete
        });

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
        });

        // Initial connection attempt
        createConsumerInstance();
    }

    // Custom replacer function to handle BigInt serialization
    function replacer(key, value) {
        if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
        }
        return value;
    }

    RED.nodes.registerType('tdengine-consumer', TDengineConsumerNode);
};