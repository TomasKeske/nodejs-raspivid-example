const WebSocket = require('ws');
const fs = require('fs');
const fsp = require('fs').promises;
const readline = require('readline');
const ffmpeg = require('fluent-ffmpeg');
const { finished } = require('stream');
const { promisify } = require('util');
const path = require('path');
const { exec } = require('child_process');
const { spawn } = require('child_process');

const finishedAsync = promisify(finished);
const execAsync = promisify(exec);

const directoryPath = __dirname;

const server = new WebSocket.Server({ port: 1338 });
let location  = null;
let h264Files = null;
let reencchild;
let combinechild;
let processchild;

server.on('connection', async (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {

        const msgStr = message.toString();

        if (msgStr === "stopProcessing"){
            if(processchild){
                processchild.kill('SIGTERM');
            }

            if(combinechild){
                combinechild.kill('SIGTERM');
            }

            if(reencchild){
                reencchild.kill('SIGTERM');
            }
        }

        if (msgStr === "process") {
            try {

                const directoryPath = __dirname;

                try {
                    h264Files = await findH264Files(directoryPath);
                    console.log('H.264 files found:', h264Files);
                } catch (error) {
                    console.error(error);
                }

                if (fs.existsSync("error_reenc.txt")) {
                    await processFile("error_reenc.txt", h264Files);


                } else {
                    for (let i = 0; i<h264Files.length; i++){
                        filename = h264Files[i];
                        location = getLocationSubstring(filename, "_");

                        await reencodeVideo(filename, filename.slice(0,-4)+"mp4", i);
                       /* if (fs.existsSync(filename)) {
                            fs.unlinkSync(filename);
                          }*/
                    }
                }

              } catch (error) {
                console.error('Error ending the stream:', error);
              }

              await fs.readdir(directoryPath, (err, files) => {
                      if (err) {
                          return console.error('Unable to scan directory: ' + err);
                      }

                      // Filter and sort files based on the position numbers extracted from the "pos-" substring
                      const filteredFiles = files.filter(file => !file.endsWith('.h264'))
                                                .map(file => ({
                                                     name: file,
                                                     position: extractPositionNumber(file)
                                                 }))
                                                 .filter(file => file.position !== null)
                                                 .sort((a, b) => a.position - b.position)
                                                 .map(file => file.name);

                      console.log(filteredFiles);

                      const entries = Array.from(filteredFiles.entries());

                      let paired = [];
                      for (let i = 0; i < entries.length; i += 2) {
                          paired.push([entries[i], entries[i + 1]]);
                      }


                      const unpairedElements = []; // To collect all unpaired elements
                      let sucnt = 0;
                      let errFiles = null;
                      let fleg = null;

                      if (fs.existsSync("process_log.txt")) {
                        const fileStream = fs.createReadStream("process_log.txt");

                        fileStream.on('error', (error) => {
                            console.error(`Error reading file: ${error.message}`);
                        });

                        const rl = readline.createInterface({
                        input: fileStream,
                        crlfDelay: Infinity
                        });

                        rl.on('line', async (line) => {
                        console.log(`Got line from file: ${line}`);
                        errFiles = line.split(",,");
                        fleg = true;
                        });
                      }

                      let tsks = [];


                      (async () => {
                      for (const [index, [first, second]] of paired.entries()) {

                        if(fleg){

                            let errIndex = findSubstringPairIndex(paired, errFiles[0]);

                            if (index < errIndex) {
                                continue; // Skip the current iteration
                            }
                        }

                        if (!fs.existsSync("step2_completed.lock")) {


                          console.log(`First value: ${first}, Second value: ${second}`);

                          // Extract substrings directly from the values
                          const firstSubstring = first ? extractSubstring(first[1]) : null;
                          const secondSubstring = second ? extractSubstring(second[1]) : null;


                          if (first && second && firstSubstring === secondSubstring) {
                              // Handle paired elements

                                  try {
                                    const slice = `${first[1].slice(0, -4)}`;

                                    if(!slice.includes("final")){

                                      const outputFile = `${first[1].slice(0, -4)}_final.mp4`;
                                      let args  = ['-i', first[1], '-i', second[1], '-filter_complex', 'hstack', outputFile];

                                      console.log("Processing videos with FFmpeg...");

                                      tsks.push(
                                        processVideos(args, sucnt, outputFile)
                                            .then(() => {
                                                console.log("Burning subtitles for paired elements...");
                                                return Promise.all([
                                                    burnThemInClose(outputFile, location, firstSubstring), // For the first
                                                    burnThemInClose(outputFile, location, secondSubstring) // For the second
                                                ]);
                                            })
                                    );


                                     }
                                      // For the second
                                  } catch (error) {
                                      console.error("Error processing paired elements:", error.message);
                                  }

                          } else {
                              // Handle unpaired elements (either second is undefined or no match)
                              if (first) unpairedElements.push(first);
                              if (second) unpairedElements.push(second); // This will handle cases where second exists but is unpaired
                          }

                      }
                    }




                    try {
                       // await Promise.all(tsks); // Wait for all asynchronous reencode tasks to finish
                        console.log('All tasks completed successfully.');
                        writeFileAsync('step2_completed.lock', "");
                        if (fs.existsSync("process_log.txt")) {
                            await fsp.unlink("process_log.txt");
                        }
                    } catch (error) {
                        console.error(`Error during task execution: ${error.message}`);
                        // Reject the Promise if any task fails
                    }
                      // Process all unpaired elements after the main loop

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



                          const directoryPath = __dirname; // Replace with the path to your directory
                          const substring = 'wbsubs'; // Replace with your desired substring
                          const files = await waitForFilesWithSubstring(directoryPath, substring);
                          console.log("Detected files:", files);
                          console.log("Waiting for all .mp4 files to unlock...");
                          await waitUntilAllMp4FilesUnlocked(__dirname);
                          console.log("All .mp4 files are now ready for use!");
                          await generatefilelist(__dirname);
                          await concatenate("file_list.txt", __dirname);
})();






                    });







                  }




                });


        }
);

