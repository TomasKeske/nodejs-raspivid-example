
const express = require('express');
const WebSocket = require('ws');
const raspividStream = require('raspivid-stream');
const fs = require('fs');
const readline = require('readline');
const app = express();
const wss = require('express-ws')(app);
const { exec } = require('child_process');
const path = require('path');

var vstreamCounter = 0;
var videoStream = null;
var recording = false;
var websoc = null;

var currentDir = __dirname;
var camfn = 'camera.conf';
var p = path.join(currentDir, camfn);


if (fs.existsSync(p)) {

    const fileStream = fs.createReadStream(p);

    fileStream.on('error', (error) => {
      console.error(`Error reading file: ${error.message}`);
    });

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      console.log(`Got ip from file: ${line}`);

      var serverUrl = 'ws://'+line+':1337';
      console.log(serverUrl);
      websoc = new WebSocket(serverUrl);

      websoc.on('open', function open() {
        console.log('Connected to the server');
      });
    });

    rl.on('close', () => {
      console.log('File reading finished');
    });

} else {
    console.log("missing configuration file camera.conf");
    process.exit();
}

app.get('/camera-status', (req, res) => {

    exec('vcgencmd get_camera', (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }
        console.log(`stdout: ${stdout}`);

        var position = stdout.indexOf(",");

        if (position != -1) {
            var sbstr = stdout.substring(0, position);
            var rgxp = new RegExp("1", 'g');
            var occurences = sbstr.match(rgxp);

            if (occurences.length == 2){
                res.send(200);
            } else {
                res.send(500);
            }
        }

      });
  });

app.ws('/vstream', async (ws, req) => {
    console.log('Client connected');

    vstreamCounter = vstreamCounter + 1;

    ws.send(JSON.stringify({
        action: "init",
         width: 640,
         height: 480
    }));

    videoStream = await raspividStream();

    videoStream.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });


        }
    });

    ws.on("message", async (msg) => {
        await messageHandling(msg, null);
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.on('close', async () => {
            await closing(videoStream);
        });
     }
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

    videoStream = await raspividStream({ rotation: 90 });

    videoStream.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });
        }
    });

    ws.on("message", async (msg) => {
        await messageHandling(msg, 90);
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.on('close', async () => {
            await closing(videoStream);
        });
     }
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

    videoStream = await raspividStream({ rotation: 180 });

    videoStream.on('data', async (data) => {

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });
        }
    });

    ws.on("message", async (msg) => {
        await messageHandling(msg, 180);
    });

    if (ws.readyState === WebSocket.OPEN) {
        ws.on('close', async () => {
        await closing(videoStream);
    });}
});


var recording = true;
var ss = null;
var recordLock = 0;

async function messageHandling(msg, rot){

    if (msg.toString().includes("loc-")){
        websoc.send(msg);
    }

    if (msg.toString().includes("desc-")){
        websoc.send(msg);
    }

    if (msg.toString().includes("finish")){
        websoc.send(msg);
    }

    if (msg.toString() === "record"){

        //if (recordLock == 0) {

            recordLock = recordLock + 1;

            if (rot){
                ss = await raspividStream({ rotation: rot });
            } else {
                ss = await raspividStream();
            }

           // if (recording){

                ss.on('data', async (d) => {
                    if (websoc.readyState === WebSocket.OPEN) {
                        websoc.send(d, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });
                    }
                });
            //}
        //}
    }

    if (msg.toString() === "stoprecord"){
       // if (recording) {
            recording = false;
            websoc.send("stoprecord");
            console.log("stopped recording");
            //process.exit();
      //   }
    }
}

async function closing(){
    console.log('Client left');

    videoStream.removeAllListeners('data');

    vstreamCounter = vstreamCounter - 1;

    //await burnThemInClose(filename, location);

    console.log(vstreamCounter);

   // if (vstreamCounter === 0){

        const killCommand = 'killall -9 raspivid';

        exec(killCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error killing raspivid instances: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(`killall stderr: ${stderr}`);
            }
            console.log('All raspivid instances have been terminated successfully.');
        });

        process.exit();
   // }
}

app.listen(8080, function(err){
    if (err) console.log("Error in server setup")
    console.log("Server listening on Port");
});