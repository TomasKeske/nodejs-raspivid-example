
const express = require('express');
const WebSocketServer = require('ws').Server;
const raspividStream = require('raspivid-stream');
const fs = require('fs');;
const app = express();
const wss = require('express-ws')(app);

var vstreamCounter = 0;
var writeStream = null;


app.ws('/vstream', async (ws, req) => {
    console.log('Client connected');

    vstreamCounter = vstreamCounter + 1;

    ws.send(JSON.stringify({
        action: "init",
         width: 640,
         height: 480
    }));

    var d = new Date();
    var filename = "record_" +
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");

    var videoStream = await raspividStream();
    var recordCnt = 0;

    videoStream.on('data', (data) => {
        ws.send(data, { binary: true }, (error) => { if (error) console.error(error); });

        ws.on("message", (msg) => {

            console.log(msg.toString());

            if (msg.toString() === "record"){

                if (recordCnt == 0){
                    writeStream = fs.createWriteStream(filename);
                }
                recordCnt = recordCnt +1;
                writeStream.write(data);
            }

            if (msg.toString() === "stoprecord"){
                writeStream.end();
            }
        });
    });

    ws.on('close', () => {
        console.log('Client left');
        videoStream.removeAllListeners('data');

        vstreamCounter = vstreamCounter - 1;

        console.log(vstreamCounter);

        if (vstreamCounter === 0){
            process.exit();
        }

    });
});

app.ws('/vstream-90', async (ws, req) => {
    console.log('Client connected');

    vstreamCounter = vstreamCounter + 1;

    ws.send(JSON.stringify({
        action: "init",
         width: 640,
         height: 480,
         rotation: 90
    }));

    var d = new Date();
    var filename = "record_" +
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");

    var recordCnt90 = 0;
    var videoStream = await raspividStream({ rotation: 90 });

    videoStream.on('data', (data) => {
        ws.send(data, { binary: true }, (error) => { if (error) {console.error(error); /*process.exit();*/}  });

        ws.on("message", (msg) => {

            console.log(msg.toString());

            if (msg.toString() === "record"){

                if (recordCnt90 == 0){
                    writeStream = fs.createWriteStream(filename);
                }
                recordCnt90 = recordCnt90 +1;
                writeStream.write(data);
            }

            if (msg.toString() === "stoprecord"){
                writeStream.end();
            }
        });
    });

    ws.on('close', () => {
        console.log('Client left');
        videoStream.removeAllListeners('data');
        vstreamCounter = vstreamCounter - 1;

        console.log(vstreamCounter);

        if (vstreamCounter === 0){
            process.exit();
        }
    });
});

app.ws('/vstream-180', async (ws, req) => {
    console.log('Client connected');

    vstreamCounter = vstreamCounter + 1;

    ws.send(JSON.stringify({
        action: "init",
         width: 640,
         height: 480,
         rotation: 180
    }));

    var d = new Date();
    var filename = "record_" +
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");

    var recordCnt180 =  0;
    var videoStream = await raspividStream({ rotation: 180 });

    videoStream.on('data', (data) => {
        ws.send(data, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });

        ws.on("message", (msg) => {

            console.log(msg.toString());

            if (msg.toString() === "record"){

                if (recordCnt180 == 0){
                    writeStream = fs.createWriteStream(filename);
                }
                recordCnt180 = recordCnt180 +1;
                writeStream.write(data);
            }
            //recordCnt180 = recordCnt180 +1;

            if (msg.toString() === "stoprecord"){
                writeStream.end();
            }
        });
    });

    ws.on('close', () => {
        console.log('Client left');
        videoStream.removeAllListeners('data');

        vstreamCounter = vstreamCounter - 1;

        console.log(vstreamCounter);

        if (vstreamCounter === 0){
            process.exit();
        }
    });
});

app.listen(8080, function(err){
    if (err) console.log("Error in server setup")
    console.log("Server listening on Port");
});