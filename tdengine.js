
module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    var taos      = require('@tdengine/websocket');

    //
    // Node
    //

    function TDengineNode(n) {
        console.log("TDengineNode create.");
        RED.nodes.createNode(this, n);
        this.host = n.host;
        this.port = n.port;
        this.tz   = n.tz || "local";
        this.charset = (n.charset || "UTF8_GENERAL_CI").toUpperCase();

        this.connected = false;
        this.connecting = false;

        this.dbname = n.db;
        this.wsSql  = null;
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
            console.log("call doConnect ...");
            console.log("host:" + node.host + " port:" + node.port + " user:" + node.credentials.user + " pass:" + node.credentials.password);
            node.connecting = true;
            node.emit("state","connecting");
            if (!node.wsSql) {
                let dsn = "ws://" + node.host + ":" + node.port;
                let conf = new taos.WSConfig(dsn);
                conf.setUser(node.credentials.user);
                conf.setPwd(node.credentials.password);
                conf.setDb(node.db);
                // conn
                try {
                    node.wsSql = await taos.sqlConnect(conf);

                    // update status
                    node.connected = true;
                    node.connecting = false;
                    node.emit("state","connected");
                    console.log("Connected to " + dsn + " successfully!")
                    
                } catch (error) {
                    node.connected = false;
                    node.connecting = false;
                    console.log("Connected to " + dsn + " failed! error:" + error)
                    node.emit("state","failed to connect");
                }
                
                
            } else {
                console.log("already is connected.")
            };
        }

        // interfalce
        node.connect = function() {
            if (!node.connected && !node.connecting) {
                doConnect();
            } else {
                console.log("call connect already conn.");
            }
        }

        // close trigger
        node.on('close', function(done) {
            console.log("call onclose ...");
            if (node.tick) { clearTimeout(node.tick); }
            if (node.check) { clearInterval(node.check); }
            // node.connection.release();
            node.emit("state"," ");
            if (node.connected) {
                node.connected = false;
                if (node.wsSql) {
                    node.wsSql.close();
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
        console.log("TDengine DBNodeIn create.")
        RED.nodes.createNode(this, n);
        this.mydb = n.mydb;
        this.mydbConfig = RED.nodes.getNode(this.mydb);
        this.status({});

        if (this.mydbConfig) {
            console.log("db config is set, do connect.");
            this.mydbConfig.connect();
            var node = this;
            var busy = false;
            var status = {};
            // state
            node.mydbConfig.on("state", function(info) {
                console.log("on state:" + info);
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
                console.log("on input ...");
                send = send || function() { node.send.apply(node, arguments) };

                if(!node.mydbConfig.connected) {
                    console.log("input not connect , and try connect....");
                    node.mydbConfig.connect();
                }



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

                            console.log("call conn.query...");

                            try {
                                var rows = [];
                                let i = 0;

                                var wsRows = await conn.query(msg.topic);
                                console.log(wsRows);

                                var fields = [];
                                var metas = await wsRows.getMeta();
                                metas.forEach((meta, idx) => {
                                    fields.push(meta.name);
                                });

                                console.log("get fields:" + fields);


                                while (await wsRows.next() ) {
                                    let row = wsRows.getData();

                                    let obj = {};
                                    fields.forEach((field, index) => {
                                        obj[field] = row[index];
                                    });
                                    rows.push(obj);
                                    console.log('i=', i, " row obj:", obj);
                                    i += 1;
                                    if(i>1000) {
                                        break;
                                    }
                                }

                                console.log("query end. rows count=" + i);
                                msg.payload = rows;
                                send(msg);

                            } catch (error) {
                                console.log("query error:" + error);
                                node.error(error);
                                node.mydbConfig.connected = false;
                                node.emit("state","failed to connect");
                            }
                            

                        } else {
                            console.log("conn is null.")
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
                console.log("on close");
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
