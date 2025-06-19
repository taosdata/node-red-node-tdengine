/*
 * Copyright (c) 2025 TAOS Data, Inc. MIT License.
 */

module.exports = function (RED) {
    var taos = require('@tdengine/websocket');
    //taos.setLevel("debug");

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

        // Retrieve configuration from the Node-RED editor
        const uri             = config.uri;
        const pollTimeout     = config.pollTimeout     || 5000; 
        const topic           = config.topic;
        const groupId         = config.groupId         || 'group1';
        const clientId        = config.clientId        || `node-red-client-${node.id}`;
        const autoCommit      = config.autoCommit;
        
        const autoOffsetReset = config.autoOffsetReset || 'earliest';
        const autoCommitIntervalMs = config.autoCommitIntervalMs || 5000;

        // check param valid
        function checkParamValid(uri, topic) {
            //
            // url
            //
            if (uri == null ) {
                node.error("invalid param, connect uri is null.");
                updateStatus("invalid param");
                return false;
            }
            if (uri.trim().length < 5 ) {
                node.error("invalid param, connect uri is too short. uri:" + uri);
                updateStatus("invalid param");
                return false;
            }

            //
            // topic
            //
            if (topic == null ) {
                node.error("invalid param, topic is null.");
                node.updateStatus("invalid param");
                return false;
            }
            if (topic.trim().length == 0 ) {
                node.error("invalid param, topic is empty.");
                node.updateStatus("invalid param");
                return false;
            }

            return true;
        }

        // tmq work ok notify
        function notifyWorkOK() {
            node.log("Connect and subscribe OK!");
            updateStatus("connected");
            clearInterval(reconnectIntervalId); // Clear any existing reconnect interval
            reconnectIntervalId = 0;
        }

        //
        // create consumer instance
        //
        async function createConsumerInstance() {
            let configMap = new Map([
                [taos.TMQConstants.WS_URL,                  uri],
                [taos.TMQConstants.CONNECT_USER,            node.credentials.user],
                [taos.TMQConstants.CONNECT_PASS,            node.credentials.password],
                [taos.TMQConstants.CONNECT_MESSAGE_TIMEOUT, pollTimeout],
                [taos.TMQConstants.GROUP_ID,                groupId],
                [taos.TMQConstants.CLIENT_ID,               clientId],
                [taos.TMQConstants.AUTO_OFFSET_RESET,       autoOffsetReset],
                [taos.TMQConstants.ENABLE_AUTO_COMMIT,      String(autoCommit)],
                [taos.TMQConstants.AUTO_COMMIT_INTERVAL_MS, String(autoCommitIntervalMs)],
            ]);

            // atri log
            configMap.forEach((v, k) => {
                if ( k == taos.TMQConstants.CONNECT_PASS) {
                    if (v) {
                        node.debug("attr " + k + ": " + v.substring(0,2) + "****");
                    } else {
                        node.debug("attr " + k + ": null");
                    }
                } else {
                    node.debug("attr " + k + ": " + v);
                }
            })

            // check param
            if(!checkParamValid(uri, topic)) {
                return ;
            }

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
                node.log("Start polling successfully.");

                // success 
                notifyWorkOK();
            } catch (err) {
                let msg = `Failed to connect and subscribe: ${err.message}`;
                console.log(err);
                node.log(msg)
                node.error(msg, err);
                
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

                    node.debug("consumer payload:" + JSON.stringify(value,  replacer));
                    node.debug("consumer result:"  + JSON.stringify(result, replacer));
                    // combine msg
                    let msg = {
                        topic:     topic,
                        payload:   result,
                        database:  value.database,
                        vgroup_id: value.vgroup_id,
                        precision: value._precision 
                    };

                    // send
                    node.debug("send msg:" + JSON.stringify(msg, replacer));
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

            // if no data msg return true else false
            function checkNoDataMsg(err) {
                // find key            
                if  (err.indexOf(" timeout with ") >= 0) {
                    return true;
                }
                return false;
            }
            
            (async function pollLoop() {
                
                // check 
                if (!consumer) {
                    node.error("consumer is null, can not start polling.");
                    return ;
                }

                let pollArg = Math.round(pollTimeout * 0.6);
                node.log("enter polling mode, pollArg:" + pollArg);

                // while poll
                while (1) {
                    try {
                        // check to break if closing node
                        if (needExit) {
                            node.log("close and exit poll loop.");
                            break;
                        }

                        // start poll
                        node.debug("call poll ...");
                        const res = await consumer.poll(pollArg); // Poll with a short timeout
                        node.debug("poll start parse ...");

                        // parse consumer data
                        let num = parseConsumeData(res);
                        node.debug("consumer send rows:" + num);

                        // auto commit
                        if (!autoCommit && num > 0) {
                            await consumer.commit();
                            node.debug("submit commit by manually.");
                        }                                            
                    } catch (error) {
                        // check no data
                        console.log("poolLoop catch error:", error);
                        if (checkNoDataMsg(error.message)) {
                            node.debug(`Catch no data msg: ${error.message}`);
                        } else {
                            node.error(`Catch error during polling: ${error.message}`, error);
                        }
                        scheduleReconnect();
                        break;
                    }
                }
            })();

            // on close
            node.on('close', () => {
                node.debug("on close." );
                needExit = true;
                clearTimeout(pollTimeoutId);
            });
        }

        //
        // re-connect
        //
        function scheduleReconnect() {
            if (!reconnectIntervalId) {
                // update status
                updateStatus("failed");
                node.log(`start reconnect after sleep ${reconnectInterval} ...`);

                // re-connect
                reconnectIntervalId = setInterval(() => {
                    node.log(`Attempting to reconnect(id=${reconnectIntervalId}) to TDengine...`);
                    try {
                        // destroy
                        node.debug("no call taos.destroy()");
                        //taos.destroy()
                        // re-create
                        createConsumerInstance();
                    } catch(error) {
                        console.log("do reconnect tmp except:", error);
                    }                    
                }, reconnectInterval);                
            } else {
                node.log(`already in reconnecting(id=${reconnectIntervalId}) ...`);
            }
        }

        //
        // update node status
        //
        function updateStatus(status) {
            if (status == "connecting") {
                // connecting
                node.connecting = true;
                node.connected  = false;
                node.emit("state", "connecting");
            } else if (status == "connected") {
                // connected
                node.connected  = true;
                node.connecting = false;
                node.log("Connect tdengine-consumer successfully!");
            } else { 
                // unconnected
                node.connected  = false;
                node.connecting = false;
                node.log("Connect tdengine-consumer failed!");
            }   
            node.emit("state", status);
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
        updateStatus("connecting");

        // Initial connection attempt
        try {
            createConsumerInstance();
        } catch {
            node.log("catch except call createConsumerInstance()");
        }
        
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