function findSubstringPairIndex(array, substring) {
    for (let i = 0; i < array.length; i++) {
      for (let j = 0; j < array[i].length; j++) {
        if (array[i][j].includes(substring)) {
          return i; // Return the pair index in the main array
        }
      }
    }
    return -1; // Return -1 if no match is found
  }

async function processFile(filePath, h264Files) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath);

        fileStream.on('error', (error) => {
            console.error(`Error reading file: ${error.message}`);
            reject(error);
        });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        const tasks = [];

        rl.on('line', async (line) => {
            console.log(`Got line from file: ${line}`);
            const startInt = getFirstIntegerFromLine(line);

            for (let i = startInt; i < h264Files.length; i++) {
                const filename = h264Files[i];
                location = getLocationSubstring(filename, "_");

                console.log(`Re-encoding video: ${filename}`);
                tasks.push(reencodeVideo(filename, filename.slice(0, -4) + ".mp4", i));

            }

                tasks.push(deleteFile(filePath));
        });

        rl.on('close', async () => {
            console.log('Finished reading lines. Waiting for all tasks to complete...');
            try {
                await Promise.all(tasks); // Wait for all asynchronous reencode tasks to finish
                console.log('All tasks completed successfully.');
                resolve(); // Resolve the Promise when all tasks are done
            } catch (error) {
                console.error(`Error during task execution: ${error.message}`);
                reject(error); // Reject the Promise if any task fails
            }
        });
    });
}

async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log(`File "${filePath}" was deleted successfully.`);
    } catch (error) {
        console.error(`Error deleting file "${filePath}":`, error.message);
    }
}



function findH264Files(directory) {
    return new Promise((resolve, reject) => {
        fs.readdir(directory, (err, files) => {
            if (err) {
                return reject(`Unable to scan directory: ${err.message}`);
            }

            // Filter files with `.h264` extension
            const h264Files = files.filter(file => path.extname(file).toLowerCase() === '.h264');
            resolve(h264Files);
        });
    });
}

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


async function waitForFile(filename, timeout = 10000000, interval = 500) {
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


async function concatenate(inputFileName, directoryPath) {
    const outputVideo = "klip.mp4";

    try {
        // Construct the FFmpeg command arguments
        const args = ['-loglevel', 'debug', '-f', 'concat', '-i', inputFileName, '-c', 'copy', outputVideo, '-y'];

        // Spawn the FFmpeg process
        combinechild = spawn('ffmpeg', args);

        console.log(`FFmpeg process started with PID: ${combinechild.pid}`);

        // Capture FFmpeg's output
        let stdoutData = '';
        let stderrData = '';

        combinechild.stdout.on('data', (data) => {
            stdoutData += data.toString();
            console.log(`stdout: ${data.toString()}`);
        });

        combinechild.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`stderr: ${data.toString()}`);
        });

        // Wait for the process to finish
        await new Promise((resolve, reject) => {
            combinechild.on('close', (code) => {
                if (code === 0) {
                    console.log('Concatenation complete. Output video:', outputVideo);
                    resolve();
                } else {
                    console.error(`FFmpeg process exited with code ${code}`);
                    reject(new Error(`FFmpeg process failed with code ${code}.`));
                }
            });

            combinechild.on('error', (err) => {
                console.error('Error starting FFmpeg process:', err.message);
                reject(err);
            });
        });

        // Log FFmpeg output if available
        if (stdoutData) {
            console.log(`FFmpeg Output:\n${stdoutData}`);
        }

        if (stderrData) {
            console.warn(`FFmpeg Warnings:\n${stderrData}`);
        }

    } catch (error) {
        console.error(`Error executing FFmpeg: ${error.message}`);
    } finally {
        // Step 3: Delete the temporary file_list.txt
        try {
            await fsp.unlink(inputFileName);
            console.log(`Temporary file (${inputFileName}) deleted.`);
        } catch (err) {
            console.error(`Error deleting temporary file (${inputFileName}):`, err.message);
        }
    }
}

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

