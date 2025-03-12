const WebSocket = require('ws')
const fs = require('fs');
const fsp = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const { finished } = require('stream');
const { promisify } = require('util');
const path = require('path');
const { exec } = require('child_process');

const finishedAsync = promisify(finished);
const writeFileAsync1 = promisify((stream, data, callback) => {
  stream.write(data, callback);
});
const execAsync = promisify(exec);

const directoryPath = __dirname;

const server = new WebSocket.Server({ port: 1337 });
let location = null;

server.on('connection', async (ws) => {
  console.log('Client connected');

  let writeStream = null;
  let filename = null;

  let view = null;
  let camcnt = 0;

  ws.removeEventListener('close', () => {
    console.log('test');
  });

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
          await writeFileAsync1(writeStream, message);
          console.log('Data written to file');
        } catch (error) {
          console.error('Error writing to stream:', error);
        }
      }
    }

    if (msgStr === "stoprecord") {
      if (writeStream) {
        if (!writeStream.writableEnded) {
          writeStream.end();
          try {
            await finishedAsync(writeStream);
            await reencodeVideo(filename, filename.slice(0,-4)+"mp4");
            console.log('Write stream ended');

            if (fs.existsSync(filename)) {
              fs.unlinkSync(filename);
            }
          } catch (error) {
            console.error('Error ending the stream:', error);
          }
        }
      }
    //  ws.close();
      console.log('WebSocket connection closed');
    }

    if (msgStr === "finish"){

      const directory = __dirname;
      const extension = '.h264';

      await waitForFilesWithExtensionToDisappear(directory, extension);

      fs.readdir(directoryPath, (err, files) => {
        if (err) {
            return console.error('Unable to scan directory: ' + err);
        }

        // Filter and sort files based on the position numbers extracted from the "pos-" substring
        const filteredFiles = files.map(file => ({
                                       name: file,
                                       position: extractPositionNumber(file)
                                   }))
                                   .filter(file => file.position !== null)
                                   .sort((a, b) => a.position - b.position)
                                   .map(file => file.name);

        console.log(filteredFiles);

        const entries = Array.from(filteredFiles.entries());

        const paired = [];
        for (let i = 0; i < entries.length; i += 2) {
            paired.push([entries[i], entries[i + 1]]);
        }

        for (const [first, second] of paired) {
          console.log(`First value: ${first}, Second value: ${second}`);

          (async (first, second) => {
            const ffmpegCommand = `ffmpeg -i ${first[1]} -i ${second[1]} -filter_complex hstack ${first[1].slice(0,-4)+"_final.mp4"}`;

            await processVideos(ffmpegCommand, first[1], second[1]);

            console.log("burning subtitles");
            await burnThemInClose(first[1].slice(0,-4)+"_final.mp4", location, extractSubstring(first[1]));
            await burnThemInClose(second[1].slice(0,-4)+"_final.mp4", location, extractSubstring(second[1]));


          })(first, second);
        }
      });

    }

  });



/*
  ws.on('close', async () => {
    console.log('Client disconnected');
    if (writeStream && !writeStream.writableEnded) {
      writeStream.end();
      try {
        await finishedAsync(writeStream);
        console.log('Write stream ended');
      } catch (error) {
        console.error('Error ending the stream:', error);
      }
    }
  });*/
});

function extractSubstring(input) {
  // Find the position of the second occurrence of '_'
  const secondUnderscoreIndex = input.indexOf('_', input.indexOf('_') + 1);

  // Find the position of '_cam'
  const camIndex = input.indexOf('_cam');

  // Extract the substring from the second underscore to before '_cam'
  if (secondUnderscoreIndex !== -1 && camIndex !== -1) {
      return input.substring(secondUnderscoreIndex + 1, camIndex);
  }

  return null; // Return null if boundaries are not found
}


