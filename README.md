## Overview
"node-red-node-tdengine"​ is the official plugin developed by ​TAOS Data​ for Node-RED. Composed of two nodes, the "tdengine-operator"​ node provides SQL execution capabilities for data writing/querying and metadata management functions. The ​"tdengine-consumer"​ node offers data subscription and consumption capabilities, designed to consume messages from specific TOPICs on designated subscription servers.

## Features

### tdengine-operator
- Support TDengine local deployment or cloud service data sources. 
- Full coverage of all TDengine SQL operations (SELECT/INSERT/CREATE/ALTER/SHOW, etc.).
- Unified interface for handling both read and write operations using `msg.topic` to pass SQL statements.

### tdengine-consumer
- Support TDengine local deployment or cloud service data sources. 
- Flexible configuration of subscription properties. 
- Automatically submit and save consumption progress. 
- Automatically reconnect after server disconnection. 


## Prerequisites

Prepare the following environment:
- TDengine >= 3.3.2.0  (Enterprise/Community/Cloud Edition are available).
- taosAdapter is running normally, refer to [taosAdapter](../../../tdengine-reference/components/taosadapter/).
- Node-RED >= 3.0.0, [Node-RED installation](https://nodered.org/docs/getting-started/).
- Node.js Language Connector for TDengine >= 3.1.8, get from [npmjs.com](https://www.npmjs.com/package/@tdengine/websocket).

The calling relationship of the above installation components is shown in the following figure:
 ![td-frame](img/td-frame.webp)


 ## Installation

 ``` bash
   npm i node-red-node-tdengine
 ```

 ## Quick Start

 ``` javascript
 // Example: Querying data
msg.topic = "SELECT * FROM test.meters LIMIT 10";
return msg;

// Example: Inserting data
msg.topic = "INSERT INTO test.d0 VALUES ('2025-06-10 10:00:02.001', 23.5, 220, 3)";
return msg;
 ```

 ## Output Formats

- Insert Result
    ``` json
    {
    "topic":  "insert into test.d1 values (now, 20, 203, 2);",
    "_msgid": "8f50fe84338387d7",
    "query":  false,
    "payload":{
        "affectRows": 1,
        "totalTime":  2,
        "timing":     "961982"
    }
    }
    ```

- Query Result
    ``` json
    {
    "topic":  "select tbname,avg(current) ...",
    "_msgid": "0d19e9b82ae3841a",
    "query":  true,
    "payload": [
        {
        "tbname":      "d2",
        "avg(current)": 26.7,
        "avg(voltage)": 235,
        "sum(p)":       6329
        },
        {
        "tbname":       "d0",
        "avg(current)": 16.5,
        "avg(voltage)": 222,
        "sum(p)":       121
        },
        {
        "tbname":       "d1",
        "avg(current)": 29,
        "avg(voltage)": 202,
        "sum(p)":       5833
        }
    ]
    }
    ```

- Subscribe Result
    ``` json
    {
    "topic": "topic_overload",
    "payload": [
        {
        "tbname":   "d1",
        "ts":       "1750140456777",
        "current":  31,
        "voltage":  217,
        "phase":    2,
        "groupid":  4,
        "location": "California.MountainView"
        }
    ],
    "database":  "test",
    "vgroup_id": 4,
    "precision": 0
    }
    ```

## Documents

Full documentation available in Node-RED's in-editor help system (click the book icon).

## Resources
- [TDengine Official Website](http://www.tdengine.com)
- [Node.js Language Connector for TDengine](https://docs.tdengine.com/tdengine-reference/client-libraries/node/)
- [Node-RED Plugin for TDengine](https://docs.tdengine.com/third-party/collection/NODE-RED/)