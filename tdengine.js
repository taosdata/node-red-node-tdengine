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

module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    const taos    = require('@tdengine/websocket');

    process.on('uncaughtException', function (err) {
    console.error('Uncaught Exception in Node-RED-TDengine:', err.stack || err);
        // 可以选择退出进程，但Node-RED默认会尝试继续运行
        // process.exit(1);
    });    

    //
    // ------------------------------  DBEngine util ----------------------------------
    //

    function sqlType(sql) {
        // clear
        let pre = sql
                    .trim().
                    substring(0,20).
                    toLowerCase().
                    replace(/\s+/g, ' ');
        
        console.log("sql prefix:" + pre);

        // check
        if (pre.startsWith("select ") && 
            pre.startsWith("show ")) {
            return 'query';
        } else {
            return "exec";
        }
    }    


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
        if (status == "start") {
            // start
            node.connecting = true;
            node.connected  = false;
            node.emit("state", "connecting");
        } else if (status == "success") {
            // success
            node.connected  = true;
            node.connecting = false;
            node.emit("state", "connected");
            node.log("Connect tdengine successfully!");
        } else if(status == "failed") {
            // failed
            node.connected  = false;
            node.connecting = false;
            node.log("Connect tdengine failed!");
            node.emit("state", "unconnected");
        } else if(status == "close") {
            // close db
            node.connected  = false;
            node.connecting = false;
            node.log("tdengine connection is closed!");
            node.emit("state", "closed");            
        } else {
            node.error("unexpect status:" + status);
        }
    }


    //
    // ------------------------------  DBEngine ----------------------------------
    //


    function DBEngine(config) {
        var node = this;
        
        // create node
        RED.nodes.createNode(node, config);
        node.log("create node DBEngine.");

        // init db
        dbInit(node, config);

        //
        // do connect
        //
        async function doConnect() {
            // check 
            if (!checkParamValid(node)) {
                return false;
            }

            console.log("node.credentials.user:", node.credentials.user);
            console.log("node.credentials.password:", node.credentials.password);

            //
            // connect db
            //
            
            updateStatus(node, "start");
            if (!node.conn) {
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
                console.log("taos.sqlConnect type is:" + typeof taos.sqlConnect);

                // conn
                try {
                    node.conn = await taos.sqlConnect(conf);
                    console.log("node.conn:", node.conn);
                    if (node.conn == null) {
                        console.log("sqlConnect return null");
                        throw new Error("connect db have null return .");
                    }
                    // success
                    updateStatus(node, "success");
                } catch (error) {
                    // failed
                    updateStatus(node, "failed");
                    //node.error(error);
                }
            } else {
                node.log("already is connected.")
            };
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
                node.debug("exec sql:" +sql);
                var result = await node.conn.exec(sql);
                console.log("result obj:",result);
                return result;
            } catch (error) {
                node.error(error);
            }
        }


        //
        // query
        //
        node.query = async function(sql) {
            if (node.conn) {
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

                    node.debug("get fields:" + fields);


                    while ( await wsRows.next()) {
                        let row = await wsRows.getData();

                        let obj = {};
                        fields.forEach((field, index) => {
                            obj[field] = row[index];
                        });
                        rows.push(obj);
                        
                        console.log("i=",i, " obj:", obj);
                        i += 1;
                    }

                    // succ
                    node.log("query successfully. rows count=" + i);
                    return rows;

                } catch (error) {
                    node.log("query error:" + error);
                    node.error(error);
                    
                    // maybe reconnect

                }
            } else {
                node.error("query conn is null.");
            }

            return null;
        }

        //
        // connect
        //
        node.connect = function() {
            if (!node.connected && !node.connecting) {
                doConnect();
            } else {
                node.log("conn is already connected.");
            }
        }

        // close trigger
        node.on('close', function(done) {
            // close db
            if (node.connected) {
                if (node.conn) {
                    node.conn.close();
                }      
            }
            
            taos.destroy();
            updateStatus(node, "close");
            done();
        });
    }

    // register
    RED.nodes.registerType("DBEngine", DBEngine, {
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
        node.dbEngine = RED.nodes.getNode(n.db);
        node.status({});

        if (node.dbEngine) {
            node.log("call DBEngine.connect() ...");
            this.dbEngine.connect();
            var node = this;
            var status = {};

            // state
            node.dbEngine.on("state", function(info) {
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
                send = send || function() { node.send.apply(node, arguments) };

                // try if unconnected
                if(!node.dbEngine.connected) {
                    node.log("db is unconnected and try to connect....");
                    node.dbEngine.connect();
                    node.log("reconnect is finished.");
                }

                // execute sql
                if (node.dbEngine.connected) {
                    if (typeof msg.topic === 'string') {
                        var sql = msg.topic;
                        var operate = sqlType(sql);
                        node.log("operate:" + operate);
                        if (operate == "query") {
                            // select show
                            let rows = node.dbEngine.query(sql);
                            msg.payload = rows;
                            send(msg);
                        } else {
                            // insert delete alter
                            let result = node.dbEngine.exec(operate, sql, msg.payload);
                            msg.payload = result;
                            send(msg);
                        }
                    } else {
                        if (typeof msg.topic !== 'string') {
                            node.error("msg.topic : " + RED._("tdengine.errors.notstring")); 
                            done();
                        }
                    }
                } else {
                    node.error(RED._("tdengine.errors.notconnected"),msg);
                    status = {
                        fill:"red",
                        shape:"ring",
                        text:RED._("tdengine.status.notconnected")
                    };
                    if (done) { done(); }
                }
            });

            // on close
            node.on('close', function() {
                node.log("on close");
                if (node.tout) { clearTimeout(node.tout); }
                node.dbEngine.removeAllListeners();
                node.status({});
            });
        }
        else {
            node.error(RED._("tdengine.errors.notconfigured"));
        }
    }
    // register
    RED.nodes.registerType("tdengine", TDengineNodeIn);
}