async function processVideos(args, counter, outputFile) {
  return new Promise((resolve, reject) => {
        // Construct FFmpeg arguments
       // const args = ['-i', firstInput, '-i', secondInput, '-filter_complex', 'hstack', outputFile];

        // Spawn the FFmpeg process
        processchild = spawn('ffmpeg', args);

        console.log(`FFmpeg process started with PID: ${processchild.pid}`);

        // Capture output and error data
        processchild.stdout.on('data', (data) => {
            console.log(`stdout: ${data.toString()}`);
        });

        processchild.stderr.on('data', (data) => {
            console.error(`stderr: ${data.toString()}`);
        });

        // Handle process completion
        processchild.on('close', async (code) => {
            if (code === 0) {
                console.log('FFmpeg process completed successfully.');
                resolve();
            } else {

                try {
                    // Write log data to a file
                    const logFileName = 'process_log.txt';
                    let logData = args[1]+",,"+args[3];
                    await fsp.writeFile(logFileName, logData);
                    console.log(`Log file written: ${logFileName}`);

                    if (fs.existsSync(outputFile)) {
                        fs.unlinkSync(outputFile);
                    }

                } catch (error) {
                    console.error('Error writing log file:', error.message);
                }
                console.error(`FFmpeg process exited with code ${code}`);
                resolve();
            }
        });

        // Handle process errors
        processchild.on('error', (err) => {
            console.error('Error starting FFmpeg process:', err.message);
            reject(err);
        });
    });

    /*  // Delete the first file if it exists
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
  }*/
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


async function reencodeVideo(inputPath, outputPath, counter) {
    return new Promise((resolve, reject) => {
        // Construct FFmpeg arguments
        const args = [
            '-i', inputPath,        // Input file
            '-c:v', 'libx264',      // Video codec
            '-c:a', 'aac',          // Audio codec
            '-movflags', 'faststart', '-y', // Optimize for streaming
            outputPath              // Output file
        ];

        // Spawn the FFmpeg process
        reencchild = spawn('ffmpeg', args);

        console.log(`FFmpeg process started with PID: ${reencchild.pid}`);

        // Capture process output for debugging
        let stderrData = '';

        reencchild.stderr.on('data', (data) => {
            stderrData += data.toString(); // Capture FFmpeg's error/output
            console.error(`FFmpeg stderr: ${data.toString()}`);
        });

        reencchild.stdout.on('data', (data) => {
            console.log(`FFmpeg stdout: ${data.toString()}`);
        });

        // Handle process exit
        reencchild.on('close', async (code) => {
            if (code === 0) {
                console.log('Video re-encoding complete.');


                resolve(); // Resolve the promise upon successful completion
            } else {
                console.error(`FFmpeg process exited with code ${code}`);

                // Log error details to a file
                const errorData = `${counter}`;
                try {
                    if (!fs.existsSync('error_reenc.txt')) {
                        await fsp.writeFile('error_reenc.txt', errorData);
                        console.log('Error log written successfully.');
                    }
                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }

                    resolve();

                } catch (writeErr) {
                    console.error('Error writing error log:', writeErr.message);
                }
resolve();
                //reject(new Error(`FFmpeg process failed with code ${code}`));
            }
        });

        // Handle process errors
        reencchild.on('error', (err) => {
            console.error(`Failed to start FFmpeg process: ${err.message}`);
            reject(err);
        });
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
if(!filename.slice(0,-4).includes("wbsusbs")){
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
}

function getLocationSubstring(input, searchCharacter) {
    // Find the first and second occurrences
    const firstIndex = input.indexOf(searchCharacter);
    const secondIndex = input.indexOf(searchCharacter, firstIndex + 1);

    // Check if the second occurrence exists
    if (secondIndex === -1) {
        return null; // No second occurrence, return null or the full string as needed
    }

    // Extract substring from the beginning until the second occurrence
    return input.substring(0, secondIndex);
}

function getFirstIntegerFromLine(line) {
    // Match the first integer in the line
    const match = line.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null; // Convert to integer or return null if no match
}