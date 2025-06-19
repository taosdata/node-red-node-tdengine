/*
 * Copyright (c) 2025 TAOS Data, Inc. MIT License.
 */


module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    const taos    = require('@tdengine/websocket');
    //taos.setLevel("debug");

    //
    // ------------------------------  TDengineServer util ----------------------------------
    //

    // init
    function dbInit(node, config) {
        // save db config
        node.connected  = false;
        node.connecting = false;
        node.conn      = null;

        node.connType = config.connType;
        node.uri      = config.uri;
        node.host     = config.host;
        node.port     = config.port;
        node.db       = config.db;

        node.debug("dbInit connType: " + node.connType);
        node.debug("dbInit uri:  " + node.uri);
        node.debug("dbInit host: " + node.host);
        node.debug("dbInit port: " + node.port);
        node.debug("dbInit user: " + node.credentials.user);
        node.debug("dbInit db:   " + node.db);
    };

    // check connect Type is host-port 
    function isHostType(connType) {
        return connType == "host-port"
    }

    // connect param valid
    function checkParamValid(node) {

        if (isHostType(node.connType)) {
            if(node.host == null || node.host == "") {
                node.error("host is invalid:" + node.host);
                return false;
            }
            if(node.port == null || node.port == "") {
                node.error("port is invalid:" + node.port);
                return false;
            }
        } else {
            // connection-string
            if(node.uri == null || node.uri == "") {
                node.error("uri is invalid:" + node.uri);
                return false;
            }
        }

        node.log("check connect param ok!");
        return true;
    }

    // update db connect status,  status: {"start", "success", "failed"}
    function updateStatus(node, status) {
        if (status == "connecting") {
            // connecting
            node.connecting = true;
            node.connected  = false;
            node.emit("state", "connecting");
        } else if (status == "connected") {
            // connected
            node.connected  = true;
            node.connecting = false;
            node.log("Connect tdengine-db successfully!");
        } else { 
            // unconnected
            node.connected  = false;
            node.connecting = false;
            node.log("Connect tdengine-db failed!");
        }   
        node.emit("state", status);
    }


    //
    // ------------------------------  TDengineServer ----------------------------------
    //


    function TDengineServer(config) {
        var node = this;
        
        // create node
        RED.nodes.createNode(node, config);
        node.log("create node TDengineServer.");

        // init db
        dbInit(node, config);

        //
        // do connect
        //
        async function doConnect() {
            // check 
            if (!checkParamValid(node)) {
                updateStatus(node, "invalid param");
                return false;
            }

            //
            // connect db
            //

            updateStatus(node, "connecting");

            // close pre
            try {
                if(node.conn) {
                    node.log("close pre conn instance...");
                    node.conn.close();
                }
            } catch (error) {
                node.debug("pre conn instance close catch error, ignore." + error );
            }

            // prepare
            var conf = null;
            if (isHostType(node.connType)) {
                // host port
                let dsn = "ws://" + node.host + ":" + node.port;
                conf = new taos.WSConfig(dsn);
                conf.setUser(node.credentials.user);
                conf.setPwd(node.credentials.password);
                conf.setDb(node.db);
                node.log("connect with host:" + node.host + " port:" + node.port);
            } else {
                // connect string
                conf = new taos.WSConfig(node.uri);
                node.log("connect with uri: " + node.uri);
            }

            // conn
            try {
                node.debug("start call taos.sqlConnect...");
                node.conn = await taos.sqlConnect(conf);
                if (node.conn == null) {
                    throw new Error("connect db have null return .");
                }
                // success
                updateStatus(node, "connected");
            } catch (error) {
                // failed
                updateStatus(node, "failed");
                node.error(error);
            }
        }

        /* 
        // stmt 
        async function stmtInsert(sql, binds) {
            let stmt = null;

            try{
                stmt = await node.conn.stmtInit();
                await stmt.prepare(sql);

                // loop
                binds.forEach((row, i) => {
                    row.forEach((col, j) => {
                        // TODO
                    });
                });
            } catch(err) {
                node.error(err);
            }finally {
                if (stmt) {
                    await stmt.close();
                }
            }

            return null;
        }
        */

        // cover taos_connect_node result object to node-red result object
        function covResult(result) {
            try {
                let obj = {
                    affectRows: result._affectRows,
                    totalTime:  result._totalTime,
                    timing:     result._timing
                };
                return obj;
            } catch (error) {
                node.error(error);
            }

            // return 
            return null;
        }

        //
        // exec
        //
        node.exec = async function(operate, sql, binds) {
            // check
            if (node.conn == null) {
                node.error("exec conn is null.");
                return null;
            }

            // stmt insert
            if(operate == "insert" && Array.isArray(binds)) {
                // wait taos-connect-nodejs connector support stmt2
                // return stmtInsert(sql, binds);
                node.warn("not support stmt bind write.");
                return null;
            } 

            // exec
            try {
                node.debug("exec sql:" + sql);
                var result = await node.conn.exec(sql);
                node.debug("result obj:" + JSON.stringify(result, replacer));
                return covResult(result);
            } catch (error) {
                node.log("exec error:" + error);
                node.error(error);
                updateStatus(node, "failed");                
            }
        }


        //
        // query
        //
        node.query = async function(sql) {
            // check
            if (node.conn == null) {
                node.error("exec conn is null.");
                return null;
            }            

            // query
            try {
                var rows = [];
                let i = 0;

                node.log("query sql:" + sql);
                var wsRows = await node.conn.query(sql);
                node.debug(wsRows);

                var fields = [];
                var metas = await wsRows.getMeta();
                metas.forEach((meta, idx) => {
                    fields.push(meta.name);
                });

                node.debug("get fields:" + JSON.stringify(fields, replacer));

                while ( await wsRows.next()) {
                    let row = await wsRows.getData();

                    let obj = {};
                    fields.forEach((field, index) => {
                        obj[field] = row[index];
                    });
                    rows.push(obj);
                    
                    node.debug("i=" + i  + " obj:" + JSON.stringify(obj, replacer));
                    i += 1;
                }

                // succ
                node.log("query successfully. rows count=" + i);
                return rows;

            } catch (error) {
                node.log("query error:" + error);
                node.error(error);
                updateStatus(node, "failed");
                // maybe reconnect
                return null;
            }
            
        }

        //
        // connect
        //
        node.connect = function() {
            // check status
            if(node.connected) {
                node.debug("conn is already connected.");
                return ;
            } else if(node.connecting) {
                node.log("conn is already connecting...");
                return ;
            }

            // do connect
            try {
                doConnect();
            } catch (error) {
                node.log("catch doConnect except.");
                node.error(error);
            }
        }

        // close trigger
        node.on('close', function(done) {
            // close db
            try {
                if (node.connected) {
                    if (node.conn) {
                        node.debug("on close conn.close().");
                        node.conn.close();
                    }      
                }
                
                node.debug("on close taos.destroy().");
                taos.destroy();
                updateStatus(node, "close");
            } catch (error) {
                node.error(error);
            }
            
            done();
        });
    }

    // register
    RED.nodes.registerType("TDengineServer", TDengineServer, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });

    //
    // ------------------------------  TDengineNodeIn ----------------------------------
    //

    function TDengineNodeIn(n) {
        node = this;
        RED.nodes.createNode(this, n);
        node.log("TDengine DBNodeIn created.");
        node.tdServer = RED.nodes.getNode(n.db);
        node.status({});

        // sql type
        function sqlType(sql) {
            // clear
            let pre = sql
                        .trim().
                        substring(0,20).
                        toLowerCase().
                        replace(/\s+/g, ' ');
            // check
            node.debug("pre sql:" + pre);
            if (pre.startsWith("select ") || 
                pre.startsWith("desc")    ||
                pre.startsWith("explain ")    ||
                pre.startsWith("show ")) {
                return 'query';
            } else {
                return "exec";
            }
        }

        if (node.tdServer) {
            node.log("call TDengineServer.connect() ...");
            this.tdServer.connect();
            var node = this;
            var status = {};

            // state
            node.tdServer.on("state", function(info) {
                node.log("on state:" + info);
                if (info === "connecting") {
                    node.status({fill: "grey", shape: "ring", text: info});
                } else if (info === "connected") {
                    node.status({fill: "green", shape: "dot", text: info});
                } else {
                    node.status({fill: "red", shape: "ring", text: info});
                }
            });

            // input sql
            node.on("input",  async function(msg, send, done) {
                node.debug("recv input msg.topic:" + msg.topic + " payload:" + msg.payload);

                try {
                    send = send || function() { node.send.apply(node, arguments) };

                    // connect if no connected
                    node.tdServer.connect();

                    // execute sql
                    if (node.tdServer.connected) {
                        if (typeof msg.topic === 'string') {
                            var sql = msg.topic;
                            var operate = sqlType(sql);
                            node.log("operate:" + operate);
                            if (operate == "query") {
                                // select show
                                let rows = await node.tdServer.query(sql);
                                msg.payload = rows;
                                msg.isQuery = true;
                                send(msg);
                            } else {
                                // insert delete alter
                                let result = await node.tdServer.exec(operate, sql, msg.payload);
                                msg.payload = result;
                                msg.isQuery = false;
                                send(msg);
                            }
                            node.debug("send msg:" + JSON.stringify(msg, replacer));
                        } else {
                            if (typeof msg.topic !== 'string') {
                                node.error("msg.topic : " + RED._("tdengine.errors.notstring")); 
                            }
                        }
                    } else {
                        node.error(RED._("tdengine.errors.notconnected"),msg);
                        status = {
                            fill:"red",
                            shape:"ring",
                            text:RED._("tdengine.status.notconnected")
                        };
                    }
                } catch(error) {
                    log.error("tdengine input catch error", error);
                    node.error(error);
                } finally {
                    // input msg deal finished
                    if (done) { 
                        done(); 
                    }
                }
            });

            // on close
            node.on('close', function() {
                node.log("on close");
                node.status({});
            });
        }
        else {
            node.error(RED._("tdengine.errors.notconfigured"));
        }
    }
    // register
    RED.nodes.registerType("tdengine-operator", TDengineNodeIn);

    // json string
    function replacer(key, value) {
        if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
        }
        return value;
    }
}
