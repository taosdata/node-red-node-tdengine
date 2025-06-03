// db.js
const taos = require('@tdengine/websocket');

class DB {
    constructor(config) {
        this.host = config.host;
        this.port = config.port;
        this.user = config.user;
        this.password = config.password;
        this.db = config.db;
        this.wsSql = null;
        this.connected = false;
        this.connecting = false;
    }

    async connect() {
        // 如果已经在连接中或已连接，直接返回
        if (this.connecting || this.connected) return false;
        
        this.connecting = true;
        
        try {
            const dsn = `ws://${this.host}:${this.port}`;
            const conf = new taos.WSConfig(dsn);
            conf.setUser(this.user);
            conf.setPwd(this.password);
            conf.setDb(this.db);
            
            this.wsSql = await taos.sqlConnect(conf);
            this.connected = true;
            this.connecting = false;
            
            console.log(`Connected to ${dsn} successfully!`);
            return true;
        } catch (error) {
            this.connected = false;
            this.connecting = false;
            console.error(`Connection to ${dsn} failed: ${error}`);
            throw error;
        }
    }

    async query(sql) {
        if (!this.wsSql) throw new Error('Not connected to database');
        
        try {
            const wsRows = await this.wsSql.query(sql);
            const fields = await this._getFields(wsRows);
            const rows = await this._parseRows(wsRows, fields);
            
            return {
                meta: fields,
                results: rows
            };
        } catch (error) {
            throw new Error(`Query failed: ${error.message}`);
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
            if (count > 10000) break; // 安全限制，防止内存溢出
            
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
}

module.exports = DB;
