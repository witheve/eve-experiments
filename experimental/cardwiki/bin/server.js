var fs = require("fs");
var path = require("path");
var express = require('express');
var runtime = require("./runtime");
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({ port: 8080 });
var eve = runtime.indexer();
try {
    fs.statSync("server.evedb");
    eve.load(fs.readFileSync("server.evedb").toString());
}
catch (err) { }
var clients = {};
wss.on('connection', function connection(ws) {
    //when we connect, send them all the pages.
    ws.send(JSON.stringify({ kind: "load", time: (new Date()).getTime(), me: "server", data: eve.serialize() }));
    ws.on('close', function () {
        delete clients[ws.me];
    });
    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
        var parsed = JSON.parse(message);
        if (parsed.kind === "changeset") {
            var diff = eve.diff();
            diff.tables = parsed.data;
            eve.applyDiff(diff);
            // dispatch and store.
            for (var client in clients) {
                if (client === parsed.me)
                    continue;
                if (!clients[client])
                    continue;
                clients[client].send(message);
            }
            // store
            fs.writeFileSync("server.evedb", eve.serialize());
        }
        else if (parsed.kind === "connect") {
            clients[parsed.data] = ws;
            ws.me = parsed.data;
        }
    });
});
var app = express();
app.use("/bin", express.static(__dirname + '/../bin'));
app.use("/css", express.static(__dirname + '/../css'));
app.use("/node_modules", express.static(__dirname + '/../node_modules'));
app.use("/vendor", express.static(__dirname + '/../vendor'));
app.use("/fonts", express.static(__dirname + '/../fonts'));
app.get("/", function (req, res) {
    res.sendFile(path.resolve(__dirname + "/../editor.html"));
});
app.listen(process.env.PORT || 3000);
//# sourceMappingURL=server.js.map