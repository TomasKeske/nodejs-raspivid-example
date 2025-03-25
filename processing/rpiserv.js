const WebSocket = require('ws');
const fs = require('fs');
const { promisify } = require('util');

const writeFileAsync1 = promisify((stream, data, callback) => {
  stream.write(data, callback);
});


const server = new WebSocket.Server({ port: 1337 });
let location = null;

server.on('connection', async (ws) => {
  console.log('Client connected');

  let writeStream = null;
  let filename = null;

  let view = null;
  let camcnt = 0;
  let isPaused = false;

  ws.on('message', async (message) => {

    const msgStr = message.toString();

    if (msgStr.includes("desc-")) {
      view = msgStr.slice(5);
      console.log(`View set to: ${view}`);
    }

    if (msgStr.includes("loc-")) {
      location = msgStr.slice(4);
      console.log(`Location set to: ${location}`);
    }

    if (msgStr.includes("cam") && camcnt === 0) {
      console.log(`Camera message received: ${msgStr}`);

      if (!location || !view) {
        console.error('Location or view not set. Cannot create filename.');
        return;
      }

      filename = generateFileName(location, view);
      writeStream = fs.createWriteStream(filename);
      console.log(`Write stream created: ${filename}`);
      camcnt++;
    }

    if (writeStream && !msgStr.startsWith("desc-") && !msgStr.startsWith("loc-") && !msgStr.includes("cam1") && !msgStr.includes("cam2")) {
      if (!writeStream.writableEnded) {
        try {

          if (!isPaused){
            await writeFileAsync1(writeStream, message);
            console.log('Data written to file');
          }

        } catch (error) {
          console.error('Error writing to stream:', error);
        }
      }
    }

    if (msgStr === "pause") {
      isPaused = true;
    }

    if (msgStr === "resume") {
      isPaused = false;
    }

    if (msgStr === "stoprecord") {
      if (writeStream) {
        if (!writeStream.writableEnded) {
          writeStream.end();
        }
      }
    //  ws.close();
      console.log('WebSocket connection closed');
    }

  })
});






function removeDiacritics(input) {
  return input
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
}


function generateFileName(location, view) {
    var d = new Date();
    var filename = location +"_"+view+"_"+
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");
    filename = filename.replace(/:/g, "_");
    filename = filename.replace(/ /g, "_");
    filename = filename.replace(/[ +]/g, '_');
    filename = filename.replace(/[ ,]/g, '_');
    filename = removeDiacritics(filename);
    filename = filename.replace(/[^\w.-]/g, '_');
    return filename;
}

