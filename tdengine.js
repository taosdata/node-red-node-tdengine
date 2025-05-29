
module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    var taos      = require('@tdengine/websocket');

    //
    // Node
    //

    function TDengineNode(n) {
        RED.nodes.createNode(this, n);
        this.host = n.host;
        this.port = n.port;
        this.tz   = n.tz || "local";
        this.charset = (n.charset || "UTF8_GENERAL_CI").toUpperCase();

        this.connected = false;
        this.connecting = false;

        this.dbname = n.db;
        this.setMaxListeners(0);
        var node = this;

        function checkVer() {
            node.pool.query("select server_version();", [], function(err, rows, fields) {
                if (err) {
                    node.error(err);
                    node.status({fill:"red",shape:"ring",text:RED._("tdengine.status.badping")});
                    doConnect();
                }
            });
        }

        function doConnect() {
            node.connecting = true;
            node.emit("state","connecting");
            if (!node.pool) {
                node.pool = mysqldb.createPool({
                    host : node.host,
                    port : node.port,
                    user : node.credentials.user,
                    password : node.credentials.password,
                    database : node.dbname,
                    timezone : node.tz,
                    insecureAuth: true,
                    multipleStatements: true,
                    connectionLimit: RED.settings.mysqlConnectionLimit || 50,
                    connectTimeout: 30000,
                    charset: node.charset,
                    decimalNumbers: true
                });
            }

            // connection test
            node.pool.getConnection(function(err, connection) {
                node.connecting = false;
                if (err) {
                    node.emit("state",err.code);
                    node.error(err);
                    node.tick = setTimeout(doConnect, reconnect);
                }
                else {
                    node.connected = true;
                    node.emit("state","connected");
                    if (!node.check) { node.check = setInterval(checkVer, 290000); }
                    connection.release();
                }
            });
        }

        node.connect = function() {
            if (!node.connected && !node.connecting) {
                doConnect();
            }
        }

        node.on('close', function(done) {
            if (node.tick) { clearTimeout(node.tick); }
            if (node.check) { clearInterval(node.check); }
            // node.connection.release();
            node.emit("state"," ");
            if (node.connected) {
                node.connected = false;
                node.pool.end(function(err) { done(); });
            }
            else {
                delete node.pool;
                done();
            }

        });
    }
    RED.nodes.registerType("TDengineDatabase", TDengineNode, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });

    //
    // DBNode In
    //

    function TDengineDBNodeIn(n) {
        RED.nodes.createNode(this, n);
        this.mydb = n.mydb;
        this.mydbConfig = RED.nodes.getNode(this.mydb);
        this.status({});

        if (this.mydbConfig) {
            this.mydbConfig.connect();
            var node = this;
            var busy = false;
            var status = {};
            // state
            node.mydbConfig.on("state", function(info) {
                if (info === "connecting") {
                    node.status({fill: "grey", shape: "ring", text: info});
                } else if (info === "connected") {
                    node.status({fill: "green", shape: "dot", text: info});
                } else {
                    node.status({fill: "red", shape: "ring", text: info});
                }
            });

            // input sql
            node.on("input", function(msg, send, done) {
                send = send || function() { node.send.apply(node,arguments) };
                if (node.mydbConfig.connected) {
                    if (typeof msg.topic === 'string') {
                        //console.log("query:",msg.topic);
                        node.mydbConfig.pool.getConnection(function (err, conn) {
                            if (err) {
                                if (conn) {
                                    conn.release()
                                }
                                status = { fill: "red", shape: "ring", text: RED._("mysql.status.error") + ": " + err.code };
                                node.status(status);
                                node.error(err, msg);
                                if (done) { done(); }
                                return
                            }

                            var bind = [];
                            if (Array.isArray(msg.payload)) {
                                bind = msg.payload;
                            }
                            else if (typeof msg.payload === 'object' && msg.payload !== null) {
                                bind = msg.payload;
                            }
                            conn.config.queryFormat = Array.isArray(msg.payload) ? null : customQueryFormat
                            conn.query(msg.topic, bind, function (err, rows) {
                                conn.release()
                                if (err) {
                                    status = { fill: "red", shape: "ring", text: RED._("mysql.status.error") + ": " + err.code };
                                    node.status(status);
                                    node.error(err, msg);
                                }
                                else {
                                    msg.payload = rows;
                                    send(msg);
                                    status = { fill: "green", shape: "dot", text: RED._("mysql.status.ok") };
                                    node.status(status);
                                }
                                if (done) { done(); }
                            });
                        });
                    }
                    else {
                        if (typeof msg.topic !== 'string') {
                            node.error("msg.topic : " + RED._("mysql.errors.notstring")); 
                            done();
                        }
                    }
                }
                else {
                    node.error(RED._("mysql.errors.notconnected"),msg);
                    status = {fill:"red",shape:"ring",text:RED._("mysql.status.notconnected")};
                    if (done) { done(); }
                }
                if (!busy) {
                    busy = true;
                    node.status(status);
                    node.tout = setTimeout(function() { busy = false; node.status(status); },500);
                }
            });

            node.on('close', function() {
                if (node.tout) { clearTimeout(node.tout); }
                node.mydbConfig.removeAllListeners();
                node.status({});
            });
        }
        else {
            this.error(RED._("mysql.errors.notconfigured"));
        }
    }
    RED.nodes.registerType("tdengine", TDengineDBNodeIn);
}
