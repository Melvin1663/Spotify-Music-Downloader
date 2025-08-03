const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const csv = require('csv');
const ytdl = require('@distube/ytdl-core');
const path = require('path');
const axios = require('axios');

ffmpeg.setFfmpegPath(ffmpegStatic);

function validFileName(string) {
  if (!string || string.length > 255 || /[<>:"/\\|?*\u0000-\u001F]/g.test(string) || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(string) || string === '.' || string === '..') return false;
  return true;
}

function sanitizeFileName(string) {
  if (!validFileName(string)) return string
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')  // Replace invalid characters
    .replace(/^(con|prn|aux|nul|com\d|lpt\d)$/i, '_$1_')  // Handle reserved names
    .replace(/^\.$/, '_')  // Replace '.' with '_'
    .replace(/^\.\.$/, '__');  // Replace '..' with '__'
  return string;
}

async function downloadImage(url, filePath) {
  const writer = fs.createWriteStream(filePath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function main() {
  const { searchMusics } = await import("@monka75/node-youtube-music");

  let raw = fs.readFileSync('in.csv').toString();

  csv.parse(raw, {
    columns: true
  }, async (err, records) => {
    if (err) {
      console.error('Error parsing CSV:', err.message);
      return;
    }

    if (!fs.existsSync('results')) {
      fs.mkdirSync('results');
    }

    let done = 0;
    let failedDownloads = [];

    for await (const song of records) {
      console.log(`\u001b[34mProgress [${done + 1}/${records.length}]`)
      console.log(`\u001b[35mSearching for ${song["Artist Name(s)"]} - ${song["Track Name"]}`)

      const musics = await searchMusics(`${song["Artist Name(s)"]} - ${song["Track Name"]}`);
      const tempImageFilePath = path.join(__dirname, 'temp_cover.jpg');

      if (musics.length) {
        console.log(`\u001b[33mDownloading cover art: ${song["Album Image URL"]}`);
        let errDlArt = false;
        await downloadImage(song["Album Image URL"], tempImageFilePath).catch(e => {
          console.error(`\u001b[31mError downloading cover art:`, e.message);
          errDlArt = true;
        });

        if (!errDlArt) console.log(`\u001b[32mDownloaded cover art`);

        console.log(`\u001b[33mExtracting stream: https://www.youtube.com/watch?v=${musics[0].youtubeId}`);
        await new Promise((resolve, reject) => {
          const audioStream = ytdl(`https://www.youtube.com/watch?v=${musics[0].youtubeId}`, { filter: 'audioonly', quality: 'highestaudio' });
          const mpath = path.join('results', sanitizeFileName(musics[0].title) + '.mp3');

          const command = ffmpeg(audioStream)
            .audioBitrate(256)
            .addOutputOption('-metadata', `title=${song["Track Name"]}`)
            .addOutputOption('-metadata', `artist=${song["Artist Name(s)"]}`)
            .addOutputOption('-metadata', `album=${song["Album Name"] || ''}`)
            .addOutputOption('-metadata', `date=${song["Album Release Date"] ? new Date(song["Album Release Date"]).getFullYear() : ''}`)
            .addOutputOption('-metadata', `track=${song["Track Number"] || ''}`)
            .addOutputOption('-metadata', `disc=${song["Disc Number"] || ''}`)
            .addOutputOption('-metadata', `iSRC=${song["ISRC"] || ''}`)
            .addOutputOption('-metadata', `TXXX=explicit:${song["Explicit"] == "TRUE" ? '1' : '0'}`)
            .addOutputOption('-metadata', `TXXX=Parental Advisory:${song["Explicit"] == "TRUE" ? 'Yes' : 'No'}`)

          if (!errDlArt && fs.existsSync(tempImageFilePath)) {
            command.input(tempImageFilePath)
              .addOutputOptions([
                '-map', '0:a:0',
                '-map', '1:v:0',
                '-c:v', 'copy',
                '-disposition:v:0', 'attached_pic'
              ]);
          }

          command.save(mpath)
            .on('end', () => {
              console.log(`\u001b[32mDownloaded and tagged ${song["Artist Name(s)"]} - ${song["Track Name"]}`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`\u001b[31mError processing ${song["Artist Name(s)"]} - ${song["Track Name"]}:`, err.message);
              failedDownloads.push(song);
              resolve();
            });
        })
      } else console.log(`\u001b[33mNo YouTube stream data for ${song["Artist Name(s)"]} - ${song["Track Name"]}`);

      done++;
    }

    if (failedDownloads.length > 0) {
      console.log(`\u001b[31m\nFound ${failedDownloads.length} failed downloads. Compiling CSV...`);
      const failedCsv = csv.stringify(failedDownloads, { header: true });
      fs.writeFileSync('failed_downloads.csv', failedCsv);
      console.log(`\u001b[31mFailed downloads saved to failed_downloads.csv`);
    } else {
      console.log(`\u001b[32m\nAll songs downloaded successfully.`);
    }
  });
}

main();