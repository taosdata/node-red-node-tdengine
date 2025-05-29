
module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    var taos      = require('@tdengine/websocket');
    var wsSql    = null;

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

        async function doConnect() {
            node.connecting = true;
            node.emit("state","connecting");
            if (!wsSql) {
                let dsn = "ws://" + node.host + ":" + node.port;
                let conf = new taos.WSConfig(dsn);
                // conn
                wsSql = await taos.sqlConnect(conf);
                console.log("Connected to " + dsn + " successfully.");
            };
        }

        // interfalce
        node.connect = function() {
            if (!node.connected && !node.connecting) {
                doConnect();
            }
        }

        // close trigger
        node.on('close', function(done) {
            if (node.tick) { clearTimeout(node.tick); }
            if (node.check) { clearInterval(node.check); }
            // node.connection.release();
            node.emit("state"," ");
            if (node.connected) {
                node.connected = false;
                if (wsSql) {
                    wsSql.close();
                }      
            }
            else {
                done();
            }
            taos.destroy();
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
                send = send || function() { node.send.apply(node, arguments) };

                if (node.mydbConfig.connected) {
                    if (typeof msg.topic === 'string') {
                        console.log("query sql:", msg.topic);
                        let conn = node.mydbConfig.wsSql;
                        if (conn) {
                            var bind = [];
                            if (Array.isArray(msg.payload)) {
                                bind = msg.payload;
                            }
                            else if (typeof msg.payload === 'object' && msg.payload !== null) {
                                bind = msg.payload;
                            }

                            conn.exec(msg.topic);
                        };
                    }
                    else {
                        if (typeof msg.topic !== 'string') {
                            node.error("msg.topic : " + RED._("tdengine.errors.notstring")); 
                            done();
                        }
                    }
                }
                else {
                    node.error(RED._("tdengine.errors.notconnected"),msg);
                    status = {
                        fill:"red",
                        shape:"ring",
                        text:RED._("tdengine.status.notconnected")
                    };
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
            this.error(RED._("tdengine.errors.notconfigured"));
        }
    }
    RED.nodes.registerType("tdengine", TDengineDBNodeIn);
}
