const taos = require('@tdengine/websocket');

class DB {
    constructor(config) {
        this.config = config;
        this.wsSql = null;
        this.connected = false;
        this.connecting = false;
        
        // 根据配置类型准备连接信息
        if (config.connectionType === "connection-string") {
            this.dsn = config.connectionString;
            this.connectionMethod = "string";
        } else {
            // 主机端口方式
            this.dsn = `ws://${config.host}:${config.port}`;
            this.connectionMethod = "host-port";
            this.user = config.user;
            this.password = config.password;
            this.db = config.db;
        }
    }
    
    async connect() {
        if (this.connecting || this.connected) return false;
        this.connecting = true;
        
        try {
            // 直接使用连接字符串或生成的DSN
            const conf = new taos.WSConfig(this.dsn);
            
            // 仅在主机端口方式下设置认证信息
            if (this.connectionMethod === "host-port") {
                conf.setUser(this.user);
                conf.setPwd(this.password);
                conf.setDb(this.db);
            }
            
            // 连接数据库
            this.wsSql = await taos.sqlConnect(conf);
            
            this.connected = true;
            this.connecting = false;
            console.log(`连接成功: ${this.dsn}`);
            return true;
        } catch (error) {
            this.connected = false;
            this.connecting = false;
            console.error(`连接失败: ${error.message}`);
            throw new Error(`连接失败: ${error.message}`);
        }
    }

    async query(sql) {
        if (!this.wsSql) throw new Error('未连接到数据库');
        
        try {
            const wsRows = await this.wsSql.query(sql);
            const fields = await this._getFields(wsRows);
            const rows = await this._parseRows(wsRows, fields);
            
            return {
                meta: fields,
                results: rows
            };
        } catch (error) {
            throw new Error(`查询失败: ${error.message}`);
        }
    }

    async _getFields(wsRows) {
        const metas = await wsRows.getMeta();
        return metas.map(meta => meta.name);
    }

    async _parseRows(wsRows, fields) {
        const rows = [];
        let count = 0;
        
        while (await wsRows.next()) {
            if (count > 10000) break;
            
            const rowData = wsRows.getData();
            const rowObj = {};
            
            fields.forEach((field, index) => {
                rowObj[field] = rowData[index];
            });
            
            rows.push(rowObj);
            count++;
        }
        
        return rows;
    }

    close() {
        if (this.wsSql) {
            this.wsSql.close();
            this.wsSql = null;
        }
        this.connected = false;
    }
    
    // 获取连接信息
    getConnectionInfo() {
        return {
            method: this.connectionMethod,
            dsn: this.connectionMethod === "connection-string" ? 
                this.dsn : 
                `ws://${this.user}:***@${this.host}:${this.port}/${this.db}`
        };
    }
}

module.exports = DB;