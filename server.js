
const express = require('express');
const WebSocketServer = require('ws').Server;
const raspividStream = require('raspivid-stream');
const fs = require('fs');;
const app = express();
const http = express();
const wss = require('express-ws')(app);
const ffmpeg = require('fluent-ffmpeg');

var vstreamCounter = 0;
var writeStream = null;
var location = null;


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

    app.use(express.urlencoded({ extended: true }));
    app.post('/post-location', async (req, res) => {

    location = await req.body.location;
    console.log('Received location:', location);
    });

    console.log('Client connected');

    vstreamCounter = vstreamCounter + 1;

    ws.send(JSON.stringify({
        action: "init",
         width: 640,
         height: 480,
         rotation: 180
    }));

    var d = new Date();
    var filename = location +"_"+
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");

    var recordCnt180 =  0;
    var videoStream = await raspividStream({ rotation: 180 });

    videoStream.on('data', async (data) => {
        ws.send(data, { binary: true }, (error) => { if (error) {console.error(error)/* process.exit()*/;}  });

        ws.on("message", async (msg) => {

            console.log(msg.toString());

            if (msg.toString() === "record"){

                if (recordCnt180 == 0){
                    writeStream = fs.createWriteStream(filename);
                }
                recordCnt180 = recordCnt180 +1;
                writeStream.write(data);
            }

            if (msg.toString() === "stoprecord"){
                writeStream.end();

            }
        });
    });


    ws.on('close', async () => {
        console.log('Client left');
        videoStream.removeAllListeners('data');

        vstreamCounter = vstreamCounter - 1;

        await burnThemInClose(filename, location);

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

async function reencodeVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions('-movflags', 'faststart') // Ensures compatibility with streaming
        .on('end', () => {
          console.log('Video re-encoding complete.');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error:', err);
          reject(err);
        })
        .save(outputPath);
    });
  }

function getVideoMetadata(videofilename) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videofilename, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata);
        }
      });
    });
  }

  function generateSrtContent(duration, staticText, startTime) {

    // Convert start time to seconds
    const [hours, minutes, seconds] = startTime.split(':').map(Number);
    const startTimeSeconds = hours * 3600 + minutes * 60 + seconds;

    let srtContent = '';

    for (let i = 0; i < duration; i++) {
        const currentTime = startTimeSeconds + i;
        const start = new Date(i * 1000).toISOString().substr(11, 8) + ',000';
        const end = new Date((i + 1) * 1000).toISOString().substr(11, 8) + ',000';
        const timeText = new Date(currentTime * 1000).toISOString().substr(11, 8);

        srtContent += `${i + 1}\n`;
        srtContent += `${start} --> ${end}\n`;
        srtContent += `${staticText} ${timeText}\n\n`;
      }

    return srtContent;
  }

  function writeFileAsync(filePath, content) {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  function encodeVideoWithSubtitles(inputVideo, subtitleFile, outputVideo) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputVideo)
        .outputOptions('-vf', `subtitles=${subtitleFile}`)
        .output(outputVideo)
        .on('end', () => {
          console.log('Video processing complete.');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error:', err);
          reject(err);
        })
        .run();
    });
  }

async function burnThemInClose(filename, location){
    try {
        var d = new Date();
        var hhmmss = ("00" + d.getHours()).slice(-2) + ":" +
        ("00" + d.getMinutes()).slice(-2) + ":" +
        ("00" + d.getSeconds()).slice(-2);

        var staticTime  = d.getFullYear() + "-" +
        ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
        ("00" + d.getDate()).slice(-2);

        var newMP4 = filename.slice(0, -5)+".mp4"
        await reencodeVideo(filename, "static.mp4");
        const metadata = await getVideoMetadata("static.mp4");
        console.log(metadata);
        const duration = Math.floor(metadata.format.duration);
        const outputSrt = "titulky.srt";
        const srtContent = generateSrtContent(duration, location+" "+staticTime, hhmmss);

        if (fs.existsSync(outputSrt)) {
            fs.unlinkSync(outputSrt);
        }

        await writeFileAsync(outputSrt, srtContent);

        await encodeVideoWithSubtitles("static.mp4", outputSrt, newMP4);

        if (fs.existsSync("static.mp4")) {
            fs.unlinkSync("static.mp4");
        }

        if (fs.existsSync(filename)) {
            fs.unlinkSync(filename);
        }

        if (fs.existsSync(outputSrt)) {
            fs.unlinkSync(outputSrt);
        }

        console.log('encoding finished');
      } catch (err) {
        console.error('Error:', err);
      }
}