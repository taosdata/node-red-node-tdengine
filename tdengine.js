
module.exports = function(RED) {
    "use strict";
    var reconnect = RED.settings.tdengineReconnectTime || 20000;
    var taos      = require('@tdengine/websocket');


    //
    // ------------------------------  DBEngine util ----------------------------------
    //

    function dbInit(node, n) {
        // save db config
        node.connected  = false;
        node.connecting = false;
        node.wsSql      = null;

        node.connType = n.connType;
        node.uri      = n.uri;
        node.host     = n.host;
        node.port     = n.port;
        node.db       = n.db;

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


    function DBEngine(n) {    
        var node = this;
        
        // create node
        RED.nodes.createNode(node, n);
        node.log("DBEngine node created.");

        // init db
        dbInit(node, n);

        //
        // do connect
        //
        async function doConnect() {
            // check 
            if (!checkParamValid(node)) {
                return false;
            }

            //
            // connect db
            //
            
            updateStatus(node, "start");
            if (!node.wsSql) {
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
                    node.wsSql = await taos.sqlConnect(conf);
                    // success
                    updateStatus(node, "success");
                } catch (error) {
                    // failed
                    node.error(error);
                    updateStatus(node, "failed");
                }              
            } else {
                node.log("already is connected.")
            };
        }

        // exec sql
        node.exec = async function(topic, payload) {
            if (node.wsSql) {
                var bind = [];
                if (Array.isArray(payload)) {
                    bind = payload;
                }
                else if (typeof payload === 'object' && payload !== null) {
                    bind = payload;
                }

                try {
                    var rows = [];
                    let i = 0;

                    node.log("exec sql:" + topic);
                    var wsRows = await node.wsSql.query(topic);
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
                node.error("wsSql is null.");
            }

            return null;
        }

        // interfalce
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
                if (node.wsSql) {
                    node.wsSql.close();
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
                        var rows = null;
                        rows = node.dbEngine.exec(msg.topic, msg.payload);
                        msg.payload = rows;
                        send(msg);

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
