# TDengine Integration with Node-RED

- [TDengine Integration with Node-RED](#tdengine-integration-with-node-red)
  - [Overview](#overview)
  - [Features](#features)
    - [tdengine-operator](#tdengine-operator)
    - [tdengine-consumer](#tdengine-consumer)
  - [Prerequisites](#prerequisites)
  - [Configure Data Source](#configure-data-source)
  - [Installation](#installation)
  - [Node Status](#node-status)
  - [Input Format](#input-format)
    - [tdengine-operator](#tdengine-operator-1)
    - [tdengine-consumer](#tdengine-consumer-1)
  - [Output Format](#output-format)
    - [tdengine-operator](#tdengine-operator-2)
    - [tdengine-consumer](#tdengine-consumer-2)
  - [Quick Start](#quick-start)
    - [Input](#input)
    - [Output](#output)
  - [Documents](#documents)
  - [Resources](#resources)


## Overview
[Node-RED](https://nodered.org/) is an open-source visual programming tool developed by IBM based on Node.js. It enables users to assemble and connect various nodes via a graphical interface to create connections for IoT devices, APIs, and online services. Supporting multi-protocol and cross-platform capabilities, it has an active community and is ideal for event-driven application development in smart home, industrial automation, and other scenarios, with its main strengths being low-code and visual programming.

The deep integration between TDengine and Node-RED provides a comprehensive solution for industrial IoT scenarios. Through Node-RED's MQTT/OPC UA/Modbus protocol nodes, data from PLCs, sensors and other devices can be collected at millisecond-level speed. Real-time queries of TDengine can trigger physical control actions like relay operations and valve switching for immediate command execution.

node-red-node-tdengine is the official plugin developed by TDengine for Node-RED. Composed of two nodes:  
- **tdengine-operator**: Provides SQL execution capabilities for data writing/querying and metadata management.  
- **tdengine-consumer**: Offers data subscription and consumption capabilities from specified subscription servers and topics.


## Features

### tdengine-operator
- Supports TDengine local deployment or cloud service data sources. 
- Full coverage of all TDengine SQL operations (SELECT/INSERT/CREATE/ALTER/SHOW, etc.).
- Unified interface for handling both read and write operations using `msg.topic` to pass SQL statements.

### tdengine-consumer
- Support TDengine local deployment or cloud service data sources. 
- Flexible configuration of subscription properties. 
- Support subscribing to multiple topics simultaneously.
- Automatically submit and save consumption progress. 
- Automatically reconnect after server disconnection. 


## Prerequisites

Prepare the following environment:
- TDengine >= 3.3.2.0  (Enterprise/Community/Cloud Edition are available).
- taosAdapter is running, refer to [taosAdapter](https://docs.tdengine.com/tdengine-reference/components/taosadapter/).
- Node-RED >= 3.0.0, [Node-RED installation](https://nodered.org/docs/getting-started/).
- Node.js Connector for TDengine >= 3.1.8, get from [npmjs.com](https://www.npmjs.com/package/@tdengine/websocket).


## Configure Data Source
  TDengine WebSocket connection string format:
   - tdengine-operator: `ws://user:password@host:port`
   - tdengine-consumer: `ws://host:port`

  See detail [here](https://docs.tdengine.com/tdengine-reference/client-libraries/node/#url-specification).

 ## Installation
Run the following command in your Node-RED user directory - typically ~/.node-red .
 ``` bash
   npm i node-red-node-tdengine
 ```

## Node Status
- Grey: Connecting.
- Green: Operational.
- Red: Malfunction.


## Input Format


### tdengine-operator
Pass SQL statement via topic:

``` javascript
msg = { topic: "SQL statement" }
```

Special characters and escape sequences in SQL must follow JSON string specifications.

### tdengine-consumer
Input node (no input).


## Output Format


### tdengine-operator
- Write Operations   
The payload contains write results, and the topic passes through the SQL statement:

    ``` javascript
    msg = {
    topic: "insert into ...",
    isQuery: false, // true for query operations
    payload: {
    affectRows: 2,  // affect rows
    totalTime: 3,   // Total write time (ms)
    timing: 1683311 // Server-side execution time (ns)
    }
    }
    ```

- Query Operations  
payload contains query results, topic passes through SQL:

    ``` javascript
    {
    topic: "select * from ...",
    isQuery: true, // true for query operations
    payload: [
    { ts: 1749609744000, current: 20, voltage: 200, phase: 5 },
    { ts: 1749609200001, current: 31, voltage: 210, phase: 4 },
        ...
    ]}
    ```


Query results are row data objects where properties correspond to column names. For data type mappings:
[TDengine NodeJS Connector Type Mapping](https://docs.tdengine.com/tdengine-reference/client-libraries/node/#data-type-mapping).

### tdengine-consumer

payload outputs array of objects where properties correspond to column names:
[TDengine NodeJS Connector Type Mapping](https://docs.tdengine.com/tdengine-reference/client-libraries/node/#data-type-mapping).

``` javascript
{
  topic: Subscription topic,
  database: Database name,
  vgroup_id: Data partition,
  precision: Database precision
  payload: [{ 
    column_name1: value1,
    column_name2: value2,
    ...
  },
  ...
  ],
}
```


## Quick Start

### Input

``` javascript
// Example: Inserting data
msg.topic = "insert into test.d0 values ('2025-06-10 10:00:02.001', 23.5, 220, 3)";
return msg;

// Example: Querying data
msg.topic = "select * from test.d0";
return msg;
```

 ### Output

- Insert Result
    ``` json
    {
    "topic":  "insert into test.d0 values ('2025-06-10 10:00:02.001', 23.5, 220, 3)",
    "_msgid": "8f50fe84338387d7",
    "isQuery": false,
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
    "topic":  "select * from test.d0",
    "_msgid": "0d19e9b82ae3841a",
    "isQuery":  true,
    "payload": [
      { "ts": 1749609744000, "current": 10, "voltage": 219, "phase": 0.32 },
      { "ts": 1749609200001, "current": 31, "voltage": 210, "phase": 4 }
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

- Full documentation is available in Node-RED's in-editor help system (click the book icon).
- [Introduce usage scenarios with Node-RED Plugin for TDengine](https://docs.tdengine.com/third-party/collection/Node-RED/).

## Resources
- [TDengine Official Website](http://www.tdengine.com).
- [Node.js Connector for TDengine](https://docs.tdengine.com/tdengine-reference/client-libraries/node/).