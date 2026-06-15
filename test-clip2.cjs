const { app, clipboard } = require('electron');
app.whenReady().then(() => {
  console.log("Formats:", clipboard.availableFormats());
  for (let format of clipboard.availableFormats()) {
    try {
      console.log(`Format: ${format}`);
      const buf = clipboard.readBuffer(format);
      console.log(`Buffer length: ${buf.length}`);
      if (buf.length > 0 && buf.length < 1000) {
         console.log(buf.toString('utf8'));
      }
    } catch(e) {}
  }
  app.quit();
});
