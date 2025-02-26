const WebSocket = require('ws')
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const server = new WebSocket.Server({ port: 1337 });
var  writeStream = null;
var filename = null;
var location = null;

server.on('connection', async (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {

        if (message.toString().includes("loc-")){
          console.log(message);
            location = message.toString().slice(4);
            filename = generateFileName(location);
            writeStream = fs.createWriteStream(filename);
        }


        if (!writeStream.writableEnded) {
            writeStream.write(message, (err) => {
                if (err) {
                console.error('Error writing to file:', err);
                } else {
                console.log('Data written to file');
                }
            });
        }


        if (message.toString() === "stoprecord"){
            writeStream.end();

            await burnThemInClose(filename, location);
        }
     });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function generateFileName(location) {
    var d = new Date();
    var filename = location +"_"+
    d.getFullYear() + "-" +
    ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
    ("00" + d.getDate()).slice(-2) + "_" +
    ("00" + d.getHours()).slice(-2) + ":" +
    ("00" + d.getMinutes()).slice(-2) + ":" +
    ("00" + d.getSeconds()).slice(-2) + ".h264";

    filename = filename.replace(/["']/g, "");
    filename = filename.replace(/:/g, "_");

    return filename;
}

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