async function concatenate(directoryPath) {

  fs.readdir(directoryPath, async (err, files) => {
    if (err) {
        return console.error('Unable to scan directory: ' + err);
    }

  const finalfiles = files
    .map(file => ({
        name: file,
        position: extractPositionNumber(file)
    }))
    // Filter: Include only files with a valid position and containing the required substring
    .filter(file => file.position !== null && file.name.includes("wbsubs"))
    // Sort files by position
    .sort((a, b) => a.position - b.position)
    // Extract only file names
    .map(file => file.name);

    const ffentries = Array.from(finalfiles.values());

    const inputFileName = "file_list.txt";
    const inputFileContent = ffentries.map(file => `file '${file}'`).join('\n');

    fs.writeFileSync(inputFileName, inputFileContent, (err) => {
        if (err) {
            console.error("Error creating input file:", err);
            return;
        }
    });

    try {
      const outputVideo = "klip.mp4";
      // Step 2: Run the FFmpeg concatenate command asynchronously
      const ffmpegCommand = `ffmpeg -f concat -safe 0 -i ${inputFileName} -c copy ${outputVideo}`;
      const { stdout, stderr } = await execAsync(ffmpegCommand);

      console.log(`FFmpeg Output:\n${stdout}`);
      if (stderr) {
          console.warn(`FFmpeg Warnings:\n${stderr}`);
      }
      console.log(`Concatenation complete. Output video: ${outputVideo}`);
  } catch (error) {
      console.error(`Error executing FFmpeg: ${error.message}`);
  } finally {
      // Step 3: Delete the temporary file_list.txt
    //  fs.unlinkSync(inputFileName);
      console.log(`Temporary file (${inputFileName}) deleted.`);
  }
  })};

function execCommand(command) {
  return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
          if (error) {
              reject(`Error: ${error.message}`);
              return;
          }
          resolve({ stdout, stderr });
      });
  });
}

async function processVideos(ffmpegCommand, firstFile, secondFile) {
  try {
      const { stdout, stderr } = await execCommand(ffmpegCommand);

      if (stderr) {
          console.warn(`FFmpeg stderr: ${stderr}`);
      }
      console.log(`FFmpeg stdout: ${stdout}`);
      console.log('Videos combined successfully!');

      // Delete the first file if it exists
      if (fs.existsSync(firstFile)) {
          fs.unlinkSync(firstFile);
          console.log(`Deleted file: ${firstFile}`);
      }

      // Delete the second file if it exists
      if (fs.existsSync(secondFile)) {
          fs.unlinkSync(secondFile);
          console.log(`Deleted file: ${secondFile}`);
      }
  } catch (error) {
      console.error(`An error occurred: ${error}`);
  }
}



function extractPositionNumber(filename) {
  const match = filename.match(/pos-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function waitForFilesWithExtensionToDisappear(directory, extension) {
  const checkInterval = 1000; // Check every 1 second

  while (true) {
      let files = await fsp.readdir(directory);
      // Filter files with the specified extension
      files = files.filter(file => path.extname(file) === extension);

      if (files.length === 0) {
          console.log(`All files with extension '${extension}' are no longer present.`);
          break; // Exit loop when no such files remain
      }

      console.log(`Still found ${files.length} file(s) with extension '${extension}':`, files);
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
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

  var staticcnt = 0;

async function burnThemInClose(filename, location, view){
    try {
        var d = new Date();
        var hhmmss = ("00" + d.getHours()).slice(-2) + ":" +
        ("00" + d.getMinutes()).slice(-2) + ":" +
        ("00" + d.getSeconds()).slice(-2);

        var staticTime  = d.getFullYear() + "-" +
        ("00" + (d.getMonth() + 1)).slice(-2) + "-" +
        ("00" + d.getDate()).slice(-2);

        const metadata = await getVideoMetadata(filename);
        staticcnt = staticcnt + 1;
        console.log(metadata);
        const duration = Math.floor(metadata.format.duration);
        const outputSrt = staticcnt+"titulky.srt";
        const srtContent = generateSrtContent(duration, location+" "+view+" "+staticTime, hhmmss);

        if (fs.existsSync(outputSrt)) {
            fs.unlinkSync(outputSrt);
        }

        await writeFileAsync(outputSrt, srtContent);

        await encodeVideoWithSubtitles(filename, outputSrt, filename.slice(0,-4)+"_wbsubs.mp4");

       // if (fs.existsSync(filename)) {
         //   fs.unlinkSync(filename);
       // }

        if (fs.existsSync(outputSrt)) {
            fs.unlinkSync(outputSrt);
        }

        console.log('encoding finished');


        console.log("concatenating");
      concatenate(directoryPath);

        return 1;
      } catch (err) {
        console.error('Error:', err);
      }
}

