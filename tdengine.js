// tdengine.js
module.exports = function(RED) {
    "use strict";
    const DB = require('./db.js');  // 引入数据库操作类
    const reconnect = RED.settings.tdengineReconnectTime || 20000;

    function TDengineNode(n) {
        RED.nodes.createNode(this, n);
        this.host = n.host;
        this.port = n.port;
        this.tz = n.tz || "local";
        this.charset = (n.charset || "UTF8_GENERAL_CI").toUpperCase();
        this.dbname = n.db;
        
        this.db = new DB({
            host: this.host,
            port: this.port,
            user: this.credentials.user,
            password: this.credentials.password,
            db: this.dbname
        });
        
        this.connected = false;
        this.connecting = false;
        this.setMaxListeners(0);
        const node = this;

        // 保持原有检查逻辑
        function checkVer() {
            // 使用新的DB类
            if (node.db.connected) {
                node.db.query("select server_version();")
                    .catch(err => {
                        node.error(err);
                        node.status({fill: "red", shape: "ring", text: RED._("tdengine.status.badping")});
                        doConnect();
                    });
            }
        }

        async function doConnect() {
            node.connecting = true;
            node.emit("state", "connecting");
            
            try {
                await node.db.connect();
                node.connected = node.db.connected;
                node.connecting = node.db.connecting;
                node.emit("state", "connected");
            } catch (error) {
                node.connected = false;
                node.connecting = false;
                node.emit("state", "failed to connect");
            }
        }

        // 保持不变
        node.connect = function() {
            if (!node.db.connected && !node.db.connecting) {
                doConnect();
            }
        }

        // 修改关闭逻辑
        node.on('close', function(done) {
            if (node.db) {
                node.db.close();
                node.connected = false;
            }
            node.emit("state", "");
            done();
        });
    }
    
    // 注册节点保持不变
    RED.nodes.registerType("TDengineDatabase", TDengineNode, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });

    function TDengineDBNodeIn(n) {
        RED.nodes.createNode(this, n);
        this.mydb = n.mydb;
        this.mydbConfig = RED.nodes.getNode(this.mydb);
        this.status({});
        
        const node = this;
        
        if (this.mydbConfig) {
            this.mydbConfig.connect();
            
            let busy = false;
            let status = {};
            
            node.mydbConfig.on("state", function(info) {
                if (info === "connecting") {
                    node.status({fill: "grey", shape: "ring", text: info});
                } else if (info === "connected") {
                    node.status({fill: "green", shape: "dot", text: info});
                } else {
                    node.status({fill: "red", shape: "ring", text: info});
                }
            });

            node.on("input", async function(msg, send, done) {
                send = send || function() { node.send.apply(node, arguments) };
                
                // 检查并尝试连接
                if (!node.mydbConfig.connected) {
                    node.mydbConfig.connect();
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                if (!node.mydbConfig.connected) {
                    node.error(RED._("tdengine.errors.notconnected"), msg);
                    status = {
                        fill: "red",
                        shape: "ring",
                        text: RED._("tdengine.status.notconnected")
                    };
                    if (done) done();
                    return;
                }

                if (typeof msg.topic !== 'string') {
                    node.error("msg.topic: " + RED._("tdengine.errors.notstring"));
                    if (done) done();
                    return;
                }
                
                try {
                    // 使用新的DB类执行查询
                    const result = await node.mydbConfig.db.query(msg.topic);
                    msg.payload = result.results;
                    send(msg);
                } catch (error) {
                    node.error(error);
                    node.mydbConfig.connected = false;
                    node.mydbConfig.emit("state", "failed to connect");
                }
                
                if (done) done();
            });

            node.on('close', function() {
                node.mydbConfig.removeAllListeners();
                node.status({});
            });
        } else {
            this.error(RED._("tdengine.errors.notconfigured"));
        }
    }
    
    // register tdengine
    RED.nodes.registerType("tdengine", TDengineDBNodeIn);
}