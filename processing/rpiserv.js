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

        const unpairedElements = []; // To collect all unpaired elements

        for (const [first, second] of paired) {
            console.log(`First value: ${first}, Second value: ${second}`);

            // Extract substrings directly from the values
            const firstSubstring = first ? extractSubstring(first[1]) : null;
            const secondSubstring = second ? extractSubstring(second[1]) : null;

            if (first && second && firstSubstring === secondSubstring) {
                // Handle paired elements
                (async () => {
                    try {
                        const outputFile = `${first[1].slice(0, -4)}_final.mp4`;
                        const ffmpegCommand = `ffmpeg -i ${first[1]} -i ${second[1]} -filter_complex hstack ${outputFile}`;

                        console.log("Processing videos with FFmpeg...");
                        await processVideos(ffmpegCommand, first[1], second[1]);

                        console.log("Burning subtitles for paired elements...");
                        await burnThemInClose(outputFile, location, firstSubstring); // For the first
                        await burnThemInClose(outputFile, location, secondSubstring); // For the second
                    } catch (error) {
                        console.error("Error processing paired elements:", error.message);
                    }
                })();
            } else {
                // Handle unpaired elements (either second is undefined or no match)
                if (first) unpairedElements.push(first);
                if (second) unpairedElements.push(second); // This will handle cases where second exists but is unpaired
            }
        }

        // Process all unpaired elements after the main loop
        (async () => {
            for (const unpaired of unpairedElements) {
                try {
                    console.log(`Burning subtitles for unpaired element: ${unpaired[1]}...`);
                    const unpairedSubstring = extractSubstring(unpaired[1]); // Extract substring dynamically
                    await burnThemInClose(unpaired[1], location, unpairedSubstring);
                    console.log("afterburner");
                } catch (error) {
                    console.error(`Error processing unpaired element (${unpaired[1]}):`, error.message);
                }
            }
        })();

      });

      (async () => {
        const directoryPath = __dirname; // Replace with the path to your directory
        const substring = 'wbsubs'; // Replace with your desired substring
        const files = await waitForFilesWithSubstring(directoryPath, substring);
        console.log("Detected files:", files);
        console.log("Waiting for all .mp4 files to unlock...");
        await waitUntilAllMp4FilesUnlocked(__dirname);
        console.log("All .mp4 files are now ready for use!");

    })();
    }
  });

  ws.on('close', async () => {
    await generatefilelist(__dirname);
    await concatenate("file_list.txt", __dirname);
  })});

async function waitUntilAllMp4FilesUnlocked(directoryPath, timeout = 30000, interval = 1000) {
  const startTime = Date.now();

  while (true) {
      try {
          // Get all .mp4 files in the directory
          const files = await fsp.readdir(directoryPath);
          const mp4Files = files.filter(file => file.endsWith('.mp4')).map(file => path.join(directoryPath, file));

          const lockedFiles = [];

          // Check if each file is accessible
          for (const filePath of mp4Files) {
              try {
                  // Try opening the file in read mode
                  const fileHandle = await fsp.open(filePath, 'r');
                  await fileHandle.close();
              } catch (err) {
                  // File is locked
                  lockedFiles.push(filePath);
              }
          }

          if (lockedFiles.length === 0) {
              console.log("All .mp4 files are unlocked:", mp4Files);
              return true; // Exit when all files are unlocked
          }

          console.log(`Locked .mp4 files: ${lockedFiles}. Retrying in ${interval / 1000} seconds...`);
      } catch (err) {
          console.error("Error checking files:", err.message);
      }

      // Timeout check
      if (Date.now() - startTime > timeout) {
          throw new Error(`Timeout: Some .mp4 files are still locked after ${timeout / 1000} seconds.`);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, interval));
  }
}

async function waitForFilesWithSubstring(directoryPath, substring) {
  while (true) {
      try {
          // Check the directory for files
          const files = await fsp.readdir(directoryPath);

          // Look for files containing the substring
          const matchingFiles = files.filter(file => file.includes(substring));
          if (matchingFiles.length > 0) {
              console.log("Matching files found:", matchingFiles);
              return matchingFiles; // Return when matching files are detected
          }
      } catch (err) {
          console.error(`Error reading directory: ${err.message}`);
      }

      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
  }
}


async function waitForFile(filename, timeout = 10000, interval = 500) {
  const startTime = Date.now();

  while (true) {
      try {
          await fsp.access(filename); // Check if the file exists
          console.log(`File '${filename}' exists!`);
          return true;
      } catch (err) {
          if (Date.now() - startTime > timeout) {
              console.error(`Timeout exceeded. File '${filename}' did not appear.`);
              return false;
          }
          await new Promise(resolve => setTimeout(resolve, interval)); // Wait for the next check
      }
  }
}

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

async function generatefilelist(directoryPath) {
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

    console.log("1111"+ffentries.toString());

    const inputFileName = "file_list.txt";
    const inputFileContent = ffentries.map(file => `file '${file}'`).join('\n');

    fs.writeFileSync('file_list.txt', inputFileContent, { encoding: 'utf8' });

})};


async function concatenate(inputFileName,directoryPath) {


    try {
      const outputVideo = "klip.mp4";
      // Step 2: Run the FFmpeg concatenate command asynchronously
      const ffmpegCommand = `ffmpeg -loglevel debug -f concat -i ${inputFileName} -c copy ${outputVideo}`;
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
  };

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

  async function encodeVideoWithSubtitles(inputVideo, subtitleFile, outputVideo) {

    await waitForFile(inputVideo);
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

    await waitForFile(filename);

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


        return 1;
      } catch (err) {
        console.error('Error:', err);
      }
}

